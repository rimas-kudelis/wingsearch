#!/usr/bin/env python3
"""Curate the rulings list a single card shows: reorder, merge, rewrite.

`propose_rulings.py` judges one FAQ thread at a time, so it cannot see what a card's
page ends up looking like. The result is visible on `Green Heron`, which accumulated
seven rulings where four of them restate "trading counts as spending" and the one that
overturns a previously published answer sits last.

This script fixes that per card. It shows Claude every ruling a card has at once and
asks for the list a player should actually see: deduplicated, ordered least-obvious
first, each entry short enough to scan mid-game. Only three operations are allowed --
reorder, merge, rewrite -- so no ruling can be silently dropped and none can be
invented.

Output is `rulings-curation.json`, a reviewable plan per card. `--apply` rewrites
`Wingspan - Rulings.tsv` in place from the plans; the git diff is the review surface.

    export AWS_PROFILE=...
    python3 curate_rulings.py --dry-run
    python3 curate_rulings.py --cards 'Green Heron'      # try one first, and read it
    python3 curate_rulings.py --apply --diff             # show what would change
    python3 curate_rulings.py --apply

Ordering intent and the reader model come from rulings-domain-knowledge.md section 7.
"""

import argparse
import collections
import difflib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
import botocore.exceptions

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rulings_corpus as rc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, 'rulings-curation.json')
KNOWLEDGE_PATH = os.path.join(HERE, 'rulings-domain-knowledge.md')
ICON_DIR = os.path.join(HERE, '..', 'src', 'assets', 'icons', 'png')
MASTER_PATH = os.path.join(HERE, '..', 'src', 'assets', 'data', 'master.json')

MODEL_ID = 'us.anthropic.claude-opus-5'
REGION = os.environ.get('AWS_REGION') or 'us-east-1'
BATCH = 3                      # cards per call; a card's whole list has to fit in view
WORKERS = 4
PRICE_IN, PRICE_OUT = 0.005, 0.025

# See propose_rulings.py: log() takes this lock, and the merge block below logs while
# holding it, so a plain Lock deadlocks the pool on the first completed call.
_lock = threading.RLock()


def log(*a):
    with _lock:
        print(*a, flush=True)


CURATION_TOOL = {
    'toolSpec': {
        'name': 'record_curation',
        'description': 'Record one entry per card presented, in order.',
        'inputSchema': {'json': {
            'type': 'object',
            'properties': {
                'cards': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'card': {'type': 'string',
                                     'description': 'The card name given, verbatim.'},
                            'entries': {
                                'type': 'array',
                                'description': 'This card\'s final rulings list, in display '
                                               'order: first = the one a good player is most '
                                               'likely to get wrong, last = the one that only '
                                               'confirms the obvious reading.',
                                'items': {
                                    'type': 'object',
                                    'properties': {
                                        'ids': {
                                            'type': 'array', 'items': {'type': 'string'},
                                            'description': 'Ruling ids this entry is built '
                                                           'from. One id = kept or rewritten. '
                                                           'Several = merged, allowed only '
                                                           'when they state the same rule.'},
                                        'text': {
                                            'type': 'string',
                                            'description': 'Final text. Copy the original '
                                                           'verbatim unless rewriting is a '
                                                           'clear improvement.'},
                                        'rewritten': {
                                            'type': 'boolean',
                                            'description': 'True if text differs from the '
                                                           'original(s) in any way.'},
                                        'reason': {
                                            'type': 'string',
                                            'description': 'Why this rank, and why merged or '
                                                           'rewritten. One line.'},
                                    },
                                    'required': ['ids', 'text', 'rewritten', 'reason'],
                                },
                            },
                            'confidence': {
                                'type': 'string', 'enum': ['high', 'medium', 'low'],
                                'description': 'high = every change is plainly safe and the '
                                               'ordering is clear; lower it if you had to '
                                               'judge whether two rulings really say the same '
                                               'thing, or if a rewrite risks meaning.'},
                            'note': {
                                'type': 'string',
                                'description': 'Anything a human reviewer should know: two '
                                               'rulings that appear to contradict each other, '
                                               'one that looks superseded, a merge you '
                                               'wanted to make but could not.'},
                        },
                        'required': ['card', 'entries', 'confidence'],
                    },
                },
            },
            'required': ['cards'],
        }},
    }
}


