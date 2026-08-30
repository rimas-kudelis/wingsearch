# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wingsearch is a client-side search app for the Wingspan board game card collection, published as a PWA at https://navarog.github.io/wingsearch/. There is no backend — all card data ships as JSON bundled into the app, and all searching/filtering happens in the NgRx reducer.

Angular 9 + NgRx 10 + Angular Material, TypeScript 3.8, SCSS. Node 14 / npm 6 (see `engines` and `.nvmrc`, pinned to v14.21.3) — newer Node will fail the build. Node 14 ships npm 6, which matches `package-lock.json`'s lockfileVersion 1; installing under npm 8 rewrites the lockfile, so don't.

## Commands

```bash
npm start              # dev server on :4200
npm run test:ci        # specs in headless Chrome, non-interactive (what CI runs)
npm test               # specs in watch mode
npm run lint           # tslint; clean, and blocking in CI — keep it that way
npm run preview        # build + serve an exact production replica (see below)
npm run build-pages    # production build into dist/wingsearch (what CI deploys)
```

Docker alternative (avoids installing Node 14 locally): `docker compose up` serves the dev server on `$WEB_PORT` (default 8080) with `src/` mounted read-only.

### Verifying a change looks right in production

`npm run preview` builds with the real `/wingsearch/` base href into `.preview/wingsearch/` and serves the *parent* directory, so the app is reachable at **http://localhost:8080/wingsearch/** and behaves exactly as it does live. Use this rather than `build-local` + `http-server`, which serve at base href `/` and therefore cannot reproduce subpath asset or routing bugs. `npm run serve-preview` re-serves an existing build without rebuilding.

### Tests

`src/app/store/app.reducer.spec.ts` holds 61 characterization specs covering text search, every attribute filter, the bonus-card filter branch, pagination, and the `setLanguage`/`resetLanguage` round trip (~91% statement coverage of the store).

These specs deliberately **pin current behaviour, including where it is wrong**. Known-buggy behaviour is pinned with a comment naming the issue rather than corrected, so a fix is always a deliberate test change. Don't "fix" a failing spec by loosening the assertion — work out which side is wrong first.

Angular schematics are configured with `skipTests: true`, so generated components come without specs.

## Deployment

`.github/workflows/ci.yml` owns the build. Every PR and every push to master installs from the lockfile, lints, runs the specs, and builds. On master the `deploy` job is gated on the protected `github-pages` environment, so **a push builds and then waits for manual approval** — nothing reaches users without a click. Every run also uploads the built site as a downloadable artifact for local inspection.

Lint is blocking as of 2026-08-30, when the 172-violation backlog was cleared. 159 of those were `ng lint --fix`; the 13 judgement calls are described in the commit that cleared them.

The site used to be published by committing a production build into `docs/` (`npm run build-prod` + a "Publish changes" commit) and pointing Pages at that directory. Both the directory and the script are gone as of the first Actions deploy (run 33307156204, 2026-08-30) — never re-add a committed build artifact. Old commits still contain `docs/`, so `git log`/`git blame` over that path will turn up ~2300 files of generated output; ignore them.

## Architecture

### One reducer does everything

[src/app/store/app.reducer.ts](src/app/store/app.reducer.ts) holds essentially all business logic. There are no feature stores and only one non-trivial effect.

The `search` action carries the *entire* query object (text, selected bonus cards, expansions, promo packs, habitat/type toggles, egg/point/wingspan/food-cost ranges, colors, food, nest, beak direction) — [src/app/search/search.component.ts](src/app/search/search.component.ts) owns that object as mutable component state and re-dispatches the whole thing on every control change. The reducer then:

1. Runs the FlexSearch text query across bird fields (`Common name`, `Scientific name`, `Power text`) and bonus fields (`Bonus card`, `Condition`, `VP`), unioning results.
2. Falls back to the full card list when the query is empty.
3. If bonus cards are selected as filters, drops all bonus cards from the result and keeps only birds satisfying every selected bonus predicate; otherwise appends matching bonus cards.
4. Applies the remaining attribute filters in sequence.
5. Recomputes `displayedStats` and re-paginates.

Pagination is manual: `SLICE_WINDOW = 18`. Results are split into `displayedCards` (rendered) and `displayedCardsHidden` (rest); `ngx-infinite-scroll` in [src/app/display/display.component.ts](src/app/display/display.component.ts) dispatches `scroll` to move the next 18 across, and `scrollDisabled` flips true when the hidden list empties.

