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
npm run lint           # tslint; currently reports 172 pre-existing violations
npm run preview        # build + serve an exact production replica (see below)
npm run build-pages    # production build into dist/wingsearch (what CI deploys)
npm run build-prod     # legacy: production build into docs/
```

Docker alternative (avoids installing Node 14 locally): `docker compose up` serves the dev server on `$WEB_PORT` (default 8080) with `src/` mounted read-only.

### Verifying a change looks right in production

`npm run preview` builds with the real `/wingsearch/` base href into `.preview/wingsearch/` and serves the *parent* directory, so the app is reachable at **http://localhost:8080/wingsearch/** and behaves exactly as it does live. Use this rather than `build-local` + `http-server`, which serve at base href `/` and therefore cannot reproduce subpath asset or routing bugs. `npm run serve-preview` re-serves an existing build without rebuilding.

### Tests

`src/app/store/app.reducer.spec.ts` holds 61 characterization specs covering text search, every attribute filter, the bonus-card filter branch, pagination, and the `setLanguage`/`resetLanguage` round trip (~91% statement coverage of the store).

These specs deliberately **pin current behaviour, including where it is wrong**. Known-buggy behaviour is pinned with a comment naming the issue rather than corrected, so a fix is always a deliberate test change. Don't "fix" a failing spec by loosening the assertion — work out which side is wrong first.

Angular schematics are configured with `skipTests: true`, so generated components come without specs.

## Deployment

`.github/workflows/ci.yml` owns the build. Every PR and every push to master installs from the lockfile, lints (non-blocking), runs the specs, and builds. On master the `deploy` job is gated on the protected `github-pages` environment, so **a push builds and then waits for manual approval** — nothing reaches users without a click. Every run also uploads the built site as a downloadable artifact for local inspection.

Lint is `continue-on-error` because of the 172-violation backlog. Clear it, then make it blocking.

`docs/` is a committed build artifact from the old manual workflow (`npm run build-prod` + a "Publish changes" commit). The Pages source has been switched to GitHub Actions, so `docs/` is no longer the deploy source — but the last branch-based deployment is what's still live until the first Actions deploy replaces it. Delete `docs/` only after an approved CI deploy succeeds. Don't hand-edit it, and don't add to it.

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

Source spreadsheets in [scripts/](scripts/), transformed by Jupyter notebooks that **write straight into `src/assets/data/`** (there is no `scripts/generated/` step, despite what CONTRIBUTING.md says):

- [scripts/json-transformer.ipynb](scripts/json-transformer.ipynb) reads `wingspan-card-list.xlsx` (sheets `Birds`, `Hummingbirds`, `Goals`), `wingspan-note-list.xlsx` (sheets `Bonus`, `Birds` for native names/notes, `Parameters`), and `Wingspan - Rulings.tsv`; assigns ids; converts LaTeX-ish ruling markup (`\textbf{}`, `\textit{}`, quotes) into HTML with `applink` attributes; attaches per-card `rulings` and `additionalRulings` (the latter derived from generic rules matched by predicates in [scripts/general_rulings_map.py](scripts/general_rulings_map.py)); and emits `master.json`, `hummingbirds.json`, `bonus.json`, `general.json`, `goals.json`, `parameters.json`.
- [scripts/language-to-json.ipynb](scripts/language-to-json.ipynb) converts every `i18n/*.xlsx` (except `template.xlsx`) into `src/assets/data/i18n/<lang>.json`.

Note `scripts/wingspan-bonuscard-list.xlsx` is *not* read by the notebook — bonus card data comes from `wingspan-note-list.xlsx`. Only `master.json`, `hummingbirds.json`, `bonus.json`, `extra-assets.json`, and `parameters.json` are consumed by the app; `general.json` and `goals.json` are generated but currently unused at runtime.

Image tooling (requires ImageMagick / cwebp / OpenCV, operates on the gitignored `new_assets/`): `scripts/psd-to-png.sh`, `scripts/organize-birds.py` (fuzzy-matches filenames to card names and renames to `<id>.png`), `scripts/process-silhouettes.py`, `scripts/flip-horizontal.sh`, `scripts/webp.sh` (bulk PNG/JPG → WebP), `scripts/index-extra-assets.sh` (regenerates `extra-assets.json` from directory listings), `scripts/ai-bird-art/`.

## Conventions

- Semicolons are omitted in TypeScript. Store files use 4-space indentation; components use 2-space.
- Card fields are accessed by their human-readable spreadsheet names (`card['Egg limit']`, `card['Nest type']`, `card['Victory points']`) — bracket notation with spaces is normal here.
- tslint config exists and is `tslint:recommended`-based, but the lint target can't run (see above).
