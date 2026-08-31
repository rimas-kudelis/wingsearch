#!/usr/bin/env python3
"""Build and query a graph over the rulings corpus, for reviewers with tools.

The corpus is stored flat: a ruling is a TSV row naming one card. That shape answers
"what does this card say" and nothing else, which is why a reviewer looking at one card
cannot see that eleven other rulings bear on the same rule. `20260617` published the
opposite of its source and sat next to four rulings contradicting it; had anything been
able to ask *"what else does this corpus say about the scope of the 'gain food' action?"*
it would have surfaced as one row against eleven. Contradiction detection needs the
relationships, not the rows.

Everything here is derived from committed data -- no model calls, no network, nothing to
review. Four edge kinds do the work:

- **attached_to** — the card a ruling is displayed on (the TSV's own relation).
- **mentions** — cards a ruling's text names, recovered from `\textbf{}` markup. 200-odd
  rulings cross-reference another card; that is the interaction graph, and it was
  previously invisible.
- **concept** — which rule area a ruling touches, by an inspectable regex per concept.
  Deliberately a table you can read and argue with rather than an embedding.
- **same_power** — cards whose power text is identical after normalisation. This one pays
  for the whole file: 57 cards share a power with a card that has a ruling and have none
  of their own, so a rule already researched and answered officially is not being shown
  to the player holding the other card. 52 of the 57 are core-set cards -- identical
  powers cluster in the base game, so this does not touch the Americas gap, but it is the
  set most players own, and closing it needs no new sources at all.

Verification status from `verification.json` is joined on, so a query says not just what
we claim but whether it was ever checked against a source.

    python3 graph.py --build                    # writes graph.json
    python3 graph.py --card 'Barn Owl'          # everything bearing on one card
    python3 graph.py --concept caching          # every ruling on a rule area
    python3 graph.py --related 20240903         # what to read before judging one ruling
    python3 graph.py --transferable             # rulings a same-power sibling should have
    python3 graph.py --coverage                 # where the corpus is thin, and how thin
"""

import argparse
import collections
import json
import os
import re
import sys
import textwrap
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corpus as rc  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, 'graph.json')
VERIFICATION_PATH = os.path.join(HERE, 'verification.json')
DATA_DIR = os.path.join(HERE, '..', '..', 'src', 'assets', 'data')


# Rule areas a ruling can be about. One regex each, matched against the ruling text, so
# every membership is checkable by eye and arguable in review -- which an embedding is not.
# Recall matters more than precision here: a concept is a place to look, and a ruling
# appearing under two of them is normal and fine.
CONCEPTS = {
    'gain-food-action-scope': (
        'What counts as the "gain food" action, versus food from a bird power',
        r"gain food|``gain food''|main action|core (?:benefit|action)"),
    'pink-timing': (
        'Once-between-turns powers: when they fire, how often, whose turn',
        r'pink|once between turns|between turns'),
    'caching': ('Caching food on a card, and what cached food counts for',
                r'cach(?:e|ed|ing)'),
    'tucking': ('Tucking cards behind birds', r'tuck(?:ed|ing|s)?\b'),
    'nectar': ('Nectar: spending it, as wild, at round end', r'\[nectar\]|nectar'),
    'wild-food': ('The [wild] icon and food substitution', r'\[wild\]|substitut'),
    'eggs': ('Laying eggs, egg limits, eggs as a cost', r'\[egg\]|egg limit|lay(?:ing)? '),
    'nests': ('Nest types, star nests, nest-based goals', r'\[star\]|nest|\[bowl\]|\[cavity\]|'
                                                          r'\[platform\]|\[ground\]'),
    'predation': ('Predator powers, success and failure', r'\[predator\]|predat|hunt'),
    'birdfeeder': ('The birdfeeder: rerolling, refilling, availability',
                   r'birdfeeder|bird feeder|reroll|re-roll'),
    'beak-direction': ('Beak pointing left or right, and the forward-facing list',
                       r'beak|bill point'),
    'bonus-eligibility': ('Which birds qualify for a bonus card',
                          r'bonus card|Anatomist|Cartographer|Historian|Photographer|'
                          r'Ecologist|Ethologist|Ranger|Rodentologist'),
    'end-of-round-goals': ('Round-end goals and how they are counted',
                           r'end[- ]of[- ]round|round end|goal (?:tile|board)|round goal'),
    'game-end-scoring': ('Scoring at game end', r'game end|end of the game|final scor'),
    'playing-birds': ('Playing a bird: costs, columns, habitats, food payment',
                      r'play(?:ing)? a bird|column|habitat|food cost'),
    'card-draw': ('Drawing and discarding cards, hand limits',
                  r'draw \d|\[card\] from the deck|discard'),
    'power-activation': ('Whether and when a power activates, and optionality',
                         r'activat|optional|you may (?:decline|choose not)'),
    'other-players': ('Effects that involve or benefit other players',
                      r'other player|another player|all players|each player'),
    'supply': ('The general supply, and what is in your personal supply',
               r'from the supply|personal supply|your supply'),
    'flocking': ('Flocking / repeat-power birds', r'\[flocking\]|repeat'),
}


