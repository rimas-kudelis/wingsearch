#!/usr/bin/env python3
"""Check that every published ruling says what its source actually said.

`propose.py` reads a thread and writes a ruling; nothing afterwards ever compares the
two again. `20260617` is what that costs. Eric Chow asked "So the bird power activation
is considered part of the main action. here 'gain food' action?" and Jamey answered "A
bird power about gaining food is not part of the main action" -- a no. The ruling we
published said Loggerhead Shrike triggers *including* food from a bird power -- a yes.
It was live on two cards, rated high confidence, and no gate could see it: the text was
internally coherent, stating the correct principle and drawing the opposite conclusion.

The mechanism generalises. **The polarity of a terse answer lives in the question, and
the question is not quoted in the ruling.** "Nope!", "That's correct!", "It's not part of
the main action" carry no meaning alone, so a ruling built on one can invert with no
surviving trace of the error. Confidence does not help: the inverted ruling read as
confidently as a correct one, so escalating only on low confidence or on a flagged
contradiction cannot catch this class at all.

So the check has to be mechanical, and it is:

    the model must quote the literal span of the source comment that licenses the
    ruling's conclusion, and `check()` verifies that span is really in the source.

A model that inverted the polarity cannot satisfy that -- the words granting the
inverted claim do not exist in the text. It is a cheap hard gate on exactly the failure
we observed, in the same spirit as `curate.py`'s no-ruling-dropped rule: the model is
allowed to be wrong about how well a ruling reads, never about whether the source said it.

This script changes no card data. It writes `verification.json`, a per-ruling verdict,
and every ruling it cannot clear is queued for the escalation tier -- a reviewer with
tools that can research the card properly, rather than a fixed context window. Removing
a ruling stays a human act, recorded in `rejections.json`.

    export AWS_PROFILE=...
    python3 verify.py --dry-run
    python3 verify.py --limit 40          # validate the gate on a sample, and read it
    python3 verify.py                     # the full pass
    python3 verify.py --report            # what is queued, and why

Only rulings sourced from a Stonemaier comment can be verified this way -- that is the
one source we hold locally. `--report` counts the rest as `unverifiable` rather than
letting them look as trustworthy as the ones actually checked.
"""

import argparse
import collections
import hashlib
import json
import os
import re
import sys
import textwrap
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
import botocore.exceptions

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corpus as rc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, 'verification.json')
KNOWLEDGE_PATH = os.path.join(HERE, 'domain-knowledge.md')
MASTER_PATH = os.path.join(HERE, '..', '..', 'src', 'assets', 'data', 'master.json')

MODEL_ID = 'us.anthropic.claude-opus-5'
REGION = os.environ.get('AWS_REGION') or 'us-east-1'
# Rulings per call. The system prompt is domain-knowledge.md in full, ~15k input tokens,
# and this boto3 rejects `cachePoint`, so it is paid again on every call -- batching is the
# only lever on cost. 8 thread excerpts still fit comfortably (median 690 chars, p90 1382)
# and a call that returns fewer verdicts than asked is logged and retried on the next run.
BATCH = 8
WORKERS = 4
PRICE_IN, PRICE_OUT = 0.005, 0.025

# See curate.py: log() is called from inside the lock during the merge block.
_lock = threading.RLock()


def log(*a):
    with _lock:
        print(*a, flush=True)