TASK = r"""You are curating the official-rulings list shown on a card's page in
navarog.github.io/wingsearch, a Wingspan reference players open mid-game to settle an
argument.

Picture that reader: it is someone's turn, a rule is disputed, and they are scanning a
phone. They need the sentence that answers them to be findable in a couple of seconds.
Long entries, four restatements of one rule, and the surprising ruling buried at the
bottom all fail them. **Your goal is a list that is correct, fast to scan, and easy to
understand -- in that order of priority.**

For each card you are given its power text and every ruling currently attached to it.
Return the list as it should appear. You have exactly three operations:

**Reorder.** Least obvious first. The ruling a competent player is most likely to get
*wrong* about this card goes at the top; a ruling that only confirms the obvious reading
of the card goes at the bottom. Signals, strongest first:

- It contradicts a natural reading of the card text, or reverses an earlier official
  answer.
- It resolves an interaction with another card, or with a mechanic from a later
  expansion ([nectar], hummingbirds, the reset birdfeeder).
- It settles a timing or "does this trigger?" question.
- It restates a rule that applies to the whole game and is not special to this card.
- It says an option is unavailable on a card where it never looked available anyway.

**Merge.** Two or more rulings that state *the same rule* become one entry: list all
their ids in `ids`. Only do this when they are genuinely restatements -- four threads
answering the same question in different years is the common case. Rulings that state
*different* facts stay separate even when they are on the same theme: several short
entries scan faster than one paragraph that buries three rules. Never merge to shorten.

A merged entry keeps one source link, so it must be true to *every* source it absorbs. If
two answers differ in substance rather than phrasing, that is not a restatement: keep them
apart and flag the discrepancy in `note`.

**Rewrite.** Improve wording within an entry: lead with the answer rather than the
setup, cut scaffolding ("Note that", "In this case", "It should be pointed out that"),
prefer one sentence, and keep it under about 200 characters unless the rule genuinely
needs more. Set `rewritten` true whenever the text differs at all.

Nothing else is permitted. You may not delete a ruling, add a ruling, or invent a fact
that no source states. Every id you are given must appear in exactly one entry.

**Correctness outranks everything.** These are published official answers and players
rely on them to be exactly what the publisher said. Never broaden a ruling, never
sharpen a hedge into a rule, never resolve an ambiguity the source left open, and never
merge two rulings by picking the stronger of two readings. If you cannot make an entry
clearer without risking its meaning, keep the original text and say so in `reason`.
Leave text alone when it is already good: needless churn costs a human review pass.

**Some rulings are marked [also on N cards].** One official answer often settles a
question for several birds, so the same ruling id is attached to each of them -- but each
card stores its own wording, and the corpus already uses that: one nest ruling appears as
[cavity]/[star] on one bird, [ground]/[star] on another and [bowl]/[star] on a third.
Everything you do is therefore local to the card in front of you: your edits never touch
the other cards' copies.

Use the marker as a ranking signal instead. A ruling attached to nine other birds is
answering a general question rather than something peculiar to this card, which usually
means it belongs lower in the list. And because the wording is card-local, "this bird" can
become the card's actual name where that reads better -- the reader is on that card's page
either way, but the name scans faster.

**Rulings under "also shown on this page" are read-only context.** They are generic
rules attached by predicate and this pipeline cannot touch them. Use them for ranking:
if one of this card's own rulings merely repeats one of them, rank it last.

**Formatting.** Match the corpus exactly, and preserve these markers when rewriting:

- Card names are bold: `\textbf{Green Heron}`. Bold every card name you mention.
- Quoted card or rulebook text uses TeX quotes: ``like this''.
- `\textbf` and `\textit` are the *only* commands the renderer understands. Anything else
  reaches the player as literal text, so write a plain hyphen or comma rather than
  `\textendash`, and never use curly quotes.
- Resources and habitats use `[icon]` markers: [egg], [card], [invertebrate], [seed],
  [fish], [fruit], [rodent], [wild], [nectar], [die], [forest], [grassland], [wetland],
  [cavity], [ground], [platform], [bowl], [star]. Never invent a marker -- an icon the
  app does not ship reaches the player as the literal text "[food]".

Set `confidence` per card, and use `note` for anything a reviewer should see: two
rulings that seem to contradict each other, one that looks superseded by a rules change,
or a merge the [shared] restriction stopped you from making."""