def normalise_power(text):
    """Comparison form for power text, for the same_power edge.

    Only whitespace, case and the curly apostrophe are folded. Nothing semantic: two
    powers that differ by a food type or a wingspan threshold are different rules, and
    letting them collide would propose transferring a ruling that does not transfer.
    """
    t = (text or '').strip().replace('\u2019', "'")
    return re.sub(r'\s+', ' ', t).lower()


def load_cards():
    """Every card, with the fields a reviewer needs, keyed by common name."""
    out = {}
    rows = rc.general_rows()
    for fn, kind in (('master.json', 'bird'), ('hummingbirds.json', 'hummingbird')):
        for c in json.load(open(os.path.join(DATA_DIR, fn), encoding='utf-8')):
            general = rc.general_for(c, rows)
            out[c['Common name']] = {
                'id': c['id'], 'kind': kind, 'set': c.get('Set'),
                'color': c.get('Color'), 'power': c.get('Power text') or '',
                'habitats': [h for h in ('Forest', 'Grassland', 'Wetland') if c.get(h)],
                'general_rulings': len(general),
                # The texts, not just the count: --transferable needs them to say whether a
                # sibling's ruling would tell this card anything it is not already told.
                'general_texts': [r['text'] for r in general],
            }
    for c in json.load(open(os.path.join(DATA_DIR, 'bonus.json'), encoding='utf-8')):
        out[c['Bonus card']] = {
            'id': c['id'], 'kind': 'bonus', 'set': c.get('Set'), 'color': None,
            'power': c.get('Condition') or '', 'habitats': [], 'general_rulings': 0,
        }
    return out


