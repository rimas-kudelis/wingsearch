# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wingsearch is a client-side search app for the Wingspan board game card collection, published as a PWA at https://navarog.github.io/wingsearch/. There is no backend — all card data ships as JSON bundled into the app, and all searching/filtering happens in the NgRx reducer.

Angular 22 + NgRx 22 + Angular Material, TypeScript 6.0, SCSS. Node 22 / npm 10 (see `engines` and `.nvmrc`, pinned to v22.23.2). Upgraded from Angular 9 / Node 14 on 2026-08-30 in one hand-written step — see "The Angular 22 upgrade" below for what that means for anything you read in an older commit.

## Commands

```bash
npm start              # dev server on :4200
npm run test:ci        # specs in headless Chrome, non-interactive (what CI runs)
npm test               # specs in watch mode
npm run lint           # eslint (angular-eslint); clean, and blocking in CI — keep it that way
npm run preview        # build + serve an exact production replica (see below)
npm run build-pages    # production build into dist/wingsearch (what CI deploys)
```

Docker alternative (avoids installing Node 22 locally): `docker compose up` serves the dev server on `$WEB_PORT` (default 8080) with `src/` mounted read-only.

### Verifying a change looks right in production

`npm run preview` builds with the real `/wingsearch/` base href into `.preview/wingsearch/` and serves the *parent* directory, so the app is reachable at **http://localhost:8080/wingsearch/** and behaves exactly as it does live. Use this rather than `build-local` + `http-server`, which serve at base href `/` and therefore cannot reproduce subpath asset or routing bugs. `npm run serve-preview` re-serves an existing build without rebuilding.

### Tests

`src/app/store/app.reducer.spec.ts` holds 61 characterization specs covering text search, every attribute filter, the bonus-card filter branch, pagination, and the `setLanguage`/`resetLanguage` round trip (~91% statement coverage of the store). `src/app/store/app.effects.spec.ts` constructs `AppEffects` for real against `HttpTestingController`; it exists because the one effect is a class field initialized from a constructor parameter property, which a compiler-flag default silently broke during the Angular 22 upgrade (see below). 124 specs in total.

These specs deliberately **pin current behaviour, including where it is wrong**. Known-buggy behaviour is pinned with a comment naming the issue rather than corrected, so a fix is always a deliberate test change. Don't "fix" a failing spec by loosening the assertion — work out which side is wrong first.

Angular schematics are configured with `skipTests: true`, so generated components come without specs.

Specs are the only automated check on the app shell, and they do not render it. A green suite plus a green AOT build **does not** mean the page works — the upgrade below produced exactly that state while serving a blank page. Before shipping anything that touches bootstrap, module providers, or a compiler flag, serve the real artifact and look at it:

```bash
npm run preview   # then http://localhost:8080/wingsearch/
```

A headless equivalent, useful when there is no browser to hand — an empty `<app-root>` is the failure signature:

```bash
npm run build-pages && cp -R dist/wingsearch /tmp/pagesroot/wingsearch
npx http-server /tmp/pagesroot -p 8126 -c-1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --virtual-time-budget=20000 --enable-logging=stderr --v=0 \
  --dump-dom http://localhost:8126/wingsearch/ 2>&1 | grep -a CONSOLE
```

## The Angular 22 upgrade

Angular 9 → 22, NgRx 10 → 22, TypeScript 3.8 → 6.0, Node 14 → 22, tslint → eslint, webpack → esbuild, done by hand on 2026-08-30 (branch `upgrade/angular`). The sequential `ng update` chain was not used and could not be: the CLI it installs to run the first hop already refuses to start on Node 14, and v15's Material MDC migration only emits the `legacy-*` imports that v17 deleted, so the MDC work was manual either way.

What this costs you when reading older material: anything written before this date about the toolchain — Node 14, npm 6, `lockfileVersion 1`, `tslint.json`, `src/polyfills.ts`, `src/test.ts`, `platformBrowserDynamic`, `browserslist`, `mat.core()`, `mat-chip-list` — is describing a stack that no longer exists. The lockfile is deliberately rewritten at lockfileVersion 3; the old warning not to touch it is void.

Deliberately kept out of the upgrade commit so that each is reviewable on its own. Landed since, as follow-ups on the same branch: `inject()` instead of constructor DI (`ng generate @angular/core:inject`, which also let `useDefineForClassFields` go back to the default — see below), and `@if`/`@for` instead of `*ngIf`/`*ngFor` (`ng generate @angular/core:control-flow`; every template, one commit, `prefer-control-flow` blocking afterwards). Still open: standalone components (every declarable carries `standalone: false`), `strict`/`strictTemplates`, and flexsearch 0.8's `Document` API (pinned at exactly 0.6.32 because 0.8 changes what the search returns). The lint rules covering the not-yet-done migrations are switched off in `eslint.config.js` with a note saying so; turn each back on in the commit that does the migration.