### Card model and the CardType discriminator

Bird cards, hummingbird cards, and bonus cards live in the same arrays and are distinguished by a `CardType` field (`'Bird' | 'Hummingbird' | 'Bonus'`) via the type guards in [src/app/store/app.interfaces.ts](src/app/store/app.interfaces.ts) (`isBirdCard`, `isHummingbirdCard`, `isBirdOrHummingbirdCard`, `isBonusCard`). Hummingbirds share the `BirdCard` interface but the notebook synthesizes their missing fields (0 VP, no nest, all three habitats, etc.). `state.birdCards` is always birds **and** hummingbirds concatenated — most filter code must therefore branch on the guards rather than assuming a shape.

The reducer is full of `// @ts-ignore`: the JSON imports are typed structurally by `resolveJsonModule` and don't line up with the hand-written interfaces. Match the existing style rather than trying to fix the typing wholesale.

### Card IDs are positional and load-bearing

The Python pipeline assigns `id` from *sorted row position* (`master.index + 2`, hummingbirds `index + 20`). Those ids are used as:

- URL segments (`/card/:id`)
- keys in every `src/assets/data/i18n/*.json` file (`birds`, `bonuses`, `goals` are keyed by id string)
- card art filenames (`src/assets/cards/birds/<id>.webp`, and the packs)
- keys in `bonusSearchMap` (bonus ids 1000–1060)
- FlexSearch document ids

So **inserting a bird into `wingspan-card-list.xlsx` shifts ids of later birds** and silently desynchronizes translations, artwork, and links. Regenerating data means checking all of those.

### Bonus card predicates

[src/app/store/bonus-search-map.ts](src/app/store/bonus-search-map.ts) maps each bonus card id to a `BonusMatch(isPercentage, callbackfn)`. `callbackfn` decides whether a bird qualifies; `isPercentage` says whether the card shows a "% of cards" figure. `dynamicPercentage(birds, expansion)` recomputes each bonus card's `%` against only the *currently enabled expansions*, so bonus cards are re-mapped through it wherever they're emitted (search, language change, and the `selectCard` router selector). Adding a bonus card requires a new entry here — cards without one will throw on filter.

### Internationalization

Runtime translation, not Angular i18n. There is no compile-time locale build.

- `AppEffects` ([src/app/store/app.effects.ts](src/app/store/app.effects.ts)) reacts to `ROOT_EFFECTS_INIT` and `changeLanguage`, reads the `language` cookie, HTTP-fetches `assets/data/i18n/<lang>.json`, and dispatches `[App] Set language`.
- `setLanguage` in the reducer merges translated fields over the English card (blank cells fall through to English via the `englishBirdCardsMap`/`englishBonusCardsMap` lookups), **re-sorts** cards with `localeCompare` for that locale, and **rebuilds both FlexSearch indexes**. `resetLanguage` restores the English arrays.
- `TranslatePipe` translates static UI strings from the `other` sheet. It's both declared as a pipe and provided as a service, and components inject it directly (e.g. `bird-card.component.ts` for power titles).
- Card text embeds icon markers like `[forest]`, `[wetland]`, `[card]`; `IconizePipe` expands them into `<picture>` elements pointing at `assets/icons/png/<name>.{webp,png}`, with `dark`/`glow` variant maps. Translators must preserve these markers — see [i18n/README.md](i18n/README.md) for the full icon table and sheet-by-sheet field docs.
- `parameters` (from the i18n file, falling back to `src/assets/data/parameters.json`) are per-language feature flags, e.g. `Show bonus cards match symbols`, which appends `[anatomist]`-style icons to bird names.

### Routing and card detail

`app-routing.module.ts` defines a single route `card/:id` that renders `AppComponent` itself — the detail view is a Material dialog, not a routed component. `selectCard` in [src/app/store/router.ts](src/app/store/router.ts) resolves the route param against the card arrays; `DisplayComponent` subscribes and opens/updates/closes dialogs with fixed dialog ids (`'0'` bird, `'1'` bonus, `'2'` hummingbird), navigating back to `/` on close. `ApplinkDirective` intercepts clicks on `applink="/card/<id>"` attributes injected into ruling text by the data pipeline, turning them into router navigations.

### Cookies, consent, and preferences

