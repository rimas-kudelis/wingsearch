#!/usr/bin/env python3
"""Fetch the Wingspan rules-question comment threads from stonemaiergames.com.

Stonemaier runs WordPress with the REST API open, so the FAQ discussions under
each game page are readable without auth or scraping:

    /wp-json/wp/v2/comments?post=<page id>&per_page=100&page=<n>

Each comment carries `author_name`, `date`, `parent` (so question->answer
threading is explicit, not guessed) and an `id` that gives a permanent public
`#comment-<id>` anchor -- the same citation format the existing corpus already
uses. That combination is why this is the backbone of rulings ingestion and the
Facebook group is not.

Writes `stonemaier-comments.json`: every comment, plus the thread each belongs
to. Idempotent and incremental -- existing comments are kept, so re-running
picks up only what is new.

    python3 fetch_stonemaier.py             # refresh
    python3 fetch_stonemaier.py --stats     # summarise what is on disk
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, 'stonemaier-comments.json')

BASE = 'https://stonemaiergames.com/wp-json/wp/v2'
UA = 'wingsearch-rulings/1.0 (+https://github.com/navarog/wingsearch)'

# Wingspan pages only -- Wyrmspan (26515) is a different game and its rulings do
# not apply. Verified 2026-08-30; run --discover if a page 404s or a new
# expansion appears.
PAGES = {
    13001: 'Wingspan Rules & FAQ',
    14609: 'European',
    15100: 'Oceania',
    21628: 'Asia',
    32949: 'Americas',
    34272: 'Pocket',
}


def get(path, **params):
    url = f'{BASE}/{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(1, 5):
        try:
            with urllib.request.urlopen(req, timeout=60) as f:
                return json.load(f), dict(f.headers)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code == 400:
                return None, {}          # past the last page
            if attempt == 4:
                raise
            print(f'    ! {type(e).__name__} {e}, retry {attempt}', flush=True)
            time.sleep(2 ** attempt)


def discover():
    """Print candidate page ids, for when PAGES goes stale."""
    seen = {}
    for term in ('wingspan', 'wingspan asia', 'wingspan americas', 'wingspan oceania',
                 'wingspan european', 'wingspan pocket'):
        hits, _ = get('search', search=term, per_page=20, type='post')
        for h in hits or []:
            seen[h['id']] = h['title']
    for pid, title in sorted(seen.items()):
        _, hdr = get('comments', post=pid, per_page=1)
        print(f'  {pid:>7}  {hdr.get("X-WP-Total", "?"):>5} comments  {title}')


def fetch_page(pid, label):
    out, page = [], 1
    while True:
        batch, hdr = get('comments', post=pid, per_page=100, page=page,
                         orderby='date', order='asc')
        if not batch:
            break
        out.extend(batch)
        total = int(hdr.get('X-WP-Total', 0))
        print(f'  {label:<22} page {page:>2}  {len(out):>5}/{total}', flush=True)
        if len(out) >= total:
            break
        page += 1
        time.sleep(0.4)                  # be a polite guest
    return out


def clean(html):
    import re
    txt = re.sub(r'<br\s*/?>', '\n', html or '')
    txt = re.sub(r'</p>', '\n\n', txt)
    txt = re.sub(r'<[^>]+>', '', txt)
    txt = (txt.replace('&#8217;', "'").replace('&#8216;', "'")
              .replace('&#8220;', '"').replace('&#8221;', '"')
              .replace('&#8211;', '-').replace('&#8212;', '--')
              .replace('&amp;', '&').replace('&nbsp;', ' ')
              .replace('&lt;', '<').replace('&gt;', '>').replace('&#8230;', '...'))
    return re.sub(r'\n{3,}', '\n\n', txt).strip()


def load():
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {'pages': {}, 'comments': {}}


def stats(db):
    from collections import Counter
    cs = db['comments']
    print(f'{len(cs)} comments across {len(db["pages"])} pages')
    for pid, meta in sorted(db['pages'].items(), key=lambda kv: -kv[1]['count']):
        print(f'  {meta["count"]:>5}  {meta["title"]}   (fetched {meta["fetched"]})')
    authors = Counter(c['author'] for c in cs.values())
    print(f'\n{len(authors)} distinct authors; top 12:')
    for a, n in authors.most_common(12):
        print(f'  {n:>5}  {a}')
    dates = sorted(c['date'] for c in cs.values())
    print(f'\ndate range {dates[0][:10]} .. {dates[-1][:10]}')
    replies = sum(1 for c in cs.values() if c['parent'])
    print(f'{replies} are replies, {len(cs) - replies} are top-level')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stats', action='store_true')
    ap.add_argument('--discover', action='store_true')
    args = ap.parse_args()

    if args.discover:
        discover()
        return

    db = load()
    if args.stats:
        if not db['comments']:
            sys.exit('nothing fetched yet')
        stats(db)
        return

    before = len(db['comments'])
    for pid, label in PAGES.items():
        for c in fetch_page(pid, label):
            db['comments'][str(c['id'])] = {
                'id': c['id'],
                'post': c['post'],
                'parent': c['parent'] or None,
                'author': c['author_name'],
                'date': c['date'],
                'link': c['link'],
                'text': clean(c['content']['rendered']),
            }
        db['pages'][str(pid)] = {
            'title': label,
            'count': sum(1 for c in db['comments'].values() if c['post'] == pid),
            'fetched': time.strftime('%Y-%m-%d'),
        }

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(db, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write('\n')
    print(f'\n{len(db["comments"])} comments ({len(db["comments"]) - before} new) '
          f'-> {os.path.relpath(OUT_PATH)}')
    stats(db)


if __name__ == '__main__':
    main()