VERIFY_TOOL = {
    'toolSpec': {
        'name': 'record_verification',
        'description': 'Record one verdict per ruling presented, in the order given.',
        'inputSchema': {'json': {
            'type': 'object',
            'properties': {
                'rulings': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'ruling_id': {'type': 'string',
                                          'description': 'The ruling id given, verbatim.'},
                            'card': {'type': 'string',
                                     'description': 'The card name given, verbatim.'},
                            'question_restated': {
                                'type': 'string',
                                'description': 'What the asker actually asked, in your own '
                                               'words, as a yes/no question wherever it is one. '
                                               'Do this before judging: the answer is often too '
                                               'terse to have a direction on its own, and '
                                               'getting the direction from the question is the '
                                               'whole point of this check.'},
                            'answer_polarity': {
                                'type': 'string',
                                'enum': ['yes', 'no', 'qualified', 'not-a-yes-no-question'],
                                'description': 'The official answer\'s direction with respect '
                                               'to the question as you just restated it.'},
                            'licensing_quote': {
                                'type': 'string',
                                'description': 'The span of the OFFICIAL comment that licenses '
                                               'the ruling\'s main conclusion, copied character '
                                               'for character. This is checked against the '
                                               'source text, so do not paraphrase, do not '
                                               'stitch two passages together, and do not fix '
                                               'the punctuation. If no span licenses the '
                                               'conclusion, leave it empty and say so in the '
                                               'verdict -- an empty quote is a useful answer.'},
                            'verdict': {
                                'type': 'string',
                                'enum': ['faithful', 'overstated', 'unsupported', 'inverted',
                                         'needs-human'],
                                'description': 'faithful = the ruling states what the source '
                                               'states, no more. overstated = right direction, '
                                               'but broader or more certain than the source '
                                               'warrants. unsupported = the source does not '
                                               'address this. inverted = the ruling asserts the '
                                               'opposite of the source. needs-human = you '
                                               'cannot tell from what you were given.'},
                            'confidence': {
                                'type': 'string', 'enum': ['high', 'medium', 'low'],
                                'description': 'How certain the verdict is. Report it, do not '
                                               'argue for it: low is a cheap, useful answer '
                                               'that sends this to a reviewer with better '
                                               'tools, and every queued item is read.'},
                            'contradicts': {
                                'type': 'array', 'items': {'type': 'string'},
                                'description': 'Ids of the other rulings shown on this card '
                                               'that this ruling genuinely contradicts. Empty '
                                               'almost always. A contradiction is more likely '
                                               'to be a transcription bug in one of the two '
                                               'than a real change of official position, so '
                                               'flag it, do not resolve it.'},
                            'note': {
                                'type': 'string',
                                'description': 'What a reviewer needs to know. Required when '
                                               'the verdict is not faithful: name the specific '
                                               'discrepancy.'},
                        },
                        'required': ['ruling_id', 'card', 'question_restated',
                                     'answer_polarity', 'licensing_quote', 'verdict',
                                     'confidence'],
                    },
                },
            },
            'required': ['rulings'],
        }},
    }
}


TASK = r"""You are auditing a published database of official Wingspan rulings against its
sources. Each item gives you a ruling as players currently read it on wingsearch, plus the
comment thread it was derived from, with the official reply marked [OFFICIAL].

Your only question is: **does the ruling say what the source said?**

You are not judging whether the ruling is good Wingspan advice, whether it is well written,
or whether you agree with the official answer. A ruling can be clumsy, over-long or
badly ordered and still be `faithful`. Those are other stages' problems.

How to do it, in this order:

1. Read the question the official reply is answering. Follow the parent chain -- the reply
   often quotes nothing, so its meaning is entirely inherited from what was asked.
2. Restate that question as a yes/no question if it is one, and record which way the
   official answer goes. Do this before looking at the ruling text again.
3. Now check the ruling against that. A ruling built on a terse answer can silently
   invert: the answer "it is not part of the main action" answers "is it part of the main
   action?" with a no, and a ruling asserting that it *is* has reversed its own source.
4. Copy out the exact span of the official comment that licenses the ruling's conclusion.
   Character for character, from the [OFFICIAL] comment, no paraphrase, no stitching.
   If you cannot find one, the quote is empty -- and that is itself the finding.

Notes on judging:

- A negation in the answer is usually a caveat, not a reversal. "Nope!" answering "does
  barred owl count for Photographer?" legitimately becomes "does not count toward
  Photographer". Read the pair; do not pattern-match on the word "not".
- An official answer often carries a caveat the ruling had to drop, or covers a narrower
  case than the ruling generalises to. That is `overstated`, not `inverted`, and it
  matters: players use these to settle arguments mid-game.
- Rulings are also shown on cards other than the one that was asked about, when the rule
  transfers. A ruling correctly derived from a thread about a different card is still
  `faithful`; say so in the note.
- Some rulings legitimately combine two official comments, because a curation stage merged
  restatements of one rule. Quote from whichever comment licenses the conclusion.
- If two rulings on the same card genuinely conflict, flag it in `contradicts` and leave it
  alone. Do not decide which is right and do not assume the newer one wins: we have already
  had one case where the apparent conflict was a transcription bug, not a change of policy.

Markup you will see, and should ignore: `\textbf{...}` is a card name, `\textit{...}` is
emphasis, ``...'' are quotes, and `[rodent]`, `[card]`, `[nectar]` and friends are icons."""