Two things bite anyone repeating this kind of change:

- **`useDefineForClassFields`.** An ES2022 target defaults it to `true`, which emits native class fields, which run *before* the constructor body rather than after it. `AppEffects.loadLanguage$ = createEffect(() => this.actions$.pipe(...))` therefore read an `undefined` constructor parameter property and threw during bootstrap — a blank page and one console line, with the build and all 119 specs green. The `inject()` migration removed the hazard rather than working around it (native fields initialize in declaration order, and the DI fields are declared first), so the flag is back at the modern default and `tsconfig.json` no longer pins it. `app.effects.spec.ts` constructs the effect for real and fails if the field order regresses.
- **`--output-path` on the command line.** `angular.json` sets `outputPath` to `{base, browser: ""}` so `index.html` lands flat, which is what `404.html` copying and the Pages artifact path expect. Passing `--output-path` as a *string* resets `browser` to its default and buries the build in a `browser/` subdirectory. That is why `build-preview` uses a `preview` configuration rather than a flag, and why `build-pages` no longer passes one at all.

Measured against the Angular 9 baseline: **production build 81s → ~22s** (esbuild), `npm ci` ~20s, specs 119 → 124 at the same runtime. Bundle size barely moved — `main.js` gzips to 536 kB against the old 556 kB, about 3.5% — because the bundle is mostly card JSON, not framework. The `~338 kB` the CLI prints is its own brotli estimate and is not comparable to that gzip figure. `dist/wingsearch` is 97M, of which 87M is card art copied verbatim from `src/assets`; the fonts and CSS-referenced images that `--resourcesOutputPath=assets/generated` used to place under `assets/` now sit in `media/` (5.8M), still duplicating files that the wholesale `assets` copy also ships. Deduplicating that is Track D work, not upgrade work.

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
- Card text embeds icon markers like `[forest]`, `[wetland]`, `[card]`; `IconizePipe` expands them into `<picture>` elements pointing at `assets/icons/png/<name>.webp`, with `dark`/`glow` variant maps. (The directory really is called `icons/png` and holds `.webp` files — see "The app serves WebP only" below.) Translators must preserve these markers — see [i18n/README.md](i18n/README.md) for the full icon table and sheet-by-sheet field docs.
- `parameters` (from the i18n file, falling back to `src/assets/data/parameters.json`) are per-language feature flags, e.g. `Show bonus cards match symbols`, which appends `[anatomist]`-style icons to bird names.

### Routing and card detail

`app-routing.module.ts` defines a single route `card/:id` that renders `AppComponent` itself — the detail view is a Material dialog, not a routed component. `selectCard` in [src/app/store/router.ts](src/app/store/router.ts) resolves the route param against the card arrays; `DisplayComponent` subscribes and opens/updates/closes dialogs with fixed dialog ids (`'0'` bird, `'1'` bonus, `'2'` hummingbird), navigating back to `/` on close. `ApplinkDirective` intercepts clicks on `applink="/card/<id>"` attributes injected into ruling text by the data pipeline, turning them into router navigations.

### Cookies, consent, and preferences

`CookiesService.setCookie` is a no-op unless the `consent` cookie is `'1'` (`ConsentComponent` sets it). Preferences persisted as cookies: `language`, `assetPack`, and `expansion.<core|european|oceania|asia|americas|promoAsia|promoCA|promoEurope|promoNZ|promoUK|promoUS>` (`'0'` means off; *absent* means on, hence the `!== '0'` checks). Initial state is read from cookies in three places — `initialState`, `AppEffects`, and the `SearchComponent` constructor — keep them in sync when adding a preference.

### The app serves WebP only

Every image the app requests is a `.webp`. There are no `<source>` fallbacks and no `.no-webpalpha` rules left; the `<picture>` elements that remain are wrappers kept because their classes (`.icon-picture`, `.egg`, `.nest`, `.habitat-wrapper`) are what the SCSS styles. The justification is not "WebP is popular enough" but that Angular 22 compiles this app for `baseline widely available on 2026-05-07` — minimum Chrome 119, Firefox 119, Safari 17, iOS 17 — and **no browser in that set lacks WebP** (Safari gained it in 14, in 2020). A raster fallback could only ever be reached by a browser that cannot execute the bundle.

Consequently `angular.json` ships **no `.png`/`.jpg` at all** except an explicit allowlist: `icons/pwa/[0-9]*.png` (the manifest and `apple-touch-icon` want PNG) and `ogimage.jpg` (social crawlers are not browsers and do not all read WebP). So:

- **Adding a raster image and referencing it from a template will 404.** Convert to WebP (`scripts/images/webp.sh`), or add it to the allowlist if some non-browser consumer truly needs it.
- The `.png`/`.jpg` files still in `src/assets` are kept deliberately as the lossless masters the WebP was derived from (card art WebP is lossy VP8). They are simply not shipped. Deleting them would gain nothing — git history holds the blobs either way, so a clone is no smaller — and would lose the ability to re-encode.

This took `dist/wingsearch` from 97M to 26M and `ngsw.json` from 324 kB to 205 kB. It did **not** make the page lighter for current visitors: `<picture>` was already handing them the WebP, and the `.no-webpalpha` CSS fallbacks had been dead since `8d16d71 Remove Modernizr` deleted the only thing that set that class. The one real download saved is the bonus-card expansion indicators, which had no WebP variant in the SCSS at all.

### Raster sizes are capped to what the layout actually paints

No icon is drawn larger than about 60 CSS px: `.icon-image` is `1em` (`1.5em` in a few places), `.pack-image` is 30px, `.power-image` 80px, and `.wingspan-icon` is `15cqw` of a card that is never wider than 400px (`.card-wrapper` in the detail dialogs). Several masters were nonetheless 1000px+, which cost bytes on the wire and ~50× the decoded bitmap in memory with 18 cards on screen.

`scripts/images/cap-icon-size.sh` re-encodes any icon over **256px on its longest edge** from its PNG master at that cap — 1.4× headroom over the worst case (wingspan at DPR 3) and 3×+ over everything else. It only rewrites files that exceed the cap *and* actually get smaller (`none.webp` is 267×101, and re-encoding it grows the file), so re-running it is a no-op and the diff stays reviewable. Verified indistinguishable from the originals at 60 px / DPR 3.

The footer illustration is the same rule for a non-icon: it is `max-width: 400px`, so it ships as `tit-400.webp` and `tit-800.webp` behind a `srcset`/`sizes="400px"` rather than the 1964px master (137 kB → 18 kB at DPR 1), and it is `loading="lazy"` because nothing sees it without scrolling.

### Two asset pipelines: `assets/` and `media/`

Every file has exactly one URL, and which one depends on who references it. This is not a style preference — get it wrong and the same bytes are downloaded twice.

- **Referenced from a template or from TypeScript** → it is served from `assets/…`, copied there wholesale by the `assets` entry in `angular.json`, and resolved at runtime against `<base href="/wingsearch/">`.
- **Referenced from a stylesheet `url()`** → the builder rebases it and emits it to `media/<name>` instead. `assets/` and `media/` are then two URLs, two cache entries, two downloads.

So a file needed by *both* a stylesheet and a template must not be named in a `url()`. The bonus card's expansion indicator is the worked example: `bonus-card.component.scss` keeps the `background-size`/`background-position` but the url itself is bound from the component (`expansionIndicator`), because bird cards already fetch those five files via `<img src="assets/icons/png/expansion-indicators/<set>.webp">`. A style-attribute `url()` resolves against the document base URL, so the bound form picks up `<base href>` exactly as an `<img src>` does.

Two consequences that have already bitten once each:

- **Never prefetch or preload a stylesheet-owned asset by its `assets/` path.** `index.html` used to `<link rel="prefetch">` all three fonts from `assets/fonts/`, which warmed a URL `@font-face` never requests — Cardenio and ThirstyRough were downloaded twice and SiliciBold (307 kB) downloaded once for nothing, ~490 kB wasted on every first visit. The fonts are consequently *excluded* from the wholesale asset copy (`"ignore": [… "fonts/**"]`): `@font-face` is their only possible consumer, so shipping a second copy can only invite the same mistake back.
- **`ngsw-config.json` must cover `/media/**` as well as `/assets/**`.** It didn't, so the service worker cached 824 kB of files the app never asks for while the fonts and backgrounds it does ask for stayed uncached — the PWA lost its title font and backgrounds offline.

The remaining `media/` residue is 13 files (~776 kB) that only stylesheets reference. Their `assets/` twins still ship, unrequested; that is ~270 kB of artifact and no download, and it is left alone on purpose, because excluding them would turn a future `<img src="assets/background.webp">` into a production 404.

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

[scripts/rulings/refresh.sh](scripts/rulings/refresh.sh) is the whole pipeline in one command. It needs Bedrock credentials (`export AWS_PROFILE=...`) and Node 22 for the last stage, and it never pushes, deploys or commits — the working tree diff is the review.

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
- `eslint.config.js` (flat config, angular-eslint) mirrors what tslint enforced: `semi: never`, single quotes, `max-len` 140 with regex literals exempt, `eqeqeq`. Directive selectors must be `app`-prefixed camelCase (`appLinkWatcher`, `appFitText`), components `app`-prefixed kebab-case. Four rules are off on purpose and each carries the reason inline — read those before turning one on.
