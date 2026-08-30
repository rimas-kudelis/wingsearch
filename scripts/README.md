# scripts/

Everything here is a maintainer tool. None of it runs during `npm start`, `npm run
build-pages`, or in CI — the app ships the committed JSON under `src/assets/data/`, and
that JSON is the only contract between this directory and the app. So a broken script
here cannot break the site, and nothing here needs to be fast, hermetic, or free.

Python 3.12, dependencies in [requirements.txt](requirements.txt):

```bash
python3 -m pip install -r scripts/requirements.txt
```

## [transform/](transform/) — spreadsheets → `src/assets/data/`

The card data lives in Excel, edited by hand, and two notebooks turn it into the JSON the
app imports. This is the only path by which card data changes.

| | |
|---|---|
| `wingspan-card-list.xlsx` | sheets `Birds`, `Hummingbirds`, `Goals` |
| `wingspan-note-list.xlsx` | sheets `Bonus`, `Birds` (native names, notes), `Parameters` |
| `wingspan-bonuscard-list.xlsx` | **read by nothing.** Superseded by the `Bonus` sheet above; kept because it is the older source of record |
| `json-transformer.ipynb` | → `master.json`, `hummingbirds.json`, `bonus.json`, `general.json`, `goals.json`, `parameters.json` |
| `language-to-json.ipynb` | `i18n/*.xlsx` → `src/assets/data/i18n/<lang>.json` |
| `run.py` | runs a notebook's code cells without Jupyter |

Open them in Jupyter to edit, or run them headless:

```bash
scripts/transform/run.py json-transformer
scripts/transform/run.py language-to-json
```

Both resolve their paths from the repo root, so either way of running them, from any
directory inside the checkout, reads and writes the same files.

Two things to know before touching card data: card **ids are positional** and load-bearing
(URL segments, i18n keys, art filenames), so inserting a row renumbers every later card;
and `json-transformer.ipynb` is verified to reproduce all six JSON files byte-identically
from the committed spreadsheets under the pinned pandas. Both are spelled out in
[CLAUDE.md](../CLAUDE.md#data-pipeline), which is the document to read first.

## [rulings/](rulings/) — official rulings

Ingests answers from the publisher's FAQ pages and turns them into the `rulings` and
`additionalRulings` fields on each card. Several stages call an LLM; **none of them run in
the build**. The committed JSON in this directory is the output, reviewed by a human, and
the app only ever sees what the notebook wrote from it.

```
fetch_stonemaier.py   FAQ pages       -> stonemaier-comments.json
propose.py            comment threads -> proposals.json      -> rows in rulings.tsv
audit.py              general rulings -> applicability.json   (which cards a rule reaches)
curate.py             a card's list   -> curation.json        (merge, reorder, rewrite)
general_map.py        regex candidates for each general ruling; imported by the notebook
corpus.py             shared reading of rulings.tsv and the comment threads
refresh.sh            all of the above, in order, incrementally
```

`rulings.tsv` is the corpus: no header, tab-separated, `id / general / specific / text /
source`. Row order within a card is its display order on the site.

One command does a full pass, and is safe and free to re-run when nothing is new:

```bash
export AWS_PROFILE=...            # Bedrock, for the judging and curation stages
scripts/rulings/refresh.sh --dry-run     # report what each stage would do
scripts/rulings/refresh.sh               # do it; leaves the diff for you to review
```

`proposals.json` and `curation.json` are review queues, not caches: anything the model was
unsure of stays in them marked pending, so hedging can never silently publish or delete a
ruling. Read [domain-knowledge.md](rulings/domain-knowledge.md) before changing any of
this — it is fed to the model as prompt context, so an error in it is a prompt bug that
produces wrong rulings, not merely stale documentation.

## [images/](images/) — card art

Bulk tools for preparing card art, all operating on the gitignored `new_assets/`. They
need ImageMagick, `cwebp` and OpenCV, and are the least load-bearing thing here.

| | |
|---|---|
| `psd-to-png.sh` | flatten PSDs |
| `organize-birds.py` | fuzzy-match filenames to card names, rename to `<id>.png` |
| `process-silhouettes.py` | cut out and normalise silhouettes |
| `flip-horizontal.sh` | mirror art so birds face the same way |
| `webp.sh` | bulk PNG/JPG → WebP |
| `index-extra-assets.sh` | regenerate `extra-assets.json` from directory listings |
| `ai-bird-art/` | generated art experiment; has its own `requirements.txt` |