def build_system(knowledge):
    return [
        {'text': TASK},
        {'text': 'Reference notes on this database, its trust model and its known failure '
                 'modes. The inverted-transcription section describes the exact bug this '
                 'task exists to find:\n\n' + knowledge},
    ]


def build_user(batch):
    parts = []
    for item in batch:
        parts.append(f'# ruling {item["id"]}  (on card: {item["card"]})')
        if item['kind'] == 'bonus':
            parts.append(f'{item["card"]} is a bonus card. Condition: {item["condition"]}')
        else:
            parts.append(f'{item["card"]} [{item["set"]}, {item["color"]}] '
                         f'power text: {item["power"] or "(no power)"}')
        parts.append(f'\n## The ruling as published\n{item["text"]}')
        parts.append(f'\n## The source thread ({item["page"]})\n{item["thread"]}')
        parts.append(f'\nThe ruling was derived from comment(s) '
                     f'{", ".join(item["comment_ids"])}.')
        if item['siblings']:
            parts.append('\n## Other rulings shown on this card, for contradiction checks only'
                         ' -- do not judge these')
            for s in item['siblings']:
                parts.append(f'- id {s["id"]}: {s["text"]}')
        parts.append('')
    parts.append(f'Return exactly {len(batch)} verdicts, one per ruling, in the order given, '
                 f'using the ruling ids and card names shown.')
    return [{'text': '\n'.join(parts)}]


def verify(client, system, batch, attempt=1):
    try:
        resp = client.converse(
            modelId=MODEL_ID,
            system=system,
            messages=[{'role': 'user', 'content': build_user(batch)}],
            toolConfig={'tools': [VERIFY_TOOL],
                        'toolChoice': {'tool': {'name': 'record_verification'}}},
            inferenceConfig={'maxTokens': 8000},
        )
    except botocore.exceptions.ParamValidationError:
        raise
    except client.exceptions.ValidationException:
        raise
    except Exception as e:
        if attempt >= 5:
            raise
        wait = 2 ** attempt
        log(f'    ! {type(e).__name__}, retrying in {wait}s')
        time.sleep(wait)
        return verify(client, system, batch, attempt + 1)

    out = []
    for block in resp['output']['message']['content']:
        if 'toolUse' in block:
            out = block['toolUse']['input'].get('rulings', [])
    return out, resp['usage']


# --------------------------------------------------------------------------- corpus