`CookiesService.setCookie` is a no-op unless the `consent` cookie is `'1'` (`ConsentComponent` sets it). Preferences persisted as cookies: `language`, `assetPack`, and `expansion.<core|european|oceania|asia|americas|promoAsia|promoCA|promoEurope|promoNZ|promoUK|promoUS>` (`'0'` means off; *absent* means on, hence the `!== '0'` checks). Initial state is read from cookies in three places — `initialState`, `AppEffects`, and the `SearchComponent` constructor — keep them in sync when adding a preference.

### Asset packs (hidden feature)

Default art is `silhouette` (`assets/cards/birds/<id>.webp`). Alternative packs live in `assets/cards/birds-robbie/` and `assets/cards/birds-diffusion/`; `src/assets/data/extra-assets.json` indexes which ids each pack actually covers, and `getBirdSilhouette()` falls back to the silhouette when a pack lacks the id. The pack selector is only rendered when the search box contains exactly `images` (see `search.component.html`).

## Data pipeline

`scripts/` is maintainer tooling in three groups — `transform/` (spreadsheets → JSON), `rulings/` (the official-rulings pipeline), `images/` (card art) — with Python deps in `scripts/requirements.txt` and an orientation map in [scripts/README.md](scripts/README.md). **None of it runs during a build or in CI**; the committed JSON under `src/assets/data/` is the only contract between `scripts/` and the app.

Source spreadsheets in [scripts/transform/](scripts/transform/), transformed by Jupyter notebooks that **write straight into `src/assets/data/`** (there is no `scripts/generated/` step, whatever old docs say):

- [scripts/transform/json-transformer.ipynb](scripts/transform/json-transformer.ipynb) reads `wingspan-card-list.xlsx` (sheets `Birds`, `Hummingbirds`, `Goals`), `wingspan-note-list.xlsx` (sheets `Bonus`, `Birds` for native names/notes, `Parameters`), and `rulings/rulings.tsv`; assigns ids; converts LaTeX-ish ruling markup (`\textbf{}`, `\textit{}`, quotes) into HTML with `applink` attributes; attaches per-card `rulings` and `additionalRulings` (see "General rulings" below); and emits `master.json`, `hummingbirds.json`, `bonus.json`, `general.json`, `goals.json`, `parameters.json`.
- [scripts/transform/language-to-json.ipynb](scripts/transform/language-to-json.ipynb) converts every `i18n/*.xlsx` (except `template.xlsx`) into `src/assets/data/i18n/<lang>.json`.

Run either without Jupyter via `scripts/transform/run.py <notebook-name>`, which execs its code cells in order — that is how `rulings/refresh.sh` regenerates the data. Both notebooks resolve every path from the repo root, so they behave identically from Jupyter, from `run.py`, and from any cwd inside the checkout; don't reintroduce cwd-relative paths.

`json-transformer.ipynb` is verified to regenerate all six JSON files **byte-identically** from the committed spreadsheets under pandas 3.0.1 (re-checked 2026-08-30 after the `scripts/` reorg). If you change it, re-verify that way before committing regenerated data: `git show HEAD:src/assets/data/<f>.json` into a temp dir, run the notebook, `cmp` each file. Beware chained assignment — pandas 3 copy-on-write makes `df['col'].loc[mask] = x` a silent no-op, which previously would have blanked `Nest type` on the 8 brood parasites. Use `df.loc[mask, 'col'] = x`.

Note `scripts/transform/wingspan-bonuscard-list.xlsx` is *not* read by the notebook — bonus card data comes from `wingspan-note-list.xlsx`. Only `master.json`, `hummingbirds.json`, `bonus.json`, `extra-assets.json`, and `parameters.json` are consumed by the app; `general.json` and `goals.json` are generated but currently unused at runtime.

### General rulings (`additionalRulings`)

A ruling row in `scripts/rulings/rulings.tsv` with no card name is *general* and fans out to many birds. That fan-out is two gates, not one:

1. **Candidates** — a regex per ruling id in [scripts/rulings/general_map.py](scripts/rulings/general_map.py). Deliberately broad; a false positive is recoverable here, a false negative is not.
2. **Decision** — [scripts/rulings/applicability.json](scripts/rulings/applicability.json), per-card verdicts with reasons, generated by `scripts/rulings/audit.py` (Claude on Bedrock, run by hand, ~$3.50 for a full pass) and corrected by hand in `applicability-overrides.json`, which the generator never overwrites.

`rulings` — the name the notebook imports — is both gates combined, so the notebook needs no changes. **Only a high-confidence `does_not_apply` removes a ruling**; anything the model was unsure of stays attached and is queued under `uncertain`, so hedging cannot silently delete content. Delete the JSON and behaviour reverts to regex-only.