def build():
    cards = load_cards()
    comments = json.load(open(rc.COMMENTS_PATH, encoding='utf-8'))['comments']
    verdicts = {}
    if os.path.exists(VERIFICATION_PATH):
        verdicts = json.load(open(VERIFICATION_PATH, encoding='utf-8'))['verdicts']

    rows = [l.rstrip('\n').split('\t') for l in open(rc.TSV_PATH, encoding='utf-8')]
    rows = [r for r in rows if len(r) == 5]

    rulings = {}
    for r in rows:
        rid, topic, card, text, source = r[0], r[1].strip(), r[2].strip(), r[3], r[4].strip()
        # A ruling id is not unique: one id can produce several rows, both per-card (col 3)
        # and per-topic general rows (col 2), and `20210199a` alone emits four card rows and
        # three general ones, two of which share the topic "Copy". So the key is
        # id@subject, deduplicated positionally -- keying on the id alone silently drops
        # rows, which is how the first build of this file lost four of them.
        key = f'{rid}@{card or topic or "(general)"}'
        if key in rulings:
            n = 2
            while f'{key}#{n}' in rulings:
                n += 1
            key = f'{key}#{n}'
        m = re.search(r'#comment-(\d+)', source)
        c = comments.get(m.group(1)) if m else None
        v = verdicts.get(key, {})
        rulings[key] = {
            'ruling_id': rid,
            'card': card or None,
            'topic': topic or None,
            'text': text,
            'source': source,
            'source_kind': ('stonemaier' if 'stonemaiergames.com' in source else
                            'facebook' if 'facebook.com' in source else
                            'bgg' if 'boardgamegeek' in source else
                            'discord' if 'discord' in source else
                            'rulebook' if source else 'none'),
            'author': c['author'] if c else None,
            'date': c['date'][:10] if c else None,
            # cards the text names, minus the card it is attached to
            'mentions': [n for n in sorted({
                rc.canonical(cards, mm) for mm in re.findall(r'\\textbf\{([^}]*)\}', text)
            }) if n in cards and n != card],
            'concepts': sorted(k for k, (_, pat) in CONCEPTS.items()
                               if re.search(pat, text, re.I)),
            'verified': v.get('verdict'),
            'verified_confidence': v.get('confidence'),
            'settled': bool(v) and not (v.get('problems') or v.get('flags')
                                        or v.get('contradicts')) and
                       v.get('verdict') == 'faithful' and v.get('confidence') == 'high',
            'contradicts': v.get('contradicts') or [],
        }

    # inverted indexes
    by_card = collections.defaultdict(list)
    mentioned_by = collections.defaultdict(list)
    by_concept = collections.defaultdict(list)
    for key, r in rulings.items():
        if r['card']:
            by_card[r['card']].append(key)
        for n in r['mentions']:
            mentioned_by[n].append(key)
        for c in r['concepts']:
            by_concept[c].append(key)

    # same_power groups
    groups = collections.defaultdict(list)
    for name, c in cards.items():
        p = normalise_power(c['power'])
        if p and c['kind'] != 'bonus':
            groups[p].append(name)
    power_groups = []
    for p, names in sorted(groups.items()):
        if len(names) < 2:
            continue
        ruled = sorted(n for n in names if by_card.get(n))
        unruled = sorted(n for n in names if not by_card.get(n))
        power_groups.append({
            'power': next(cards[n]['power'] for n in names),
            'cards': sorted(names), 'ruled': ruled, 'unruled': unruled,
        })

    graph = {
        'generated': time.strftime('%Y-%m-%d'),
        'note': 'Derived entirely from committed data by graph.py. Do not hand-edit.',
        'concepts': {k: {'label': lbl, 'pattern': pat, 'rulings': sorted(by_concept[k])}
                     for k, (lbl, pat) in CONCEPTS.items()},
        'rulings': rulings,
        'cards': {n: dict(c,
                          rulings=sorted(by_card.get(n, [])),
                          mentioned_by=sorted(mentioned_by.get(n, [])))
                  for n, c in sorted(cards.items())},
        'power_groups': power_groups,
    }
    tmp = OUT_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=1, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, OUT_PATH)
    return graph


def load():
    if not os.path.exists(OUT_PATH):
        sys.exit('no graph.json -- run: python3 graph.py --build')
    return json.load(open(OUT_PATH, encoding='utf-8'))


# --------------------------------------------------------------------------- queries


def _wrap(s, indent=7):
    return '\n'.join(textwrap.wrap(s, 94, initial_indent=' ' * indent,
                                   subsequent_indent=' ' * indent))


def _status(r):
    if not r['verified']:
        return f'unverified ({r["source_kind"]} source)'
    bits = [r['verified'], r['verified_confidence']]
    if r['settled']:
        bits.append('settled')
    return '/'.join(b for b in bits if b)


def show_card(g, name):
    matches = [n for n in g['cards'] if n.lower() == name.lower()]
    if not matches:
        matches = [n for n in g['cards'] if name.lower() in n.lower()]
    if not matches:
        sys.exit(f'no card matching {name!r}')
    for n in matches[:5]:
        c = g['cards'][n]
        print(f'\n=== {n}  [id {c["id"]}, {c["kind"]}, {c["set"]}, {c["color"] or "-"}]')
        print(_wrap(f'power: {c["power"] or "(none)"}', 4))
        print(f'\n  rulings on this card ({len(c["rulings"])}), '
              f'plus {c["general_rulings"]} general')
        for k in c['rulings']:
            r = g['rulings'][k]
            print(f'  - {r["ruling_id"]}  {_status(r)}'
                  f'{"  author " + r["author"] + " " + r["date"] if r["author"] else ""}')
            print(_wrap(r['text']))
            if r['mentions']:
                print(f'         mentions: {", ".join(r["mentions"])}')
            if r['concepts']:
                print(f'         concepts: {", ".join(r["concepts"])}')
        if c['mentioned_by']:
            print(f'\n  named by {len(c["mentioned_by"])} ruling(s) on other cards')
            for k in c['mentioned_by']:
                r = g['rulings'][k]
                print(f'  - {r["ruling_id"]} (on {r["card"]}): {r["text"][:110]}')
        sibs = [grp for grp in g['power_groups'] if n in grp['cards']]
        for grp in sibs:
            others = [x for x in grp['cards'] if x != n]
            print(f'\n  identical power to: {", ".join(others)}')
            if not c['rulings'] and grp['ruled']:
                print(f'         ^ those have rulings and this card has none -- '
                      f'a rule already answered officially is not shown here')


