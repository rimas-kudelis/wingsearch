#!/usr/bin/env python3
"""Propose new rulings from official Stonemaier FAQ answers.

Reads the threads fetched by `fetch_stonemaier.py`, keeps the ones where a
trusted author answered (`corpus.TRUSTED`), and asks Claude on Bedrock
whether each thread contains a ruling worth adding to `rulings.tsv` --
given the rulings that card already has, so duplicates are rejected rather than
piled on.

Output is `proposals.json`: a reviewable queue, never a direct edit of
the TSV. Accepting a proposal is a human step (`--emit-tsv` prints rows to
paste). This is deliberate: a wrong ruling is worse than a missing one, because
players use the site to settle arguments.

    export AWS_PROFILE=...
    python3 propose.py --dry-run
    python3 propose.py --limit 10        # validate on a few first
    python3 propose.py --set asia        # target the coverage gap
    python3 propose.py --emit-tsv        # print accepted rows

See domain-knowledge.md for the trust model and the standards applied.
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
import corpus as rc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, 'proposals.json')
KNOWLEDGE_PATH = os.path.join(HERE, 'domain-knowledge.md')
CURATION_PATH = os.path.join(HERE, 'curation.json')
REJECTIONS_PATH = os.path.join(HERE, 'rejections.json')
EXTRA_CITATIONS_PATH = os.path.join(HERE, 'extra-citations.json')
ICON_DIR = os.path.join(HERE, '..', '..', 'src', 'assets', 'icons', 'png')

MODEL_ID = 'us.anthropic.claude-opus-5'
REGION = os.environ.get('AWS_REGION') or 'us-east-1'
BATCH = 4                      # threads per call; they are long, unlike single cards
WORKERS = 4
PRICE_IN, PRICE_OUT = 0.005, 0.025

# Reentrant on purpose: the result-merging block below logs while holding it, and a
# plain Lock deadlocks the whole pool the moment the first call returns.
_lock = threading.RLock()


def log(*a):
    with _lock:
        print(*a, flush=True)


PROPOSAL_TOOL = {
    'toolSpec': {
        'name': 'record_proposals',
        'description': 'Record one entry per thread presented, in order.',
        'inputSchema': {'json': {
            'type': 'object',
            'properties': {
                'proposals': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'thread': {'type': 'integer', 'description': 'The thread id given.'},
                            'source_comment': {
                                'type': 'integer',
                                'description': 'Id of the [OFFICIAL] comment that settles '
                                               'this ruling. Not necessarily the last one: '
                                               'a thread can hold several unrelated '
                                               'questions.'},
                            'is_ruling': {
                                'type': 'boolean',
                                'description': 'True only if this settles a rules question '
                                               'about cards or gameplay.'},
                            'reject_reason': {
                                'type': 'string',
                                'description': 'If is_ruling is false, why in a few words.'},
                            'scope': {
                                'type': 'string', 'enum': ['card', 'general', 'none'],
                                'description': 'card = about specific named cards; '
                                               'general = a rule that holds across cards.'},
                            'cards': {
                                'type': 'array', 'items': {'type': 'string'},
                                'description': 'Common names from this thread that the ruling '
                                               'demonstrably applies to, copied verbatim. '
                                               'Fill this for general rulings too.'},
                            'title': {
                                'type': 'string',
                                'description': 'Short title, general rulings only (e.g. "Copy", '
                                               '"Once between turns").'},
                            'text': {
                                'type': 'string',
                                'description': 'The ruling, written as a standalone statement '
                                               'in the house style. No question, no "Jamey '
                                               'says". Use [icon] markers.'},
                            'duplicates': {
                                'type': 'string',
                                'description': 'If an existing ruling shown to you already '
                                               'covers this, quote enough of it to identify '
                                               'it. Empty if genuinely new.'},
                            'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
                            'note': {
                                'type': 'string',
                                'description': 'Anything a human reviewer should know: '
                                               'ambiguity, a mechanic that changed since, '
                                               'an answer that seems to contradict the rules.'},
                        },
                        'required': ['thread', 'source_comment', 'is_ruling', 'scope',
                                     'cards', 'text', 'confidence'],
                    },
                },
            },
            'required': ['proposals'],
        }},
    }
}


TASK = """You are extending the official-rulings database behind
navarog.github.io/wingsearch, a Wingspan card reference players use to settle rules
arguments mid-game.