Never put the audit — or any other model-calling stage — in the build path. The committed JSON is what the build reads, which keeps CI hermetic, deterministic and free. `src/app/store/rulings.spec.ts` pins per-ruling attachment counts, keyed by the ruling `id` that every entry in `rulings`/`additionalRulings` carries, so regenerating `master.json` or editing a predicate fails CI instead of quietly changing what players read; update the counts in the same commit and say why.

[scripts/rulings/domain-knowledge.md](scripts/rulings/domain-knowledge.md) is the substantive background — how rulings reach a card, which sources are trustworthy, known failure modes, and the rules for judging applicability. It is fed to the model as prompt context, so **an error in it is a prompt bug that produces wrong rulings**, not just stale docs. Read it before touching any of this.

### Refreshing the rulings

[scripts/rulings/refresh.sh](scripts/rulings/refresh.sh) is the whole pipeline in one command. It needs Bedrock credentials (`export AWS_PROFILE=...`) and Node 14 for the last stage, and it never pushes, deploys or commits — the working tree diff is the review.

```bash
scripts/rulings/refresh.sh --dry-run     # report what every stage would do, call nothing
scripts/rulings/refresh.sh               # the full pass
scripts/rulings/refresh.sh --no-curate   # append new rulings but leave existing pages alone
```

Six stages, each incremental and safe to re-run — a thread already judged is not paid for twice, a ruling already in the TSV is not appended twice, a card whose ruling list has not changed is not re-curated. With nothing new upstream the whole run is a free no-op, so `--dry-run` is the cheap way to see where things stand:

1. `fetch_stonemaier.py` — new comments from the FAQ pages into `stonemaier-comments.json`.
2. `propose.py` — judge unseen threads into `proposals.json`.
3. `propose.py --emit-tsv` — append accepted proposals as rows in `rulings.tsv`.
4. `curate.py` — for each card that just gained a ruling, propose a merge/reorder/rewrite plan into `curation.json`, then apply the high-confidence ones.
5. `transform/run.py json-transformer` — regenerate `src/assets/data`.
6. `npm run test:ci`.

Two things make this safe to automate. First, **`proposals.json` and `curation.json` are review queues, not caches**: only high-confidence output is applied, and anything the model hedged on stays queued as pending for a human, so hedging can never silently publish or delete a ruling. Second, `curate.py` wraps the model in deterministic gates — it may be wrong about ordering, but a plan that drops a ruling, invents an id, or emits markup the renderer cannot handle (anything beyond `\textbf`/`\textit`, an unknown `[icon]` marker, curly quotes) is rejected before it reaches the TSV.

Curation edits `rulings.tsv` in place, and per-card display order *is* TSV row order (the notebook's `groupby().apply()` preserves it), so a reorder is a row reorder. Merging drops the absorbed rows' source URLs, which is why `propose.py` derives "already applied" from citations **unioned with** `curation.json`'s `superseded` list — from citations alone, every merged ruling would be re-appended on the next run, forever.

After a run: read the TSV diff, then the queues (`proposals.json` entries with `"review": "pending"`, `curation.json` plans with `confidence != high` or a non-empty `warnings`). If `rulings.spec.ts` failed, a general ruling's fan-out changed — update the pinned counts in the same commit and say why.

### Image tooling

In [scripts/images/](scripts/images/); requires ImageMagick / cwebp / OpenCV and operates on the gitignored `new_assets/`: `psd-to-png.sh`, `organize-birds.py` (fuzzy-matches filenames to card names and renames to `<id>.png`), `process-silhouettes.py`, `flip-horizontal.sh`, `webp.sh` (bulk PNG/JPG → WebP), `index-extra-assets.sh` (regenerates `extra-assets.json` from directory listings), `ai-bird-art/`.

## Conventions

- Semicolons are omitted in TypeScript. Store files use 4-space indentation; components use 2-space.
- Card fields are accessed by their human-readable spreadsheet names (`card['Egg limit']`, `card['Nest type']`, `card['Victory points']`) — bracket notation with spaces is normal here.
- tslint config is `tslint:recommended` plus `semicolon: never`, `quotemark: single`, `object-literal-key-quotes: as-needed`, `max-line-length: 140` and the codelyzer rules; directive selectors must therefore be `app`-prefixed camelCase (`appLinkWatcher`, `appFitText`).
