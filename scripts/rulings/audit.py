#!/usr/bin/env python3
"""Audit which cards a general Wingspan ruling actually applies to.

The regexes in `general_map.py` propose candidates; this script asks
Claude (on Bedrock) to judge each candidate card against the ruling *and its
original source comment*, and writes the verdicts to
`applicability.json`, which the notebook then honours.

Run it by hand -- it costs money and is not deterministic, so it must never be
part of the site build. The committed JSON is what the build consumes.

    export AWS_PROFILE=...            # needs bedrock:InvokeModel
    python3 audit.py --dry-run
    python3 audit.py --ruling 20200404      # one ruling
    python3 audit.py                        # everything not yet judged

Only *confident* exclusions remove a ruling from a card. Anything the model is
unsure about is recorded under `uncertain` and left attached, so hedging can
never silently delete content -- see `general_map.applies`.
"""

import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import boto3
import botocore.exceptions
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import general_map as grm  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TSV_PATH = os.path.join(HERE, 'rulings.tsv')
MASTER_PATH = os.path.join(HERE, '..', '..', 'src', 'assets', 'data', 'master.json')
KNOWLEDGE_PATH = os.path.join(HERE, 'domain-knowledge.md')
OUT_PATH = grm.APPLICABILITY_PATH
# Committed on purpose. Half the corpus cites URLs that no longer resolve for an
# anonymous reader (every Facebook link 400s), so the fetched text of a source
# discussion is worth keeping in-repo as evidence, not treated as a throwaway cache.
CACHE_PATH = os.path.join(HERE, 'source-comments.json')

MODEL_ID = 'us.anthropic.claude-opus-5'
REGION = os.environ.get('AWS_REGION') or 'us-east-1'
CHUNK = 25
WORKERS = 4

# Bedrock on-demand pricing for Opus, USD per 1K tokens. Only used to print an
# estimate; adjust if the rate card changes.
PRICE_IN, PRICE_OUT = 0.005, 0.025

_print_lock = threading.Lock()


def log(*a):
    with _print_lock:
        print(*a, flush=True)


# --------------------------------------------------------------------------- io

def load_general_rulings():
    """ruling id -> {title, text, source} for the 34 rulings with no card name."""
    df = pd.read_csv(TSV_PATH, sep='\t', header=None,
                     names=['id', 'general', 'specific', 'text', 'source'])
    out = {}
    for _, r in df.iterrows():
        if pd.isna(r['specific']) or not str(r['specific']).strip():
            out[str(r['id'])] = {
                'title': '' if pd.isna(r['general']) else str(r['general']).strip(),
                'text': delatex(str(r['text'])),
                'source': '' if pd.isna(r['source']) else str(r['source']).strip(),
            }
    return out


def delatex(s):
    s = re.sub(r'\\textbf\{(.*?)\}', r'\1', s)
    s = re.sub(r'\\textit\{(.*?)\}', r'\1', s)
    s = s.replace("``", '"').replace("''", '"')
    return re.sub(r'\s+', ' ', s).strip()


def load_cache():
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_cache(cache):
    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def fetch_source_thread(source, cache):
    """Resolve a #comment-N source into the question/answer text behind it.

    Only stonemaiergames.com is reachable programmatically; BGG, Facebook and
    Discord sources are returned as None and the prompt says so explicitly.
    """
    m = re.search(r'stonemaiergames\.com.*#comment-(\d+)', source or '')
    if not m:
        return None
    cid = m.group(1)
    if cid in cache:
        return cache[cid]

    chain = []
    node = cid
    for _ in range(3):                      # answer, its question, its parent
        try:
            url = f'https://stonemaiergames.com/wp-json/wp/v2/comments/{node}'
            req = urllib.request.Request(url, headers={
                'User-Agent': 'wingsearch-rulings-audit/1.0 (+https://github.com/navarog/wingsearch)'})
            with urllib.request.urlopen(req, timeout=30) as f:
                c = json.load(f)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            log(f'    ! could not fetch comment {node}: {e}')
            break
        chain.append({
            'id': c['id'], 'author': c['author_name'], 'date': c['date'][:10],
            'text': re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', c['content']['rendered'])).strip(),
        })
        if not c.get('parent'):
            break
        node = str(c['parent'])
        time.sleep(0.3)

    chain.reverse()                          # oldest (the question) first
    cache[cid] = chain
    return chain


# ----------------------------------------------------------------------- prompt

VERDICT_TOOL = {
    'toolSpec': {
        'name': 'record_verdicts',
        'description': 'Record one verdict per card presented.',
        'inputSchema': {'json': {
            'type': 'object',
            'properties': {
                'verdicts': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'card': {'type': 'string', 'description': 'Common name, copied exactly'},
                            'verdict': {'type': 'string', 'enum': ['applies', 'does_not_apply']},
                            'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
                            'reason': {'type': 'string', 'description': 'One short sentence.'},
                        },
                        'required': ['card', 'verdict', 'confidence', 'reason'],
                    },
                },
            },
            'required': ['verdicts'],
        }},
    }
}