You are given threads from Stonemaier Games' own FAQ pages. Each contains a question
and an answer from someone marked [OFFICIAL] -- the publisher, the designer, or
Stonemaier staff. Their answers are the authority; treat everything else in the thread
as the question, however confidently it is phrased. Decide whether each thread yields a
ruling worth adding to the database.

Say is_ruling=false, with a short reject_reason, for anything that is not a durable
rules clarification. Most threads are not. Reject:

- praise, thanks, greetings, and general chat
- questions about shipping, availability, price, reprints, translations, retailers
- speculation or requests about future expansions ("will you add NZ birds?")
- opinions on strategy or balance
- answers about the Automa / solo mode -- wingsearch does not cover solo play
- component defects, misprints, replacement parts
- questions the official answer did not actually resolve ("we'll look into it")
- anything already covered by an existing ruling shown to you -- set `duplicates`

A ruling that survives should be:

- **A statement, not a dialogue.** Write what is true, in the database's voice. Not
  "Jamey says you can", not "Q: ... A: ...". Third person, present tense, imperative
  where natural. Match the style of the existing rulings you are shown.
- **Self-contained.** A player reading it on a card page has not seen the question.
  Name the card if the ruling is about a card.
- **Faithful.** Never strengthen, generalise or tidy up beyond what was actually
  answered. If the answer is narrower than the question, the ruling is narrower.

**Scope.** Default to scope="card". A card-scoped ruling appears on those cards' pages
immediately; a general one reaches nobody until a human writes a predicate for it and
reviews it card by card, so reach for "general" only when the rule genuinely spans many
cards beyond the ones discussed here (like "'May' creates a choice"). An official answer
being *phrased* as a principle is not enough on its own -- Stonemaier answers almost
everything as a principle. Ask instead: would a player looking at a card not named in
this thread need this?

Either way, always fill `cards` with the cards named in the thread that the ruling
demonstrably applies to, and only those. For scope="general" that list is what lets the
rule ship now instead of waiting on a predicate, so do not leave it empty just because
the rule is broad. Give a short `title` for general rulings only.

**Formatting.** Match the corpus exactly:

- Card names are bold: `\\textbf{Superb Lyrebird}`. Bold every card name you mention.
- Quoted card or rulebook text uses TeX quotes: ``like this''.
- Dashes are TeX too: `---` for a parenthetical dash, `--` in a range (4--5). A literal
  en or em dash character is not translated and reaches the player as itself.
- Resources and habitats use `[icon]` markers: [egg], [card], [invertebrate], [seed],
  [fish], [fruit], [rodent], [wild], [nectar], [die], [forest], [grassland], [wetland],
  [cavity], [ground], [platform], [bowl], [star].

**Wingspan Pocket.** Some threads come from the Pocket page. Pocket reworks card texts
and wingsearch does not carry Pocket cards at all -- the card texts you are shown are
always the full-game versions. So from a Pocket thread, propose only a rule that holds in
the full game, and never attach a ruling to a card whose shown text does not match what
the thread is describing. Say so in `note` when you make that call.

Confidence: "high" when an [OFFICIAL] answer plainly and unambiguously settles it;
"medium" when you had to interpret the answer or infer its scope; "low" when the
answer is unclear, seems to conflict with the rules as printed, or predates a mechanic
that may have changed it. Put anything a reviewer needs to know in `note` -- especially
if you think the official answer is wrong or has been superseded.