def build_system(knowledge):
    return [
        {'text': TASK},
        {'text': 'Reference notes on this database, its trust model, its known failure modes, '
                 'and the ordering intent this task implements (section 7):\n\n' + knowledge},
    ]


def build_user(batch):
    parts = []
    for c in batch:
        head = f'# {c["name"]}'
        if c['kind'] == 'bonus':
            parts.append(head + '  [bonus card]')
            parts.append(f'Condition: {c["condition"]}')
        else:
            parts.append(head + f'  [{c["set"]}, {c["color"]}]')
            parts.append(f'Power text: {c["power"] or "(no power)"}')
        parts.append(f'\n## Rulings on this card, in the order they currently appear '
                     f'({len(c["rulings"])})')
        for r in c['rulings']:
            tag = ''
            if r['shared_with']:
                tag = (f'  [also on {len(r["shared_with"])} card(s): '
                       f'{", ".join(r["shared_with"][:6])}]')
            parts.append(f'- id {r["id"]}{tag}\n  {r["text"]}')
        if c['general']:
            parts.append('\n## Also shown on this page, read-only (generic rulings attached '
                         'by predicate)')
            for t in c['general']:
                parts.append(f'- {t}')
        parts.append('')
    parts.append('Return exactly one entry per card, in the order given, using the card names '
                 'and ruling ids shown. Every id must appear in exactly one entry.')
    return [{'text': '\n'.join(parts)}]