def citation_context(db, comment_ids):
    """The part of a thread that determines a ruling's meaning, and nothing else.

    Threads run to twenty-odd comments about unrelated cards, so sending whole ones wastes
    context and buries the pair that matters. What matters is the cited official reply plus
    every ancestor of it: the reply inherits its polarity from the question it answers, and
    that question may itself be a follow-up to an earlier one. Later official replies in the
    same thread are included too, since a publisher sometimes corrects himself downthread.

    Returns (rendered_text, [official comment texts]) -- the second is what check() greps
    for the licensing quote, so it holds exactly the comments the model was told are
    authoritative.
    """
    # `id` and `parent` are ints inside a comment while the corpus dict is keyed by string,
    # so every lookup here goes through str(). Getting this wrong is not loud: it silently
    # skipped the downthread scan below, which is the only thing that finds the official
    # answer when a ruling cites the *question* instead of the reply. Four rulings across
    # four cards did exactly that.
    keep, official = {}, []
    cited = {str(c) for c in comment_ids}
    for cid in cited:
        c = db.get(cid)
        while c:
            keep[str(c['id'])] = c
            c = db.get(str(c['parent'])) if c.get('parent') else None
    for c in db.values():
        # an official reply under anything we kept: the answer to a cited question, or a
        # later self-correction by the publisher
        if c['author'] in rc.TRUSTED and str(c.get('parent') or '') in keep:
            keep[str(c['id'])] = c

    parts = []
    for c in sorted(keep.values(), key=lambda c: c['date']):
        is_official = c['author'] in rc.TRUSTED
        tag = ' [OFFICIAL]' if is_official else ''
        mark = ' <- the ruling cites this comment' if str(c['id']) in cited else ''
        parts.append(f'[{c["date"][:10]}] {c["author"]}{tag}{mark} (comment {c["id"]}):\n'
                     f'{c["text"]}')
        if is_official:
            official.append(c['text'])
    return '\n\n'.join(parts), official


def merged_sources():
    """Surviving ruling id -> comment ids it absorbed but no longer cites.

    A curation merge folds two restatements of one rule into one row, and the row keeps a
    single source URL because the front end binds `[href]="ruling.source"` directly. The
    text is then derived from two official comments while citing one, so verifying it
    against the cited comment alone reports the other half as unlicensed -- which is what
    happened on the first full pass: 10 of 24 `overstated` verdicts were this artifact,
    not a defect in the ruling. `curation.json` recorded every dropped source, so the
    evidence is recoverable without changing the data or the app.
    """
    if not os.path.exists(os.path.join(HERE, 'curation.json')):
        return {}
    plans = json.load(open(os.path.join(HERE, 'curation.json'), encoding='utf-8'))['plans']
    out = collections.defaultdict(list)
    for plan in plans.values():
        if not plan.get('applied'):
            continue
        for s in plan.get('superseded', []):
            m = re.search(r'#comment-(\d+)', s.get('source') or '')
            if m and s.get('merged_into'):
                out[s['merged_into']].append(m.group(1))
    return out


def collect(rows, cards, db, pages):
    """One verifiable item per TSV row that cites a Stonemaier comment we hold."""
    by_card = collections.defaultdict(list)
    for r in rows:
        if r[2].strip():
            by_card[r[2].strip()].append(r)
    absorbed = merged_sources()

    items, skipped = [], collections.Counter()
    for r in rows:
        name = r[2].strip()
        ids = re.findall(r'#comment-(\d+)', r[4]) + absorbed.get(r[0], [])
        have = [i for i in dict.fromkeys(ids) if i in db]
        if not name:
            skipped['general ruling (fanned out by predicate, not per-card)'] += 1
            continue
        if not ids:
            skipped['no Stonemaier comment cited'] += 1
            continue
        if not have:
            skipped['cited comment not in the fetched corpus'] += 1
            continue

        thread, official = citation_context(db, have)
        card = cards.get(name, {})
        post = db[have[0]].get('post')
        items.append({
            'id': r[0],
            'card': name,
            'text': r[3],
            'comment_ids': have,
            'thread': thread,
            'official': official,
            'page': pages.get(str(post), {}).get('title', '?'),
            'kind': card.get('_kind', 'unknown'),
            'set': card.get('Set', '?'),
            'color': card.get('Color', '?'),
            'power': card.get('Power text', ''),
            'condition': card.get('Condition', ''),
            'siblings': [{'id': s[0], 'text': s[3]}
                         for s in by_card[name] if s[0] != r[0]],
        })
    return items, skipped


def signature(item):
    """Fingerprint of what the verdict was based on, so a re-run pays only for changes."""
    h = hashlib.sha256()
    h.update(item['text'].encode('utf-8'))
    h.update('|'.join(item['comment_ids']).encode('utf-8'))
    h.update(item['thread'].encode('utf-8'))
    return h.hexdigest()[:16]