def show_concept(g, key):
    keys = [k for k in g['concepts'] if key.lower() in k.lower()]
    if not keys:
        sys.exit(f'no concept matching {key!r}. known: {", ".join(sorted(g["concepts"]))}')
    for k in keys:
        c = g['concepts'][k]
        print(f'\n=== {k}: {c["label"]}')
        print(f'    /{c["pattern"]}/  --  {len(c["rulings"])} rulings\n')
        rs = sorted((g['rulings'][x] for x in c['rulings']),
                    key=lambda r: (r['date'] or '', r['ruling_id']))
        for r in rs:
            who = f'{r["author"]} {r["date"]}' if r['author'] else r['source_kind']
            print(f'  {r["ruling_id"]:<11} {(r["card"] or "(general)")[:26]:<27} {who}')
            print(_wrap(r['text']))
        print(f'\n    Read these together: a rule stated {len(rs)} times should be '
              f'consistent, and\n    disagreement here is a transcription bug before it is '
              f'a change of policy.')


_STOP = set('''a an and any are as at be behind but by can card cards do does each every for
from have if in is it its may no not of on one or other others that the their them then there
this those to when whether which with you your'''.split())


def _distinctive(text):
    """Content words of a power text, for deciding whether a ruling is about that power.

    Crudely stemmed, because the mismatch that matters is exactly this shape: a power says
    "Tuck 1 [card]" and the ruling about it says "cards that may be tucked". Without
    stemming that pair shares only the word "bird" and the ruling looks unrelated.
    """
    t = re.sub(r'\\text(bf|it)\{([^}]*)\}', r'\2', text)
    words = (w for w in re.findall(r"[a-z']{3,}", t.lower()) if w not in _STOP)
    return {re.sub(r'(ing|ed|es|s)$', '', w) or w for w in words}


def about_the_power(ruling, power):
    """Is this ruling about the shared power, or about something particular to its card?

    The same-power edge looked far more productive than it is, because a card's rulings are
    not all about its power. Most are about facts particular to the card:

    - its **name** -- whether "Wood" in Wood Stork is a geography term for Cartographer,
      whether Burrowing Owl counts for Anatomist. Bonus-card eligibility is a name question.
    - its **art** -- Eastern Screech-Owl's beak points in neither direction.
    - its **food cost** -- how a two-food-type end-of-round goal counts its icons.

    Those must not transfer: two birds with the same power have different names, art and
    costs. Only a ruling about the power's mechanics can move to a sibling, so this is the
    filter that turns a noisy 57 into a list worth reading.

    Deliberately conservative in the direction of showing too much: it returns a candidate
    for a human, and a false positive is one wasted read while a false negative is a rule a
    player never sees.
    """
    concepts = set(ruling['concepts'])
    # a name or art question, unless the text also engages with the power's mechanics
    per_card = concepts & {'bonus-eligibility', 'beak-direction'}
    # ...and the third class from the docstring, which the concept table has no entry for: a
    # ruling about the card's printed food cost, on a power that never mentions food cost.
    # `20191007` (how the food-cost goal counts a ``/'' cost) was offered for transfer to
    # Fish Crow's power-sharing sibling on the strength of sharing "food" and "cost".
    if re.search(r'food cost', ruling['text'], re.I) and not re.search(r'food cost', power, re.I):
        per_card = per_card | {'food-cost'}
    shared = _distinctive(ruling['text']) & _distinctive(power)
    if per_card and len(shared) < 3:
        return False
    return len(shared) >= 2


def general_overlap(ruling, card, threshold=4):
    """The card's general rulings that already cover this ruling's ground, best first.

    This comparison is what the first version of --transferable was missing: it read named
    rulings against named rulings, so a card was reported as lacking a sibling's ruling even
    when a general ruling from general_map.py already told it the same thing. Of the first 17
    cards it reported, 15 were that -- the five draw-then-discard birds already carry "You may
    perform an action even if it precludes you from performing an action required at the end of
    your turn", which is the whole of what the sibling's row says.

    Annotate rather than suppress, because the overlap is word-level and so can be wrong in
    both directions, and because about_the_power() is deliberately biased towards showing too
    much: the reviewer keeps the candidate and is told what the card already says.
    """
    want = _distinctive(ruling['text'])
    hits = [(len(want & _distinctive(t)), t) for t in card['general_texts']]
    return [t for n, t in sorted(hits, key=lambda h: -h[0]) if n >= threshold]


