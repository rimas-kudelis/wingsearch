"""General ruling -> card matching.

Historically the predicates below *were* the decision: whatever regex matched a
card's Power text got the ruling attached. That over-applies badly (`20200404`
matched 474 of 707 birds on the bare word "draw"), because a word-level match
cannot tell a cost from a benefit, or cards from food.

So the predicates are now only a **candidate generator**. The decision lives in
`applicability.json`, a reviewed per-card verdict produced by
`audit.py`. `rulings` -- the name the notebook imports -- is the two
gates combined, so `json-transformer.ipynb` needs no changes.

If `applicability.json` is missing, every candidate is accepted and the
behaviour is exactly what it was before the audit existed.

See `domain-knowledge.md` for the full background.
"""

import functools
import json
import os
import re

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
APPLICABILITY_PATH = os.path.join(_HERE, 'applicability.json')
OVERRIDES_PATH = os.path.join(_HERE, 'applicability-overrides.json')


# Regexes that propose cards a general ruling *might* apply to. Deliberately
# broad: a false positive here is caught by the audit, a false negative is not
# recoverable, so err towards matching.
#
# NOTE: compare Color case-insensitively. The data stores it lowercase
# ('brown', 'white', 'teal', 'pink', 'yellow'); comparing to 'Pink' silently
# matched nothing and kept four pink-timing rulings off all 51 pink birds.
candidates = {
    '02c': lambda row: False,
    '02g': lambda row: not pd.isna(row['Power text']) and re.search(r"gain.*birdfeeder", row['Power text'], re.IGNORECASE) is not None,
    '03a': lambda row: not pd.isna(row['Power text']) and re.search(r"counts double", row['Power text'], re.IGNORECASE) is not None,
    '20190122': lambda row: False,
    '20190205': lambda row: _is_pink(row),
    '20190313': lambda row: _is_pink(row),
    '20190601': lambda row: not pd.isna(row['Power text']) and re.search(r"gain", row['Power text'], re.IGNORECASE) is not None and re.search(r"supply", row['Power text'], re.IGNORECASE) is not None and re.search(r"steal", row['Power text'], re.IGNORECASE) is None and re.search(r"give", row['Power text'], re.IGNORECASE) is None,
    '20190908': lambda row: not pd.isna(row['Power text']) and re.search(r"at the end of your turn", row['Power text'], re.IGNORECASE) is not None and re.search(r"keep [0-9]+ and discard the rest", row['Power text'], re.IGNORECASE) is None,
    '20191010': lambda row: not pd.isna(row['Power text']) and re.search(r"at the end of your turn", row['Power text'], re.IGNORECASE) is not None,
    '20191202': lambda row: False,
    '20191203c': lambda row: False,
    '20200109a': lambda row: False, # TODO think about implementation for this one
    '20200208': lambda row: _is_pink(row),
    '2020022b': lambda row: not pd.isna(row['Power text']) and re.search(r"it becomes a tucked card", row['Power text'], re.IGNORECASE) is not None,
    '20200330': lambda row: _is_pink(row),
    '20200404': lambda row: not pd.isna(row['Power text']) and re.search(r"(\s|^)draw|(\s|^)lay|(\s|^)gain", row['Power text'], re.IGNORECASE) is not None,
    '20200511': lambda row: not pd.isna(row['* (food cost)']),
    '20200712': lambda row: False,
    '20200716a': lambda row: row['Common name'] in ['American Oystercatcher', 'Belted Kingfisher', 'Eastern Kingbird'],
    '20200716b': lambda row: not pd.isna(row['Power text']) and re.search(r"play a bird|play a second bird|play another bird|play 1 bird", row['Power text'], re.IGNORECASE) is not None,
    '20201003': lambda row: False,
    '20201009': lambda row: False,
    '20201116a': lambda row: False,
    '20201117': lambda row: not pd.isna(row['Power text']) and re.search(r"discard.*\[(egg|seed|invertebrate|fish|fruit|nectar|wild|rodent)\]", row['Power text'], re.IGNORECASE) is not None,
    '20210101': lambda row: False,
    '20201211': lambda row: False,
    '20210199a': lambda row: False,
    '20210199b': lambda row: False,
    '20210206': lambda row: not pd.isna(row['Power text']) and re.search(r"place this bird sideways", row['Power text'], re.IGNORECASE) is not None,
    '20210920': lambda row: _is_teal(row),
    '20210318': lambda row: not pd.isna(row['Power text']) and re.search(r"this bird counts double toward the end-of-round goal", row['Power text'], re.IGNORECASE) is not None,
}


def _is_color(row, color):
    value = row['Color']
    return not pd.isna(value) and str(value).strip().lower() == color


def _is_pink(row):
    return _is_color(row, 'pink')


def _is_teal(row):
    return _is_color(row, 'teal')


def _load(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_applicability():
    """ruling id -> {'excluded': {card: reason}, ...}, overrides layered on top."""
    verdicts = _load(APPLICABILITY_PATH)
    for rid, entry in _load(OVERRIDES_PATH).items():
        merged = dict(verdicts.get(rid, {}))
        for key in ('applies', 'excluded', 'uncertain'):
            if key in entry:
                merged[key] = entry[key]
        verdicts[rid] = merged
    return verdicts


applicability = load_applicability()


def applies(ruling_id, row):
    """True when the card is both a candidate and not excluded by the audit."""
    candidate = candidates.get(ruling_id)
    if candidate is None or not candidate(row):
        return False
    verdict = applicability.get(ruling_id)
    if not verdict:
        # Not audited yet: keep the pre-audit behaviour rather than dropping the
        # ruling silently.
        return True
    name = row['Common name']
    if name in (verdict.get('excluded') or {}):
        return False
    # Cards in 'uncertain' -- and cards the audit has not seen at all -- keep the
    # pre-audit behaviour. Only a confident exclusion removes a ruling, so model
    # hedging can never silently delete content; it just queues a question.
    return True


# The name json-transformer.ipynb imports. Same shape as before -- a dict of
# ruling id -> callable(row) -> bool -- so the notebook is unchanged.
rulings = {rid: functools.partial(applies, rid) for rid in candidates}