def key(item):
    return f'{item["id"]}@{item["card"]}'


# --------------------------------------------------------------------------- checking


def _norm(s):
    """Whitespace-insensitive, quote-insensitive comparison form.

    The quote has to survive JSON round-tripping and the model's habit of normalising a
    line break to a space, but nothing looser: relaxing this to a fuzzy match would give
    back exactly the wiggle room the gate exists to remove.
    """
    s = s.replace('’', "'").replace('‘', "'")
    s = s.replace('“', '"').replace('”', '"')
    s = s.replace('—', '-').replace('–', '-')
    return re.sub(r'\s+', ' ', s).strip().lower()


# A quote shorter than this does not pin a conclusion on its own -- but that is a fact
# about the *source*, not a defect in the verdict, and the distinction matters. On the
# first full pass all 25 sub-threshold quotes were real spans of a real official comment;
# not one was invented. They were short because the answers are short: "Nope!",
# "Correct.", "Yes, you may." Which is the whole problem -- a terse answer carries no
# direction without its question, so these are the rulings most able to be silently
# inverted. They belong in front of a human, flagged as what they are, not mislabelled as
# possible hallucinations.
MIN_QUOTE = 25


def check(verdict, item):
    """Integrity problems: reasons this verdict cannot be trusted as reported.

    Only hard, mechanical failures go here -- a quote that is not in the source, a missing
    explanation, an invented ruling id. The model is allowed to be wrong about how well a
    ruling reads; it is not allowed to claim support that does not exist. A `faithful`
    verdict landing here is downgraded to `needs-human` by the caller, because that is the
    case where the support may have been hallucinated, which is how an inverted ruling got
    published in the first place.
    """
    problems = []
    quote = (verdict.get('licensing_quote') or '').strip()
    haystack = _norm('\n'.join(item['official']))

    if verdict['verdict'] == 'faithful' and not quote:
        problems.append('verdict is faithful but no licensing quote was given')
    if quote and _norm(quote) not in haystack:
        problems.append('licensing quote is not in the official comment text '
                        '(paraphrased, stitched together, or invented)')
    if verdict['verdict'] != 'faithful' and not (verdict.get('note') or '').strip():
        problems.append('non-faithful verdict with no note explaining the discrepancy')
    for cid in verdict.get('contradicts') or []:
        if cid not in {s['id'] for s in item['siblings']}:
            problems.append(f'contradicts unknown ruling id {cid}')
    return problems


def flags(verdict, item):
    """Routing signals: not defects, but reasons a human should still look.

    Kept separate from `problems` so the report can distinguish "this verdict may be
    fabricated" from "this ruling rests on a source thin enough to be worth re-reading".
    """
    out = []
    quote = (verdict.get('licensing_quote') or '').strip()
    if quote and len(quote) < MIN_QUOTE:
        out.append(f'terse source: the licensing quote is {len(quote)} chars '
                   f'({quote!r}), so the ruling\'s direction rests on the question')
    if verdict.get('answer_polarity') == 'qualified' and verdict['verdict'] == 'faithful':
        out.append('official answer was qualified; check the caveat survived into the ruling')
    return out


SETTLED = 'faithful'


def is_settled(v):
    """Verdicts needing no human attention at all."""
    return (v['verdict'] == SETTLED and v['confidence'] == 'high'
            and not v['problems'] and not v.get('flags') and not v.get('contradicts'))


# --------------------------------------------------------------------------- store


def load_store():
    if os.path.exists(OUT_PATH):
        return json.load(open(OUT_PATH, encoding='utf-8'))
    return {'verdicts': {}}


def save(store):
    store['verdicts'] = dict(sorted(store['verdicts'].items()))
    tmp = OUT_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(store, f, indent=2, ensure_ascii=False, sort_keys=False)
        f.write('\n')
    os.replace(tmp, OUT_PATH)


# --------------------------------------------------------------------------- reporting