def show_transferable(g):
    """Cards whose rulings exist, researched and answered, on an identical-power sibling."""
    gaps = []
    for grp in g['power_groups']:
        if not grp['unruled']:
            continue
        movable = [(n, k) for n in grp['ruled'] for k in g['cards'][n]['rulings']
                   if about_the_power(g['rulings'][k], grp['power'])]
        if movable:
            gaps.append((grp, movable))
    gaps.sort(key=lambda gm: -len(gm[0]['unruled']))
    cards = {n for grp, _ in gaps for n in grp['unruled']}
    rulings = {k for _, mv in gaps for _, k in mv}

    print(f'{len(gaps)} power groups have a ruling about the power itself that some cards '
          f'with that\npower do not carry: {len(rulings)} distinct rulings, '
          f'{len(cards)} cards that could inherit one.\n')
    print('Rulings about a card\'s name, art or food cost are excluded -- those do not')
    print('transfer between birds that merely share a power. See about_the_power().\n')
    print('Several of these are general rules stated on one card by accident of which')
    print('thread they came from. Prefer a general ruling in general_map.py over copying a')
    print('row onto every sibling: same result for players, one place to correct.\n')
    print('A ruling whose lacking cards are already told the same thing by a general ruling')
    print('is annotated "already covered". Read the general text before writing a new row:')
    print('most of these are not gaps, and the ones that are are listed at the end.\n')
    open_gaps = []
    for grp, movable in gaps:
        print(_wrap(f'power: {grp["power"]}', 2))
        for n, k in movable:
            r = g['rulings'][k]
            print(f'    [{r["ruling_id"]}] on {n} ({r["author"] or r["source_kind"]})')
            print(_wrap(r['text'], 8))
            covered = {u: general_overlap(r, g['cards'][u]) for u in grp['unruled']}
            missing = sorted(u for u, hits in covered.items() if not hits)
            if len(missing) < len(covered):
                print(f'      already covered for {len(covered) - len(missing)} of '
                      f'{len(covered)} by a general ruling:')
                for text in dict.fromkeys(h[0] for h in covered.values() if h):
                    print(_wrap('GEN: ' + text, 12))
            if missing:
                print(f'      not covered: {", ".join(missing)}')
                open_gaps.append((r['ruling_id'], missing))
        print(f'    lacks ({len(grp["unruled"])}): {", ".join(grp["unruled"])}')
        sets = collections.Counter(g['cards'][n]['set'] for n in grp['unruled'])
        print(f'    sets: {dict(sets)}\n')

    if open_gaps:
        print('Open gaps -- a sibling\'s ruling about the power with no general ruling on the')
        print('lacking card saying the same thing. These are the rows worth adding:\n')
        for rid, missing in open_gaps:
            print(f'  [{rid}] -> {", ".join(missing)}')
    else:
        print('No open gaps: every candidate above is already covered by a general ruling.')