def curate(client, system, batch, attempt=1):
    try:
        resp = client.converse(
            modelId=MODEL_ID,
            system=system,
            messages=[{'role': 'user', 'content': build_user(batch)}],
            toolConfig={'tools': [CURATION_TOOL],
                        'toolChoice': {'tool': {'name': 'record_curation'}}},
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
        return curate(client, system, batch, attempt + 1)

    out = []
    for block in resp['output']['message']['content']:
        if 'toolUse' in block:
            out = block['toolUse']['input'].get('cards', [])
    return out, resp['usage']


# --------------------------------------------------------------------------- corpus


def read_rows():
    """The TSV as (raw_line, fields) pairs. Raw lines are kept so untouched rows are
    rewritten byte-identically -- the file is hand-maintained and a reformatting diff
    would bury the real change."""
    text = open(rc.TSV_PATH, encoding='utf-8').read()
    lines = text.split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    rows = []
    for i, line in enumerate(lines, 1):
        f = line.split('\t')
        if len(f) != 5:
            raise SystemExit(f'{rc.TSV_PATH}:{i}: expected 5 tab-separated fields, got {len(f)}')
        rows.append(f)
    return rows


def write_rows(rows):
    tmp = rc.TSV_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('\n'.join('\t'.join(r) for r in rows) + '\n')
    os.replace(tmp, rc.TSV_PATH)


def general_by_card():
    """Card name -> the generic ruling texts already displayed on its page.

    Read from the built master.json rather than recomputed from the predicates: what
    matters here is what a player currently sees, and that is what shipped.
    """
    out = {}
    for c in json.load(open(MASTER_PATH, encoding='utf-8')):
        out[c['Common name']] = [re.sub(r'<[^>]+>', '', r['text'])
                                 for r in c.get('additionalRulings') or []]
    return out


def collect(rows, cards, general):
    """Cards with more than one bird-specific ruling, in TSV order."""
    by_card = collections.OrderedDict()
    id_cards = collections.defaultdict(set)
    for r in rows:
        name = r[2].strip()
        if not name:
            continue
        id_cards[r[0]].add(name)
        by_card.setdefault(name, []).append(r)

    out = []
    for name, rs in by_card.items():
        card = cards.get(name, {})
        out.append({
            'name': name,
            'kind': card.get('_kind', 'unknown'),
            'set': card.get('Set', '?'),
            'color': card.get('Color', '?'),
            'power': card.get('Power text', ''),
            'condition': card.get('Condition', ''),
            'general': general.get(name, []),
            'rulings': [{'id': r[0], 'text': r[3], 'source': r[4],
                         'shared_with': sorted(id_cards[r[0]] - {name})} for r in rs],
        })
    return out


def signature(card):
    """Fingerprint of a card's input rulings, so a re-run re-curates only what changed."""
    return '|'.join(f'{r["id"]}:{r["text"]}' for r in card['rulings'])


# --------------------------------------------------------------------------- checking


def check(plan, card, icons):
    """Reasons this plan must not be applied. Empty list means it is safe.

    Everything here is a hard structural guarantee rather than a judgement: the model is
    allowed to be wrong about *which* order is best, but it is not allowed to lose a
    ruling, invent an id, or emit markup that renders literally.
    """
    problems = []
    have = [r['id'] for r in card['rulings']]
    used = [i for e in plan['entries'] for i in e.get('ids', [])]

    missing = [i for i in have if i not in used]
    unknown = [i for i in used if i not in have]
    dupes = [i for i, n in collections.Counter(used).items() if n > 1]
    if missing:
        problems.append(f'drops ruling(s) {", ".join(missing)}')
    if unknown:
        problems.append(f'invents ruling id(s) {", ".join(unknown)}')
    if dupes:
        problems.append(f'uses id(s) {", ".join(dupes)} more than once')

    for e in plan['entries']:
        t = e.get('text', '')
        if not t.strip():
            problems.append(f'empty text for {", ".join(e.get("ids", ["?"]))}')
        for name in re.findall(r'\[([a-z0-9 _-]+)\]', t):
            if name not in icons:
                problems.append(f'unknown icon marker [{name}]')
        if t.count('{') != t.count('}'):
            problems.append('unbalanced braces')
        for cmd in set(re.findall(r'\\([a-zA-Z]+)', t)):
            if cmd not in ('textbf', 'textit'):
                problems.append(rf'unsupported TeX command \{cmd}')
        if re.search(r'[‘’“”]', t):
            problems.append('curly quotes (corpus uses ``TeX quotes\'\')')
    return problems


def warnings(plan, card):
    """Things that are legal but want a human eye, so they hold back auto-apply."""
    out = []
    orig = {r['id']: r['text'] for r in card['rulings']}
    for e in plan['entries']:
        ids = e.get('ids', [])
        if len(ids) != 1:
            continue                  # a merge legitimately grows past either input
        was, now = orig.get(ids[0], ''), e.get('text', '')
        # A rewrite that grows is the shape of an addition, and adding is the one edit
        # that can put words in the publisher's mouth.
        if now != was and len(now) > len(was) * 1.4 + 20:
            out.append(f'{ids[0]}: rewrite grew {len(was)} -> {len(now)} chars')
    return out


def notices(plan, card):
    """Informational, does not hold anything back: rewrites that stopped mentioning a
    card the original named.

    Usually correct and the point of the exercise -- one official answer covering two
    birds is stored on both, and each copy should keep the half about its own card, so
    `Sandhill Crane` losing its \\textbf{Blue Jay} sentence is an improvement because
    \\textbf{Blue Jay}'s own row still carries it. But it is also the shape of real
    content loss, so it is worth being able to grep for.
    """
    out = []
    orig = {r['id']: r['text'] for r in card['rulings']}
    for e in plan['entries']:
        gone = set()
        for i in e.get('ids', []):
            gone |= set(re.findall(r'\\textbf\{([^}]*)\}', orig.get(i, '')))
        gone -= set(re.findall(r'\\textbf\{([^}]*)\}', e.get('text', '')))
        for name in sorted(gone - {card['name']}):
            out.append(f'{",".join(e["ids"])}: no longer mentions {name}')
    return out


# --------------------------------------------------------------------------- applying


def apply_plans(store, cards, general, levels, dry_run, with_warnings=False):
    """Rewrite the TSV from every plan that is safe and not yet applied.

    A card's rows are spliced back in at the position of its first current row, so the
    diff stays where a reader expects it. 127 of the 272 cards have their rows split
    across two blocks of the file (the pre-2026 corpus and this year's additions), and
    consolidating them is a side effect worth having.

    Only this card's rows are touched. A ruling id attached to several cards stores its
    own text per card -- deliberately, since one nest ruling ships as [cavity]/[star] on
    one bird and [bowl]/[star] on another -- so nothing here propagates.
    """
    rows = read_rows()
    changed = []

    for name, plan in sorted(store['plans'].items()):
        if plan.get('applied') or plan.get('problems') or plan['confidence'] not in levels:
            continue
        if plan.get('warnings') and not with_warnings:
            log(f'  ~ {name}: held back ({"; ".join(plan["warnings"])})')
            continue
        cur = collect(rows, cards, general)
        card = next((c for c in cur if c['name'] == name), None)
        if card is None:
            continue
        if signature(card) != plan['signature']:
            log(f'  ! {name}: rulings changed since it was curated, skipping')
            continue

        by_id = {r['id']: r for r in card['rulings']}
        new_rows, superseded = [], []
        for e in plan['entries']:
            # The id is the source comment's date, so the surviving id must be the one
            # belonging to the surviving link. Keep the most recent: when two official
            # answers say the same thing, the later one is the citable one.
            keep = max(e['ids'])
            for gone in sorted(set(e['ids']) - {keep}):
                superseded.append({'id': gone, 'source': by_id[gone]['source'],
                                   'merged_into': keep})
            new_rows.append([keep, '', name, ' '.join(e['text'].split()),
                             by_id[keep]['source']])

        # Nothing is removed before mine[0], so it indexes the same place in `rest`.
        mine = {i for i, r in enumerate(rows) if r[2].strip() == name}
        at = min(mine)
        rest = [r for i, r in enumerate(rows) if i not in mine]
        rows = rest[:at] + new_rows + rest[at:]

        plan['superseded'] = superseded
        plan['applied'] = not dry_run
        changed.append(name)

    if not changed:
        log('nothing to apply: no safe, unapplied plans at '
            f'confidence {"/".join(sorted(levels))}')
    elif not dry_run:
        write_rows(rows)
    return rows, changed


def diff_for(before, after, names):
    """Unified diff of the rows belonging to the given cards, for eyeballing."""
    out = []
    for name in names:
        a = [f'{r[0]}\t{r[3]}' for r in before if r[2].strip() == name]
        b = [f'{r[0]}\t{r[3]}' for r in after if r[2].strip() == name]
        out.extend(difflib.unified_diff(a, b, fromfile=f'{name} (now)',
                                        tofile=f'{name} (curated)', lineterm='', n=0))
    return out


def save(store):
    tmp = OUT_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(store, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write('\n')
    os.replace(tmp, OUT_PATH)


# --------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cards', help='comma-separated card names to curate')
    ap.add_argument('--cards-file', help='file of card names, one per line; "-" for stdin. '
                                         'Used by refresh_rulings.sh to curate only the '
                                         'cards that just gained a ruling.')
    ap.add_argument('--min', type=int, default=2,
                    help='minimum rulings on a card to be worth curating (default 2)')
    ap.add_argument('--limit', type=int, help='cap cards curated (for validation)')
    ap.add_argument('--recheck', action='store_true', help='re-curate cards already planned')
    ap.add_argument('--dry-run', action='store_true', help='list the work, call nothing')
    ap.add_argument('--apply', action='store_true', help='rewrite the TSV from stored plans')
    ap.add_argument('--diff', action='store_true', help='with --apply, print the diff and '
                                                        'do not write')
    ap.add_argument('--confidence', default='high',
                    help='comma-separated levels --apply will act on (default high)')
    ap.add_argument('--with-warnings', action='store_true',
                    help='also apply plans carrying warnings, which are held back by '
                         'default (a rewrite that grew, or one to text shared with other '
                         'cards that were curated in a different call)')
    args = ap.parse_args()

    cards = rc.load_cards()
    general = general_by_card()
    store = ({'plans': {}} if not os.path.exists(OUT_PATH)
             else json.load(open(OUT_PATH, encoding='utf-8')))

    if args.apply:
        levels = {s.strip() for s in args.confidence.split(',') if s.strip()}
        before = read_rows()
        after, changed = apply_plans(store, cards, general, levels,
                                     args.dry_run or args.diff, args.with_warnings)
        if args.diff:
            for line in diff_for(before, after, changed):
                print(line)
        if changed and not (args.diff or args.dry_run):
            save(store)
            log(f'applied {len(changed)} plan(s) to {os.path.relpath(rc.TSV_PATH)}')
            log('  re-run json-transformer.ipynb, then npm run test:ci')
        elif changed:
            log(f'\n{len(changed)} plan(s) would change: {", ".join(changed)}')
        return

    wanted = None
    if args.cards:
        wanted = {n.strip() for n in args.cards.split(',') if n.strip()}
    if args.cards_file:
        src = sys.stdin if args.cards_file == '-' else open(args.cards_file, encoding='utf-8')
        wanted = (wanted or set()) | {l.strip() for l in src if l.strip()}

    work = []
    for c in collect(read_rows(), cards, general):
        if wanted is not None and c['name'] not in wanted:
            continue
        if len(c['rulings']) < args.min:
            continue
        plan = store['plans'].get(c['name'])
        if plan and not args.recheck and plan['signature'] == signature(c):
            continue
        work.append(c)
    if args.limit:
        work = work[:args.limit]

    batches = [work[i:i + BATCH] for i in range(0, len(work), BATCH)]
    log(f'{len(work)} cards to curate in {len(batches)} calls ({MODEL_ID} in {REGION})')
    if args.dry_run or not work:
        for c in work[:15]:
            log(f'  {c["name"]:<28} {len(c["rulings"])} rulings, '
                f'{len(c["general"])} generic')
        if len(work) > 15:
            log(f'  ... and {len(work) - 15} more')
        return

    icons = {f.rsplit('.', 1)[0] for f in os.listdir(ICON_DIR)}
    system = build_system(open(KNOWLEDGE_PATH, encoding='utf-8').read())
    client = boto3.client('bedrock-runtime', region_name=REGION)
    by_name = {c['name']: c for c in work}
    usage = {'inputTokens': 0, 'outputTokens': 0}
    done = [0]

    def run(batch):
        plans, u = curate(client, system, batch)
        with _lock:
            for p in plans:
                card = by_name.get(p.get('card'))
                if card is None:
                    log(f'    ! unknown card {p.get("card")!r}, ignoring')
                    continue
                problems = check(p, card, icons)
                store['plans'][card['name']] = {
                    'card': card['name'],
                    'signature': signature(card),
                    'entries': p['entries'],
                    'confidence': p.get('confidence', 'low'),
                    'note': p.get('note', ''),
                    'problems': problems,
                    'warnings': warnings(p, card),
                    'notices': notices(p, card),
                    'before': [{'id': r['id'], 'text': r['text']} for r in card['rulings']],
                    'applied': False,
                    'model': MODEL_ID,
                }
                if problems:
                    log(f'    ! {card["name"]}: {"; ".join(problems)}')
            for k in usage:
                usage[k] += u.get(k, 0)
            done[0] += 1
            merged = sum(len(e['ids']) - 1 for p in plans for e in p.get('entries', []))
            log(f'  [{done[0]}/{len(batches)}] {len(plans)} cards -> {merged} merged away')
            if done[0] % 10 == 0:
                save(store)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(run, batches))
    save(store)

    plans = [p for p in store['plans'].values() if p['signature'] in
             {signature(c) for c in work}]
    ok = [p for p in plans if not p['problems']]
    merged = sum(len(e['ids']) - 1 for p in ok for e in p['entries'])
    rewritten = sum(1 for p in ok for e in p['entries'] if e['rewritten'])
    reordered = sum(1 for p in ok
                    if [i for e in p['entries'] for i in e['ids']]
                    != [b['id'] for b in p['before']])
    cost = usage['inputTokens'] / 1000 * PRICE_IN + usage['outputTokens'] / 1000 * PRICE_OUT
    log(f'\ndone in {time.time() - t0:.0f}s -> {os.path.relpath(OUT_PATH)}')
    log(f'  {len(plans)} plans, {len(plans) - len(ok)} rejected as unsafe')
    log(f'  {merged} rulings merged away, {rewritten} entries rewritten, '
        f'{reordered} cards reordered')
    log(f'  {sum(1 for p in ok if p["confidence"] == "high")} high confidence, '
        f'{sum(1 for p in ok if p["warnings"])} carrying warnings, '
        f'{sum(len(p["notices"]) for p in ok)} dropped card mentions (see "notices")')
    for p in ok:
        for w in p['warnings']:
            log(f'  ~ {p["card"]}: {w}')
    log(f'  tokens in {usage["inputTokens"]} out {usage["outputTokens"]}  ~${cost:.2f}')
    log(f'\nreview {os.path.relpath(OUT_PATH)}, then: '
        f'python3 curate_rulings.py --apply --diff')


if __name__ == '__main__':
    main()