def rederive(items, store):
    """Recompute problems/flags from stored verdicts, without calling the model.

    The verdicts hold everything `check()` and `flags()` need, so changing what counts as
    a defect is a local reclassification -- there is no reason to pay for 356 rulings again
    to move a threshold. Restores any verdict this script previously overwrote.
    """
    by = {key(i): i for i in items}
    changed = 0
    for k, v in store['verdicts'].items():
        item = by.get(k)
        if not item:
            continue
        if 'claimed_verdict' in v:
            v['verdict'] = v.pop('claimed_verdict')
        before = (v['verdict'], tuple(v.get('problems') or ()), tuple(v.get('flags') or ()))
        v['problems'] = check(v, item)
        v['flags'] = flags(v, item)
        if v['verdict'] == 'faithful' and v['problems']:
            v['claimed_verdict'] = 'faithful'
            v['verdict'] = 'needs-human'
        if before != (v['verdict'], tuple(v['problems']), tuple(v['flags'])):
            changed += 1
    return changed


def report(items, store, skipped):
    v = store['verdicts']
    done = [v[key(i)] for i in items if key(i) in v]
    print(f'{len(items)} rulings verifiable against a held source, {len(done)} judged\n')

    if done:
        print('verdicts')
        for name, n in collections.Counter(d['verdict'] for d in done).most_common():
            print(f'{n:5d}  {name}')

        settled = [d for d in done if is_settled(d)]
        print(f'\n{len(settled)} settled: faithful, high confidence, and the licensing quote '
              f'checked out against the official comment.')
        print(f'{sum(1 for d in done if d["problems"])} failed the integrity gate '
              f'(quote not in source, or no explanation given)')

        queued = [d for d in done if not is_settled(d)]
        print(f'{len(queued)} queued for review, by reason:')
        reasons = collections.Counter()
        for d in queued:
            if d['problems']:
                reasons['integrity gate failed'] += 1
            elif d['verdict'] != 'faithful':
                reasons[f'verdict: {d["verdict"]}'] += 1
            elif d.get('contradicts'):
                reasons['contradicts another ruling'] += 1
            elif d['confidence'] != 'high':
                reasons[f'confidence: {d["confidence"]}'] += 1
            else:
                reasons[(d.get('flags') or ['flagged'])[0].split(':')[0]] += 1
        for name, n in reasons.most_common():
            print(f'{n:5d}  {name}')

        contra = [d for d in done if d.get('contradicts')]
        if contra:
            print(f'\ncontradictions flagged ({len(contra)}) -- check both against source '
                  f'before believing either')
            for d in contra:
                print(f'  {d["ruling_id"]} {d["card"]} vs {", ".join(d["contradicts"])}')
                print(f'       {(d.get("note") or "")[:160]}')

        for name, pred in (
            ('overstated -- broader or more certain than the source warrants',
             lambda d: d['verdict'] == 'overstated'),
            ('unsupported / inverted -- the source does not say this',
             lambda d: d['verdict'] in ('unsupported', 'inverted')),
            ('needs-human -- the model could not tell',
             lambda d: d['verdict'] == 'needs-human'),
        ):
            group = [d for d in done if pred(d)]
            if not group:
                continue
            print(f'\n{name} ({len(group)})')
            for d in group:
                print(f'  {d["ruling_id"]:<12} {d["card"][:28]:<29} {d["confidence"]}')
                if d.get('note'):
                    print('\n'.join(textwrap.wrap(d['note'], 92,
                                                  initial_indent='       ',
                                                  subsequent_indent='       ')))

    if skipped:
        print('\nnot verifiable this way (no source we hold)')
        for name, n in skipped.most_common():
            print(f'{n:5d}  {name}')
        print('       -- reviewable for internal consistency, never against a source.')