TASK = """You are auditing the Wingspan card database at navarog.github.io/wingsearch.

A "general ruling" is an official clarification that should be attached to every
card it genuinely governs. Cards were selected by a crude regex over their power
text, which over-matches badly. Your job is to decide, per card, whether the
ruling genuinely applies.

Judge by these standards:

- The ruling must tell a player something that is *true and relevant for this
  specific card*. If it does not change how this card is played, it does not apply.
- If the card's own printed text already states the ruling's content, answer
  does_not_apply -- it is redundant noise.
- Respect resource kinds: food, eggs, cards, nectar are distinct. A ruling about
  gaining food does not govern drawing cards.
- Where the original source question is shown, it bounds the ruling's scope. The
  ruling text is a generalisation and may be broader than what was actually asked
  and answered.
Confidence is a claim about the *evidence*, not about your comfort. Calibrate it:

- "high" -- the card's own text settles it. Typical high-confidence cases: the card
  already prints the choice the ruling describes (redundant); the ruling names a
  mechanic this card does not have; the quantity is a single indivisible unit so
  there is no "some but not all" available. These are the common cases. Do not
  withhold "high" merely because the question is a judgement call -- withhold it
  because the evidence is actually thin.
- "medium" -- your reading is probably right but turns on how the ruling generalises,
  or on a mechanic released after the ruling was written.
- "low" -- you are guessing, or the card raises a rules question nobody has answered.

Do not treat "medium" as the safe default. A verdict that is only medium keeps the
ruling attached and adds an item to a human review queue, so blanket hedging has a
real cost: it buries the genuine questions in noise. Grade honestly in both
directions.

Return exactly one verdict per card you were given, using the card's Common name
verbatim."""


def build_system(knowledge):
    # No cachePoint: boto3 1.36 rejects it in `system`. The block is ~5k tokens
    # resent per call, which costs a dollar or so across a full run -- cheaper
    # than pinning a newer boto3 into this environment.
    return [
        {'text': TASK},
        {'text': 'Reference notes on this database and its known failure modes:\n\n' + knowledge},
    ]


def build_user(ruling_id, ruling, chain, birds):
    parts = [f'# Ruling {ruling_id}']
    if ruling['title']:
        parts.append(f'Title: {ruling["title"]}')
    parts.append(f'Ruling text: {ruling["text"]}')
    parts.append(f'Cited source: {ruling["source"] or "(none)"}')

    if chain:
        parts.append('\n## Original source discussion (oldest first)')
        for c in chain:
            parts.append(f'[{c["date"]}] {c["author"]}: {c["text"]}')
    else:
        parts.append('\n## Original source discussion\nNot retrievable (source is '
                     'not a Stonemaier FAQ comment), so judge from the ruling text alone '
                     'and be correspondingly more cautious.')

    parts.append(f'\n## Candidate cards ({len(birds)})')
    for b in birds:
        bits = [f'- {b["Common name"]} [{b["Set"]}, {b["Color"]}]']
        bits.append(f'  Power: {b["Power text"] or "(no power)"}')
        extra = []
        if b.get('Nest type'):
            extra.append(f'nest={b["Nest type"]}')
        if b.get('Total food cost') not in (None, ''):
            extra.append(f'food cost={b["Total food cost"]}')
        if b.get('* (food cost)'):
            extra.append('has * (alternative food cost)')
        if b.get('/ (food cost)'):
            extra.append('has / (either-or food cost)')
        if extra:
            bits.append(f'  ({", ".join(extra)})')
        parts.append('\n'.join(bits))
    return [{'text': '\n'.join(parts)}]


def judge(client, system, ruling_id, ruling, chain, birds, attempt=1):
    try:
        resp = client.converse(
            modelId=MODEL_ID,
            system=system,
            messages=[{'role': 'user', 'content': build_user(ruling_id, ruling, chain, birds)}],
            toolConfig={'tools': [VERDICT_TOOL],
                        'toolChoice': {'tool': {'name': 'record_verdicts'}}},
            inferenceConfig={'maxTokens': 8000},   # Opus 5 rejects `temperature`
        )
    except botocore.exceptions.ParamValidationError:
        raise                                                 # our bug, not transient
    except client.exceptions.ValidationException:
        raise                                                 # our bug, not transient
    except Exception as e:                                    # throttling, 5xx
        if attempt >= 5:
            raise
        wait = 2 ** attempt
        log(f'    ! {ruling_id}: {type(e).__name__}, retrying in {wait}s')
        time.sleep(wait)
        return judge(client, system, ruling_id, ruling, chain, birds, attempt + 1)

    verdicts = []
    for block in resp['output']['message']['content']:
        if 'toolUse' in block:
            verdicts = block['toolUse']['input'].get('verdicts', [])
    return verdicts, resp['usage']


