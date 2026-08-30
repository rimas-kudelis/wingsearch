"""Shared reading of the rulings corpus and the Stonemaier comment threads.

Used by propose.py; kept separate so the thread/trust logic can be
inspected and tested without touching anything that costs money.
"""

import json
import os
import re
import unicodedata

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
TSV_PATH = os.path.join(HERE, 'rulings.tsv')
COMMENTS_PATH = os.path.join(HERE, 'stonemaier-comments.json')
DATA_DIR = os.path.join(HERE, '..', '..', 'src', 'assets', 'data')

# Authors whose answers may become rulings. Derived by measurement, not vibes:
# ranked every author by how often they reply to someone *else*, then read their
# comments. See domain-knowledge.md §2 for the evidence per name.
#
#   Jamey Stegmaier / jameystegmaier  publisher; 1491 answers, two accounts
#   Joe Aubrey                        Stonemaier staff (confirmed by Matej), so his
#                                     337 answers are official, not merely a
#                                     well-informed fan's. Consistent with the
#                                     record: never corrected by Jamey, who backs
#                                     him explicitly ("I'll just chime in to back
#                                     up Joe").
#   Elizabeth Hargrave                designer. EXACT string only -- a different
#                                     person posts as bare "Elizabeth" and is
#                                     asking questions, not answering them.
TRUSTED = {
    'Jamey Stegmaier',
    'jameystegmaier',
    'Joe Aubrey',
    'Elizabeth Hargrave',
}

# Authoritative, but only for solo/Automa rules, which wingsearch does not cover.
# David Studley designs the Automa and signs as the Automa Team; `studleygamer`
# is the same person. Kept separate so an Automa answer can never silently become
# a card ruling.
TRUSTED_AUTOMA = {'David Studley', 'studleygamer'}


def load_cards():
    """Common name -> card, for birds, hummingbirds and bonus cards."""
    cards = {}
    for fn, kind in (('master.json', 'bird'), ('hummingbirds.json', 'hummingbird')):
        for c in json.load(open(os.path.join(DATA_DIR, fn), encoding='utf-8')):
            cards[c['Common name']] = dict(c, _kind=kind)
    for c in json.load(open(os.path.join(DATA_DIR, 'bonus.json'), encoding='utf-8')):
        cards[c['Bonus card']] = dict(c, _kind='bonus')
    return cards


def load_rulings():
    """(named, general) -- named is card name -> [rows], general is id -> row."""
    df = pd.read_csv(TSV_PATH, sep='\t', header=None,
                     names=['id', 'general', 'specific', 'text', 'source'])
    named, general = {}, {}
    for _, r in df.iterrows():
        row = {k: ('' if pd.isna(r[k]) else str(r[k]).strip()) for k in df.columns}
        if row['specific']:
            named.setdefault(row['specific'], []).append(row)
        else:
            general[row['id']] = row
    return named, general


def cited_comment_ids():
    """Stonemaier comment ids already used as a source somewhere in the TSV."""
    df = pd.read_csv(TSV_PATH, sep='\t', header=None,
                     names=['id', 'general', 'specific', 'text', 'source'])
    out = set()
    for s in df['source'].dropna():
        out.update(re.findall(r'#comment-(\d+)', str(s)))
    return out


def load_threads():
    """[{'root': id, 'comments': [...], 'authoritative': bool, 'automa': bool}]"""
    db = json.load(open(COMMENTS_PATH, encoding='utf-8'))
    cs = db['comments']
    parent = {c['id']: c['parent'] for c in cs.values()}

    def root(i):
        seen = set()
        while parent.get(i) and i not in seen:
            seen.add(i)
            i = parent[i]
        return i

    grouped = {}
    for c in cs.values():
        grouped.setdefault(root(c['id']), []).append(c)

    threads = []
    for rid, comments in grouped.items():
        comments.sort(key=lambda c: c['date'])
        authors = {c['author'] for c in comments}
        threads.append({
            'root': rid,
            'page': db['pages'].get(str(comments[0]['post']), {}).get('title', '?'),
            'comments': comments,
            'authoritative': bool(authors & TRUSTED),
            'automa': bool(authors & TRUSTED_AUTOMA),
            'date': max(c['date'] for c in comments)[:10],
        })
    threads.sort(key=lambda t: t['date'])
    return threads


# Card names that are also ordinary Wingspan vocabulary. `Bird Feeder` is the worst
# offender by a distance: 142 mentions in the corpus, nearly all of them the dice tower
# rather than the bonus card ("roll the dice not in the bird feeder"). Matching it
# blindly drags 38 threads into the candidate pool on a false positive. These names only
# count when the thread is visibly talking about bonus cards.
AMBIGUOUS = {'Bird Feeder'}
_BONUS_CONTEXT = re.compile(r'bonus\s*card|bonus\b', re.IGNORECASE)


def fold(s):
    """Strip diacritics. Seven cards are spelled with macrons or an acute -- `Tūī`,
    `Kākāpō`, `Kererū`, `Pūkeko`, `North Island Kōkako`, `South Island Takahē`,
    `Chiloé Wigeon` -- and almost nobody types them that way in a comment. Matching
    unfolded finds `Tūī` 10 times in the corpus; folded finds it 36."""
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))


def _key(name):
    """Comparison key: diacritics folded, hyphens and spaces equivalent, case-insensitive."""
    return re.sub(r'[- ]+', ' ', fold(name).lower()).strip()


def name_matcher(cards):
    """Regex matching any card name. Longest-first so 'Common Raven' beats 'Raven'.

    Matches against folded text (see `fold`), and treats hyphens and spaces as
    interchangeable: people write "California Scrub Jay" for `California Scrub-Jay`,
    and 176 of the card names are hyphenated.
    """
    names = sorted((fold(n) for n in cards), key=len, reverse=True)
    alts = (re.escape(n).replace(r'\-', '[- ]').replace(r'\ ', '[- ]') for n in names)
    return re.compile(r'(?<![\w-])(' + '|'.join(alts) + r')(?![\w-])', re.IGNORECASE)


def canonical(cards, matched):
    """Map a loose match back to the card's real Common name."""
    return {_key(n): n for n in cards}.get(_key(matched), matched)


def cards_in(cards, pat, text):
    """Card names a piece of text is plausibly about, ambiguity guard applied."""
    found = {canonical(cards, m.group(1)) for m in pat.finditer(fold(text))}
    if found & AMBIGUOUS and not _BONUS_CONTEXT.search(text):
        found -= AMBIGUOUS
    return sorted(found)


def thread_text(thread, limit=None):
    parts = []
    for c in thread['comments']:
        tag = ' [OFFICIAL]' if c['author'] in TRUSTED else ''
        body = c['text'] if limit is None else c['text'][:limit]
        parts.append(f'[{c["date"][:10]}] {c["author"]}{tag} (comment {c["id"]}):\n{body}')
    return '\n\n'.join(parts)