# --------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cards', help='comma-separated card names to verify')
    ap.add_argument('--rulings', help='comma-separated ruling ids to verify')
    ap.add_argument('--limit', type=int, help='cap rulings judged (for validation)')
    ap.add_argument('--recheck', action='store_true',
                    help='re-judge rulings already verified')
    ap.add_argument('--dry-run', action='store_true', help='list the work, call nothing')
    ap.add_argument('--report', action='store_true', help='summarise the stored verdicts')
    ap.add_argument('--rederive', action='store_true',
                    help='recompute problems and flags from stored verdicts, no model calls')
    args = ap.parse_args()

    db = json.load(open(rc.COMMENTS_PATH, encoding='utf-8'))
    comments, pages = db['comments'], db['pages']
    rows = [l.rstrip('\n').split('\t') for l in open(rc.TSV_PATH, encoding='utf-8')]
    rows = [r for r in rows if len(r) == 5]
    items, skipped = collect(rows, rc.load_cards(), comments, pages)
    store = load_store()

    if args.rederive:
        n = rederive(items, store)
        save(store)
        print(f'reclassified {n} verdict(s) from stored data, no model calls')
        return

    if args.report:
        report(items, store, skipped)
        return

    todo = items
    if args.cards:
        want = {c.strip() for c in args.cards.split(',')}
        todo = [i for i in todo if i['card'] in want]
    if args.rulings:
        want = {c.strip() for c in args.rulings.split(',')}
        todo = [i for i in todo if i['id'] in want]
    if not args.recheck:
        todo = [i for i in todo
                if store['verdicts'].get(key(i), {}).get('signature') != signature(i)]
    if args.limit:
        todo = todo[:args.limit]

    calls = (len(todo) + BATCH - 1) // BATCH
    print(f'{len(todo)} rulings to verify in {calls} calls '
          f'({len(items)} verifiable, {len(items) - len(todo)} unchanged since last run)')
    if args.dry_run or not todo:
        if skipped:
            print(f'{sum(skipped.values())} rows cannot be verified against a held source')
        return

    client = boto3.Session(region_name=REGION).client('bedrock-runtime')
    system = build_system(open(KNOWLEDGE_PATH, encoding='utf-8').read())
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    by_key = {key(i): i for i in todo}
    usage = collections.Counter()
    started = time.time()
    n_done = [0]

    def run(batch):
        out, u = verify(client, system, batch, )
        with _lock:
            usage['in'] += u['inputTokens']
            usage['out'] += u['outputTokens']
            got = {f'{v["ruling_id"]}@{v["card"]}' for v in out}
            expected = {key(i) for i in batch}
            for v in out:
                k = f'{v["ruling_id"]}@{v["card"]}'
                item = by_key.get(k)
                if not item:
                    log(f'    ! verdict for unrequested {k}, dropped')
                    continue
                v['problems'] = check(v, item)
                v['flags'] = flags(v, item)
                if v['verdict'] == 'faithful' and v['problems']:
                    # Integrity gate fired. Do not let it pass as verified; a human decides.
                    v['claimed_verdict'] = 'faithful'
                    v['verdict'] = 'needs-human'
                v['signature'] = signature(item)
                v['model'] = MODEL_ID
                v['comment_ids'] = item['comment_ids']
                store['verdicts'][k] = v
            for miss in expected - got:
                log(f'    ! no verdict returned for {miss}')
            n_done[0] += len(batch)
            log(f'  [{n_done[0]}/{len(todo)}] '
                f'{sum(1 for v in store["verdicts"].values() if is_settled(v))} settled so far')

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(run, batches))

    save(store)
    cost = usage['in'] / 1000 * PRICE_IN + usage['out'] / 1000 * PRICE_OUT
    done = [store['verdicts'][key(i)] for i in todo if key(i) in store['verdicts']]
    print(f'\ndone in {time.time() - started:.0f}s -> {OUT_PATH}')
    for name, n in collections.Counter(d['verdict'] for d in done).most_common():
        print(f'{n:5d}  {name}')
    print(f'{sum(1 for d in done if d["problems"])} failed the licensing-quote gate, '
          f'{sum(1 for d in done if d.get("contradicts"))} flagged a contradiction')
    print(f'tokens in {usage["in"]} out {usage["out"]}  ~${cost:.2f}')
    print('\nread the queue: python3 verify.py --report')


if __name__ == '__main__':
    main()