def show_related(g, ruling_id):
    """Everything a reviewer must read before judging one ruling.

    This is the escalation tier's primary lookup. Judging a ruling in isolation is what
    let `20260617` through: on its own it read as a coherent statement of a rule, and only
    the six other rulings on the scope of the "gain food" action showed it inverted. So
    the bundle is: the same rule area, the same card, and the cards it names.
    """
    keys = [k for k, r in g['rulings'].items() if r['ruling_id'] == ruling_id]
    if not keys:
        sys.exit(f'no ruling {ruling_id!r}')
    for key in keys:
        r = g['rulings'][key]
        print(f'\n=== {key}   {_status(r)}')
        print(_wrap(r['text'], 4))
        print(f'    source: {r["source"]}')
        if r['author']:
            print(f'    author: {r["author"]} {r["date"]}')

        related = {}
        for c in r['concepts']:
            for k2 in g['concepts'][c]['rulings']:
                if k2 != key:
                    related.setdefault(k2, set()).add(c)
        for k2, r2 in g['rulings'].items():
            if k2 == key:
                continue
            if r['card'] and (r2['card'] == r['card'] or r['card'] in r2['mentions']):
                related.setdefault(k2, set()).add('same card')
            if set(r2['mentions']) & set(r['mentions']):
                related.setdefault(k2, set()).add('shared mention')
        # Most-overlapping first: a ruling sharing three concepts and a card with this one
        # is far likelier to be the thing that agrees or disagrees with it.
        ranked = sorted(related.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        print(f'\n    {len(ranked)} related ruling(s), most-overlapping first\n')
        for k2, why in ranked[:25]:
            r2 = g['rulings'][k2]
            who = f'{r2["author"]} {r2["date"]}' if r2['author'] else r2['source_kind']
            print(f'  {k2:<34} {who:<26} via {", ".join(sorted(why))}')
            print(_wrap(r2['text']))
        if len(ranked) > 25:
            print(f'\n    ... {len(ranked) - 25} more; narrow with '
                  f'--concept {r["concepts"][0] if r["concepts"] else ""}')


def show_coverage(g):
    rulings = g['rulings']
    cards = g['cards']
    print('rulings by source, and whether we can check them')
    kinds = collections.Counter(r['source_kind'] for r in rulings.values())
    for k, n in kinds.most_common():
        checkable = 'verifiable against a held source' if k == 'stonemaier' else \
                    'not held -- reviewable only for internal consistency'
        print(f'{n:5d}  {k:<12} {checkable}')

    print('\nverification status')
    st = collections.Counter(r['verified'] or 'never checked' for r in rulings.values())
    for k, n in st.most_common():
        print(f'{n:5d}  {k}')
    print(f'{sum(1 for r in rulings.values() if r["settled"]):5d}  settled')

    print('\ncard coverage by set')
    per = collections.defaultdict(lambda: [0, 0])
    for n, c in cards.items():
        if c['kind'] == 'bonus':
            continue
        per[c['set']][1] += 1
        if c['rulings']:
            per[c['set']][0] += 1
    for s, (have, tot) in sorted(per.items(), key=lambda kv: -kv[1][1]):
        bar = '#' * round(28 * have / tot)
        print(f'  {s or "?":<12} {have:4d}/{tot:<4d} {bar}')

    reachable = set()
    for grp in g['power_groups']:
        if grp['ruled']:
            reachable |= set(grp['unruled'])
    print(f'\n{len(reachable)} more cards are reachable with no new sourcing at all, '
          f'via an\nidentical-power sibling that already has a ruling '
          f'(python3 graph.py --transferable).')

    contra = [r for r in rulings.values() if r['contradicts']]
    if contra:
        print(f'\n{len(contra)} ruling(s) flagged as contradicting another on the same card')
        for r in contra:
            print(f'  {r["ruling_id"]} {r["card"]} vs {", ".join(r["contradicts"])}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--build', action='store_true', help='regenerate graph.json')
    ap.add_argument('--card', help='everything bearing on one card')
    ap.add_argument('--concept', help='every ruling touching a rule area')
    ap.add_argument('--concepts', action='store_true', help='list the rule areas')
    ap.add_argument('--transferable', action='store_true',
                    help='rulings an identical-power sibling should have and does not')
    ap.add_argument('--related', metavar='RULING_ID',
                    help='everything to read before judging one ruling')
    ap.add_argument('--coverage', action='store_true', help='where the corpus is thin')
    args = ap.parse_args()

    if args.build:
        g = build()
        print(f'{OUT_PATH}: {len(g["rulings"])} rulings, {len(g["cards"])} cards, '
              f'{len(g["concepts"])} concepts, {len(g["power_groups"])} same-power groups')
        mentions = sum(len(r['mentions']) for r in g['rulings'].values())
        print(f'{mentions} cross-reference edges recovered from \\textbf{{}} markup')
        return

    g = load()
    if args.concepts:
        for k, c in sorted(g['concepts'].items()):
            print(f'{len(c["rulings"]):5d}  {k:<26} {c["label"]}')
    elif args.card:
        show_card(g, args.card)
    elif args.concept:
        show_concept(g, args.concept)
    elif args.related:
        show_related(g, args.related)
    elif args.transferable:
        show_transferable(g)
    elif args.coverage:
        show_coverage(g)
    else:
        show_coverage(g)


if __name__ == '__main__':
    main()