# ------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ruling', action='append', help='limit to these ruling ids')
    ap.add_argument('--recheck', action='store_true', help='re-judge already-decided cards')
    ap.add_argument('--dry-run', action='store_true', help='show the plan and stop')
    ap.add_argument('--limit', type=int, help='cap cards per ruling (for testing)')
    args = ap.parse_args()

    with open(MASTER_PATH, encoding='utf-8') as f:
        birds = json.load(f)
    general = load_general_rulings()
    knowledge = open(KNOWLEDGE_PATH, encoding='utf-8').read()
    existing = grm._load(OUT_PATH)

    # Build the work list: (ruling, [cards]) for candidates not already decided.
    work = []
    for rid, pred in grm.candidates.items():
        if args.ruling and rid not in args.ruling:
            continue
        if rid not in general:
            continue
        cands = [b for b in birds if pred(b)]
        if not cands:
            continue
        if not args.recheck:
            decided = set(existing.get(rid, {}).get('applies') or [])
            decided |= set((existing.get(rid, {}).get('excluded') or {}).keys())
            decided |= set((existing.get(rid, {}).get('uncertain') or {}).keys())
            cands = [b for b in cands if b['Common name'] not in decided]
        if args.limit:
            cands = cands[:args.limit]
        if cands:
            work.append((rid, cands))

    pairs = sum(len(c) for _, c in work)
    calls = sum((len(c) + CHUNK - 1) // CHUNK for _, c in work)
    log(f'{len(work)} rulings, {pairs} cards to judge, {calls} model calls '
        f'({MODEL_ID} in {REGION})')
    for rid, c in work:
        log(f'  {rid:<10} {len(c):>4} cards   {general[rid]["title"] or general[rid]["text"][:60]}')
    if args.dry_run or not pairs:
        return

    cache = load_cache()
    log('\nresolving source comments...')
    chains = {rid: fetch_source_thread(general[rid]['source'], cache) for rid, _ in work}
    save_cache(cache)
    for rid, ch in chains.items():
        log(f'  {rid:<10} {"%d comments" % len(ch) if ch else "source not retrievable"}')

    system = build_system(knowledge)
    client = boto3.client('bedrock-runtime', region_name=REGION)

    jobs = []
    for rid, cands in work:
        for i in range(0, len(cands), CHUNK):
            jobs.append((rid, cands[i:i + CHUNK]))

    results = {}
    usage = {'inputTokens': 0, 'outputTokens': 0, 'cacheReadInputTokens': 0}
    done = [0]

    def run(job):
        rid, chunk = job
        verdicts, u = judge(client, system, rid, general[rid], chains[rid], chunk)
        with _print_lock:
            results.setdefault(rid, []).extend(verdicts)
            for k in usage:
                usage[k] += u.get(k, 0)
            done[0] += 1
            print(f'  [{done[0]}/{len(jobs)}] {rid} {len(chunk)} cards -> '
                  f'{sum(1 for v in verdicts if v["verdict"] == "does_not_apply")} exclusions',
                  flush=True)

    log(f'\njudging in {len(jobs)} calls...')
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(run, jobs))

    # Merge verdicts into the applicability file.
    out = json.loads(json.dumps(existing))
    work_by_rid = dict(work)
    for rid, verdicts in results.items():
        names = {b['Common name'] for b in work_by_rid[rid]}
        entry = out.setdefault(rid, {})
        entry['rule'] = general[rid]['text']
        entry['title'] = general[rid]['title']
        entry['source'] = general[rid]['source']
        entry['model'] = MODEL_ID
        entry['reviewed'] = time.strftime('%Y-%m-%d')
        applies = set(entry.get('applies') or [])
        excluded = dict(entry.get('excluded') or {})
        uncertain = dict(entry.get('uncertain') or {})
        for v in verdicts:
            card = v['card']
            if card not in names:
                log(f'    ! {rid}: model returned unknown card {card!r}, ignoring')
                continue
            applies.discard(card); excluded.pop(card, None); uncertain.pop(card, None)
            if v['confidence'] != 'high':
                uncertain[card] = f'[{v["confidence"]}] {v["verdict"]}: {v["reason"]}'
            elif v['verdict'] == 'does_not_apply':
                excluded[card] = v['reason']
            else:
                applies.add(card)
        entry['applies'] = sorted(applies)
        entry['excluded'] = dict(sorted(excluded.items()))
        entry['uncertain'] = dict(sorted(uncertain.items()))

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write('\n')

    cost = (usage['inputTokens'] / 1000 * PRICE_IN
            + usage['outputTokens'] / 1000 * PRICE_OUT)
    n_exc = sum(len(e.get('excluded') or {}) for e in out.values())
    n_unc = sum(len(e.get('uncertain') or {}) for e in out.values())
    n_app = sum(len(e.get('applies') or []) for e in out.values())
    log(f'\ndone in {time.time() - t0:.0f}s -> {os.path.relpath(OUT_PATH)}')
    log(f'  applies {n_app}   excluded {n_exc}   uncertain (queued for review) {n_unc}')
    log(f'  tokens in {usage["inputTokens"]} (cache read {usage["cacheReadInputTokens"]}) '
        f'out {usage["outputTokens"]}  ~${cost:.2f}')


if __name__ == '__main__':
    main()