**Provenance.** Every ruling is published with a link to the exact comment it came from,
so `source_comment` must be the id of the [OFFICIAL] comment that actually settles it.
People often reply to a stranger's comment to ask something unrelated, so one thread can
carry two or three separate questions and answers, and the last official comment is
frequently not the one you used. Read the ids in the transcript and give the right one."""


def build_system(knowledge, named, general):
    style = []
    for rows in list(named.values())[:6]:
        for r in rows:
            style.append(f'- ({r["specific"]}) {r["text"]}')
    for r in list(general.values())[:6]:
        style.append(f'- [general: {r["general"]}] {r["text"]}')
    return [
        {'text': TASK},
        {'text': 'Existing rulings, as examples of the required voice and format:\n'
                 + '\n'.join(style[:14])},
        {'text': 'Reference notes on this database, its trust model and its known failure '
                 'modes:\n\n' + knowledge},
    ]


def build_user(batch, cards, named):
    parts = []
    for t in batch:
        parts.append(f'# Thread {t["root"]}  (page: {t["page"]}, last activity {t["date"]})')
        parts.append(rc.thread_text(t))
        if t['cards']:
            parts.append('\n## Cards named in this thread')
            for name in t['cards']:
                c = cards[name]
                if c['_kind'] == 'bonus':
                    parts.append(f'- {name} [bonus card]: {c.get("Condition", "")}')
                else:
                    parts.append(f'- {name} [{c.get("Set", "?")}, {c.get("Color", "?")}]: '
                                 f'{c.get("Power text") or "(no power)"}')
                for r in named.get(name, []):
                    parts.append(f'    existing ruling: {r["text"]}')
                if not named.get(name):
                    parts.append('    (no existing rulings for this card)')
        parts.append('')
    parts.append('Return exactly one proposal per thread, in the order given, '
                 'using the thread ids shown.')
    return [{'text': '\n'.join(parts)}]


def judge(client, system, batch, cards, named, attempt=1):
    try:
        resp = client.converse(
            modelId=MODEL_ID,
            system=system,
            messages=[{'role': 'user', 'content': build_user(batch, cards, named)}],
            toolConfig={'tools': [PROPOSAL_TOOL],
                        'toolChoice': {'tool': {'name': 'record_proposals'}}},
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
        return judge(client, system, batch, cards, named, attempt + 1)

    out = []
    for block in resp['output']['message']['content']:
        if 'toolUse' in block:
            out = block['toolUse']['input'].get('proposals', [])
    return out, resp['usage']


def save(store):
    tmp = OUT_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(store, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write('\n')
    os.replace(tmp, OUT_PATH)     # atomic, so a checkpoint can't leave a half-written file


def validate(store):
    """Report markup that would render literally on the site.

    Ruling text is not plain text: the notebook turns `\\textbf{}` into HTML and
    `IconizePipe` turns `[seed]` into an <img>, so an icon name the app does not ship
    reaches the player as the literal string "[food]".
    """
    icons = {f.rsplit('.', 1)[0] for f in os.listdir(ICON_DIR)}
    problems = []
    for p in store['proposals'].values():
        if not p['is_ruling']:
            continue
        t = p['text']
        for name in re.findall(r'\[([a-z0-9 _-]+)\]', t):
            if name not in icons:
                problems.append((p['thread'], f'unknown icon marker [{name}]'))
        if t.count('{') != t.count('}'):
            problems.append((p['thread'], 'unbalanced braces'))
        for cmd in set(re.findall(r'\\([a-zA-Z]+)', t)):
            if cmd not in ('textbf', 'textit'):
                problems.append((p['thread'], rf'unsupported TeX command \{cmd}'))
        if re.search(r'[‘’“”]', t):
            problems.append((p['thread'], 'curly quotes (corpus uses ``TeX quotes\'\')'))
    return problems


def applied_comment_ids():
    """Comments this pipeline is done with: published, merged away, or rejected.

    `cited_comment_ids()` reads the TSV's source column, which is almost the same thing --
    except for two ways a comment stops being cited while remaining settled. `curate.py`
    merges restatements of one rule into a single row and that row keeps only one link, so
    deriving "applied" from citations alone makes the next refresh re-append every ruling
    curation just merged away, forever. And a ruling a human deleted as wrong leaves no
    citation at all, so it would come back on the very next run; `rejections.json` is what
    makes a removal stick.

    The third way is a review folding an answer into a row that already exists rather than
    adding a row -- the clause that says *why* a bird qualifies, or a later comment resolving
    an earlier one's caveat. Those comments are recorded in `extra-citations.json` and are
    just as settled as a cited one, so they count here too. Fifteen threads restating the
    reroll rule collapse into one general ruling that can only link to one of them.
    """
    ids = rc.cited_comment_ids()
    if os.path.exists(CURATION_PATH):
        for plan in json.load(open(CURATION_PATH, encoding='utf-8'))['plans'].values():
            for gone in plan.get('superseded', []):
                m = re.search(r'#comment-(\d+)', gone.get('source', ''))
                if m:
                    ids.add(m.group(1))
    if os.path.exists(EXTRA_CITATIONS_PATH):
        for entry in json.load(open(EXTRA_CITATIONS_PATH, encoding='utf-8'))['citations'].values():
            ids.update(str(c) for c in entry['comments'])
    for r in load_rejections():
        if r.get('comment'):
            ids.add(str(r['comment']))
    return ids


def load_rejections():
    """Human verdicts on rulings that must not be published. See rejections.json."""
    if not os.path.exists(REJECTIONS_PATH):
        return []
    return json.load(open(REJECTIONS_PATH, encoding='utf-8'))['rejections']


def _norm(text):
    return re.sub(r'[^a-z ]', ' ', re.sub(r'\\textbf\{([^}]*)\}', r'\1', text).lower())


def cluster(store, threshold=0.62):
    """Group proposals that restate the same ruling, and record it on each.

    The model judges four threads per call, so it cannot see that a question asked in
    2020 was asked again in 2023 and answered the same way -- three separate Galah
    rulings all saying the tuck is unconditional. Duplicates only ever collide on a
    shared card, so compare within cards and let the clusters merge transitively.
    """
    keep = [p for p in store['proposals'].values() if p['is_ruling'] and not p['duplicates']]
    parent = {p['thread']: p['thread'] for p in keep}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    by_card = {}
    for p in keep:
        for c in p['cards']:
            by_card.setdefault(c, []).append(p)

    for group in by_card.values():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                if find(a['thread']) == find(b['thread']):
                    continue
                if difflib.SequenceMatcher(None, _norm(a['text']),
                                           _norm(b['text'])).ratio() >= threshold:
                    parent[find(a['thread'])] = find(b['thread'])

    sizes = collections.Counter(find(p['thread']) for p in keep)
    for p in store['proposals'].values():
        root = find(p['thread']) if p['thread'] in parent else None
        p['cluster'] = root if root is not None and sizes[root] > 1 else None
    return sum(1 for n in sizes.values() if n > 1), sum(n - 1 for n in sizes.values() if n > 1)


def emit_tsv(store, cards):
    """Print TSV rows for accepted proposals, ready to paste.

    Everything is emitted as *named* rows, including general-scoped rulings, because a
    named row reaches the card page as soon as the notebook runs whereas a general row
    reaches nobody until someone writes a predicate for it. General rulings are listed
    separately afterwards as predicate candidates -- promoting one means adding it to
    general_map.py and dropping the named rows it replaces.

    Proposals whose source comment is already cited in the TSV are skipped, so this is safe
    to re-run after a review session: it emits only what is new. `accept` therefore means
    "approved", not "not yet applied", and needs no second state to track.
    """
    cited = applied_comment_ids()
    accepted, applied = [], []
    for p in store['proposals'].values():
        if p.get('review') != 'accept':
            continue
        if re.search(r'#comment-(\d+)', p['source']).group(1) in cited:
            applied.append(p)
        else:
            accepted.append(p)
    if applied:
        print(f'# {len(applied)} accepted proposals are already in the TSV; considering the '
              f'other {len(accepted)}', file=sys.stderr)
    if not accepted:
        print('nothing to emit: no proposals are marked "review": "accept" and unapplied')
        return

    # Ids are the source comment's date, so two rulings answered the same day collide.
    # The corpus disambiguates with a/b/c suffixes; ids already in the TSV count as taken.
    named, general_rows = rc.load_rulings()
    used = {r['id'] for rows in named.values() for r in rows} | set(general_rows)
    # Seed the dedup memory with clusters the TSV already covers, or a cluster whose
    # representative was applied last time would re-emit a sibling restating it.
    seen_clusters = {p['cluster']: p['thread'] for p in applied if p.get('cluster') is not None}
    for p in sorted(accepted, key=lambda p: p['thread']):
        cl = p.get('cluster')
        if cl is not None and cl in seen_clusters:
            print(f'# skipped thread {p["thread"]}: same ruling as accepted thread '
                  f'{seen_clusters[cl]} (cluster {cl})', file=sys.stderr)
            continue
        if cl is not None:
            seen_clusters[cl] = p['thread']
        rid = p['ruling_id']
        if rid in used:
            rid = next(rid + s for s in 'abcdefghijklmnopqrstuvwxyz' if rid + s not in used)
        used.add(rid)
        p['_emitted_id'] = rid
        text = ' '.join(p['text'].split())
        for name in p['cards']:
            print(f'{rid}\t\t{name}\t{text}\t{p["source"]}')

    general = [p for p in accepted if p['scope'] == 'general']
    if general:
        print(f'\n# {len(general)} of these are general in scope. They are emitted above as '
              f'named rows so they reach players now; each is also a candidate for a\n'
              f'# predicate in general_map.py, which would widen it past the cards '
              f'listed. Promoting one means dropping its named rows.', file=sys.stderr)
        for p in general:
            print(f'#   {p["_emitted_id"]}  {p["title"] or "(untitled)"}  '
                  f'-> {len(p["cards"])} cards', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, help='cap threads judged (for validation)')
    ap.add_argument('--set', dest='card_set', help='only threads naming a card from this Set')
    ap.add_argument('--no-cards', action='store_true',
                    help='also judge threads that name no card (general rules only)')
    ap.add_argument('--recheck', action='store_true', help='re-judge already-judged threads')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--emit-tsv', action='store_true')
    args = ap.parse_args()

    cards = rc.load_cards()
    named, general = rc.load_rulings()
    store = ({'proposals': {}} if not os.path.exists(OUT_PATH)
             else json.load(open(OUT_PATH, encoding='utf-8')))

    if args.emit_tsv:
        emit_tsv(store, cards)
        return

    cited = applied_comment_ids()
    pat = rc.name_matcher(cards)
    work = []
    for t in rc.load_threads():
        if not t['authoritative']:
            continue
        if any(str(c['id']) in cited for c in t['comments']):
            continue
        if not args.recheck and str(t['root']) in store['proposals']:
            continue
        t['cards'] = rc.cards_in(cards, pat, rc.thread_text(t))
        if not t['cards'] and not args.no_cards:
            continue
        if args.card_set and not any(cards[c].get('Set') == args.card_set for c in t['cards']):
            continue
        work.append(t)

    work.sort(key=lambda t: t['date'], reverse=True)      # newest first: most likely unrecorded
    if args.limit:
        work = work[:args.limit]

    batches = [work[i:i + BATCH] for i in range(0, len(work), BATCH)]
    log(f'{len(work)} threads to judge in {len(batches)} calls '
        f'({MODEL_ID} in {REGION})')
    if args.dry_run or not work:
        for t in work[:12]:
            log(f'  {t["root"]:>7} {t["date"]} {t["page"][:22]:<24}{", ".join(t["cards"])[:60]}')
        if len(work) > 12:
            log(f'  ... and {len(work) - 12} more')
        return

    knowledge = open(KNOWLEDGE_PATH, encoding='utf-8').read()
    system = build_system(knowledge, named, general)
    client = boto3.client('bedrock-runtime', region_name=REGION)
    by_root = {t['root']: t for t in work}
    usage = {'inputTokens': 0, 'outputTokens': 0}
    done = [0]

    def run(batch):
        props, u = judge(client, system, batch, cards, named)
        with _lock:
            for p in props:
                t = by_root.get(p.get('thread'))
                if t is None:
                    log(f'    ! unknown thread {p.get("thread")}, ignoring')
                    continue
                # Cite the comment the model actually ruled from; fall back to the last
                # official one only if it named something that isn't in this thread.
                official = [c for c in t['comments'] if c['author'] in rc.TRUSTED]
                picked = {c['id']: c for c in official}.get(p.get('source_comment'))
                answer = picked or (official or t['comments'])[-1]
                named_cards = [rc.canonical(cards, n) for n in p.get('cards', [])]
                store['proposals'][str(t['root'])] = {
                    'thread': t['root'],
                    'ruling_id': answer['date'][:10].replace('-', ''),
                    'source': f'{answer["link"].split("#")[0]}#comment-{answer["id"]}',
                    'answered_by': answer['author'],
                    'answered_on': answer['date'][:10],
                    'source_resolved': picked is not None,
                    'page': t['page'],
                    'is_ruling': p.get('is_ruling', False),
                    'reject_reason': p.get('reject_reason', ''),
                    'scope': p.get('scope', 'none'),
                    # Normalise spelling variants ("Tui" -> `Tūī`) but never guess past
                    # them: "European Magpie" is the asker's name for `Eurasian Magpie`
                    # and resolving that is a judgement call, so it is quarantined for
                    # review rather than silently attached to a bird.
                    'cards': [n for n in named_cards if n in cards],
                    'unknown_cards': [n for n in named_cards if n not in cards],
                    'title': p.get('title', ''),
                    'text': p.get('text', ''),
                    'duplicates': p.get('duplicates', ''),
                    'confidence': p.get('confidence', 'low'),
                    'note': p.get('note', ''),
                    'review': 'pending',
                    'model': MODEL_ID,
                }
            for k in usage:
                usage[k] += u.get(k, 0)
            done[0] += 1
            keep = sum(1 for p in props if p.get('is_ruling'))
            log(f'  [{done[0]}/{len(batches)}] {len(props)} threads -> {keep} rulings')
            if done[0] % 10 == 0:
                save(store)          # a crash at call 100 should not discard calls 1-99

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(run, batches))
    save(store)

    nclusters, redundant = cluster(store)
    save(store)

    ps = list(store['proposals'].values())
    kept = [p for p in ps if p['is_ruling'] and not p['duplicates']]
    cost = usage['inputTokens'] / 1000 * PRICE_IN + usage['outputTokens'] / 1000 * PRICE_OUT
    log(f'\ndone in {time.time() - t0:.0f}s -> {os.path.relpath(OUT_PATH)}')
    log(f'  {len(ps)} threads judged, {len(kept)} proposed rulings '
        f'({sum(1 for p in kept if p["confidence"] == "high")} high confidence), '
        f'{sum(1 for p in ps if p["duplicates"])} duplicates, '
        f'{sum(1 for p in ps if not p["is_ruling"])} rejected')
    log(f'  {nclusters} clusters of restated rulings, {redundant} redundant proposals '
        f'-> {len(kept) - redundant} distinct')
    for thread, problem in validate(store):
        log(f'  ! thread {thread}: {problem}')
    log(f'  tokens in {usage["inputTokens"]} out {usage["outputTokens"]}  ~${cost:.2f}')


if __name__ == '__main__':
    main()
