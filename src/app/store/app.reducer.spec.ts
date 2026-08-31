import { appReducer, initialState } from './app.reducer'
import * as appActions from './app.actions'
import {
  AppState, BirdCard, BonusCard, CardType, RulingCard,
  isBonusCard, isBirdOrHummingbirdCard, isRulingCard
} from './app.interfaces'
import { bonusSearchMap } from './bonus-search-map'

/**
 * Characterization tests for the search/filter/pagination reducer.
 *
 * These pin down what the reducer does *today*, including behaviour that is
 * arguably wrong. Where a known open issue contradicts the pinned behaviour it
 * is called out in a comment so the test can be flipped deliberately when the
 * bug is fixed, rather than silently masking a regression.
 */

const SLICE_WINDOW = 18
const TOTAL_BIRDS = 707
const TOTAL_HUMMINGBIRDS = 40
const TOTAL_BONUS = 61
const TOTAL_CARDS = TOTAL_BIRDS + TOTAL_HUMMINGBIRDS + TOTAL_BONUS

type SearchAction = ReturnType<typeof appActions.search>

/** `stats` is partial in its own right, so a spec can flip one toggle and leave the rest alone. */
type SearchOverrides = Partial<Omit<SearchAction, 'stats'>> & { stats?: Partial<SearchAction['stats']> }

const allExpansions = () => ({
  core: true, european: true, oceania: true, asia: true, americas: true,
})

const allPromoPacks = () => ({
  promoAsia: true, promoCA: true, promoEurope: true,
  promoNZ: true, promoUS: true, promoUK: true,
})

const noExpansions = () => ({
  core: false, european: false, oceania: false, asia: false, americas: false,
})

const noPromoPacks = () => ({
  promoAsia: false, promoCA: false, promoEurope: false,
  promoNZ: false, promoUS: false, promoUK: false,
})

/** Every card type shown, no habitat filter, rulings off -- the form's own defaults. */
const allStats = () => ({
  habitat: { forest: 0, grassland: 0, wetland: 0 },
  birds: true,
  bonuses: true,
  hummingbirds: true,
  rulings: false,
})

/**
 * A search action that excludes nothing, so each spec can vary exactly one
 * dimension. Ranges are the true min/max present in the card data. `stats` is
 * merged rather than replaced, so a spec that varies one toggle need not
 * restate the others.
 */
const searchAction = (overrides: SearchOverrides = {}): SearchAction => appActions.search({
  main: '',
  bonus: [],
  expansion: allExpansions(),
  promoPack: allPromoPacks(),
  eggs: { min: 0, max: 6 },
  points: { min: 0, max: 9 },
  wingspan: { min: 0, max: 303 },
  foodCost: { min: 0, max: 3 },
  colors: { brown: true, pink: true, white: true, teal: true, yellow: true },
  food: {
    invertebrate: 0, seed: 0, fruit: 0, fish: 0,
    rodent: 0, nectar: 0, 'wild (food)': 0, 'no-food': 0,
  },
  nest: { bowl: true, cavity: true, ground: true, none: true, platform: true, wild: true },
  beak: { left: true, right: true },
  ...overrides,
  stats: { ...allStats(), ...overrides.stats },
} as any)

/** Filters are applied before pagination, so assert against both halves. */
const allResults = (state: AppState): (BirdCard | BonusCard | RulingCard)[] =>
  state.displayedCards.concat(state.displayedCardsHidden)

const search = (overrides: SearchOverrides = {}, from: AppState = initialState): AppState =>
  appReducer(from, searchAction(overrides))

const names = (state: AppState): string[] =>
  allResults(state).filter(isBirdOrHummingbirdCard).map(card => card['Common name'])

describe('appReducer', () => {

  describe('initialState', () => {
    it('holds every bird, hummingbird and bonus card', () => {
      expect(initialState.birdCards.length).toBe(TOTAL_BIRDS + TOTAL_HUMMINGBIRDS)
      expect(initialState.bonusCards.length).toBe(TOTAL_BONUS)
    })

    it('shows the first page and hides the rest', () => {
      expect(initialState.displayedCards.length).toBe(SLICE_WINDOW)
      expect(initialState.displayedCardsHidden.length).toBe(TOTAL_CARDS - SLICE_WINDOW)
      expect(initialState.scrollDisabled).toBe(false)
    })

    // Only ever the starting value -- SearchComponent dispatches the real form state during
    // bootstrap -- so it is deliberately permissive rather than a copy of the form's defaults.
    it('starts from a query that excludes nothing', () => {
      expect(initialState.query.main).toBe('')
      expect(initialState.query.bonus).toEqual([])
      expect(initialState.query.eggs.max).toBe(Infinity)
    })

    it('counts each card type in the stats', () => {
      expect(initialState.displayedStats.birdCards).toBe(TOTAL_BIRDS)
      expect(initialState.displayedStats.hummingbirdCards).toBe(TOTAL_HUMMINGBIRDS)
      expect(initialState.displayedStats.bonusCards).toBe(TOTAL_BONUS)
    })
  })

  describe('search with an empty query', () => {
    it('falls back to the full card list', () => {
      expect(allResults(search()).length).toBe(TOTAL_CARDS)
    })

    it('paginates to the slice window', () => {
      const state = search()

      expect(state.displayedCards.length).toBe(SLICE_WINDOW)
      expect(state.displayedCardsHidden.length).toBe(TOTAL_CARDS - SLICE_WINDOW)
    })

    it('records the expansion selection it was called with', () => {
      const expansion = { ...allExpansions(), asia: false }

      expect(search({ expansion }).expansion).toEqual(expansion)
    })
  })

  describe('text search', () => {
    it('matches on common name', () => {
      expect(names(search({ main: 'Osprey' }))).toContain('Osprey')
    })

    it('matches on scientific name', () => {
      // Osprey's scientific name is Pandion haliaetus.
      expect(names(search({ main: 'Pandion' }))).toContain('Osprey')
    })

    it('matches on power text', () => {
      const results = names(search({ main: 'birdfeeder' }))

      expect(results.length).toBeGreaterThan(0)
    })

    it('ignores diacritics', () => {
      expect(names(search({ main: 'Kakapo' }))).toContain('Kākāpō')
    })

    it('returns bonus cards matching the same query', () => {
      const results = allResults(search({ main: 'Anatomist' })).filter(isBonusCard)

      expect(results.map(card => card['Bonus card'])).toContain('Anatomist')
    })

    it('narrows the result set well below the full list', () => {
      expect(allResults(search({ main: 'Osprey' })).length).toBeLessThan(TOTAL_CARDS)
    })
  })

  describe('expansion and promo pack filters', () => {
    it('keeps only cards from the enabled expansions', () => {
      const state = search({
        expansion: { ...noExpansions(), core: true },
        promoPack: noPromoPacks(),
      })

      expect(allResults(state).length).toBeGreaterThan(0)
      allResults(state).forEach(card => expect((card as BirdCard | BonusCard).Set).toBe('core'))
    })

    it('keeps only cards from the enabled promo packs', () => {
      const state = search({
        expansion: noExpansions(),
        promoPack: { ...noPromoPacks(), promoUS: true },
      })

      expect(allResults(state).length).toBeGreaterThan(0)
      allResults(state).forEach(card => expect((card as BirdCard | BonusCard).Set).toBe('promoUS'))
    })

    it('returns nothing when every set is disabled', () => {
      const state = search({ expansion: noExpansions(), promoPack: noPromoPacks() })

      expect(allResults(state).length).toBe(0)
    })

    it('excludes hummingbirds when the Americas expansion is off', () => {
      const state = search({
        expansion: { ...allExpansions(), americas: false },
        promoPack: noPromoPacks(),
      })

      expect(allResults(state).filter(card => card.CardType === CardType.Hummingbird).length).toBe(0)
    })
  })

  describe('attribute filters', () => {
    it('filters by colour', () => {
      const state = search({
        colors: { brown: false, pink: true, white: false, teal: false, yellow: false },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card.Color).toBe('pink'))
    })

    it('treats a colourless bird as white', () => {
      const whiteOnly = search({
        colors: { brown: false, pink: false, white: true, teal: false, yellow: false },
      })
      const birds = allResults(whiteOnly).filter(isBirdOrHummingbirdCard)

      // 178 birds are explicitly white and 6 have no colour at all.
      expect(birds.length).toBe(178 + 6)
    })

    it('filters by nest type', () => {
      const state = search({
        nest: { bowl: false, cavity: true, ground: false, none: false, platform: false, wild: false },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBe(151)
      birds.forEach(card => expect(card['Nest type']).toBe('cavity'))
    })

    it('filters by egg limit range', () => {
      const birds = allResults(search({ eggs: { min: 5, max: 6 } })).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card['Egg limit']).toBeGreaterThanOrEqual(5))
    })

    it('filters by victory points range', () => {
      const birds = allResults(search({ points: { min: 8, max: 9 } })).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card['Victory points']).toBeGreaterThanOrEqual(8))
    })

    it('filters by total food cost range', () => {
      const birds = allResults(search({ foodCost: { min: 3, max: 3 } })).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card['Total food cost']).toBe(3))
    })

    it('always keeps birds whose wingspan is "*" regardless of the range', () => {
      const birds = allResults(search({ wingspan: { min: 200, max: 303 } }))
        .filter(isBirdOrHummingbirdCard)

      expect(birds.map(card => card['Common name'])).toContain('Emu')
    })

    it('keeps bonus cards untouched by bird-only attribute filters', () => {
      const state = search({
        nest: { bowl: false, cavity: true, ground: false, none: false, platform: false, wild: false },
      })

      expect(allResults(state).filter(isBonusCard).length).toBe(TOTAL_BONUS)
    })
  })

  describe('food filters', () => {
    it('requires every food marked as must-have', () => {
      const state = search({
        food: {
          invertebrate: 0, seed: 1, fruit: 0, fish: 0,
          rodent: 0, nectar: 0, 'wild (food)': 0, 'no-food': 0,
        },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card.Seed).toBeTruthy())
    })

    it('excludes every food marked as must-not-have', () => {
      const state = search({
        food: {
          invertebrate: 0, seed: 2, fruit: 0, fish: 0,
          rodent: 0, nectar: 0, 'wild (food)': 0, 'no-food': 0,
        },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card.Seed).toBeFalsy())
    })

    it('matches birds that eat nothing via the no-food marker', () => {
      const state = search({
        food: {
          invertebrate: 0, seed: 0, fruit: 0, fish: 0,
          rodent: 0, nectar: 0, 'wild (food)': 0, 'no-food': 1,
        },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => {
        const foods = ['Invertebrate', 'Seed', 'Fruit', 'Fish', 'Rodent', 'Nectar', 'Wild (food)']
        expect(foods.some(key => card[key])).toBe(false)
      })
    })
  })

  describe('card type and habitat toggles', () => {
    it('shows birds only', () => {
      const state = search({
        stats: {
          habitat: { forest: 0, grassland: 0, wetland: 0 },
          birds: true, bonuses: false, hummingbirds: false,
        },
      })

      expect(state.displayedStats.birdCards).toBe(TOTAL_BIRDS)
      expect(state.displayedStats.hummingbirdCards).toBe(0)
      expect(state.displayedStats.bonusCards).toBe(0)
    })

    it('shows hummingbirds only', () => {
      const state = search({
        stats: {
          habitat: { forest: 0, grassland: 0, wetland: 0 },
          birds: false, bonuses: false, hummingbirds: true,
        },
      })

      expect(state.displayedStats.hummingbirdCards).toBe(TOTAL_HUMMINGBIRDS)
      expect(state.displayedStats.birdCards).toBe(0)
    })

    it('shows bonus cards only', () => {
      const state = search({
        stats: {
          habitat: { forest: 0, grassland: 0, wetland: 0 },
          birds: false, bonuses: true, hummingbirds: false,
        },
      })

      expect(allResults(state).length).toBe(TOTAL_BONUS)
    })

    it('requires a habitat when its toggle is 1', () => {
      const state = search({
        stats: {
          habitat: { forest: 1, grassland: 0, wetland: 0 },
          birds: true, bonuses: false, hummingbirds: true,
        },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card.Forest).toBeTruthy())
    })

    it('excludes a habitat when its toggle is 2', () => {
      const state = search({
        stats: {
          habitat: { forest: 2, grassland: 0, wetland: 0 },
          birds: true, bonuses: false, hummingbirds: true,
        },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(card.Forest).toBeFalsy())
    })

    it('combines habitat requirements conjunctively', () => {
      const state = search({
        stats: {
          habitat: { forest: 1, grassland: 1, wetland: 1 },
          birds: true, bonuses: false, hummingbirds: true,
        },
      })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => {
        expect(card.Forest).toBeTruthy()
        expect(card.Grassland).toBeTruthy()
        expect(card.Wetland).toBeTruthy()
      })
    })
  })

  describe('beak direction filter', () => {
    it('keeps everything when both directions are selected', () => {
      expect(allResults(search({ beak: { left: true, right: true } })).length).toBe(TOTAL_CARDS)
    })

    it('keeps only left-facing beaks', () => {
      const birds = allResults(search({ beak: { left: true, right: false } }))
        .filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(['L', 'LL', 'LR']).toContain(card['Beak direction']))
    })

    it('keeps only right-facing beaks', () => {
      const birds = allResults(search({ beak: { left: false, right: true } }))
        .filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(['R', 'LR']).toContain(card['Beak direction']))
    })

    it('falls back to beakless birds when neither direction is selected', () => {
      const birds = allResults(search({ beak: { left: false, right: false } }))
        .filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBe(29)
      birds.forEach(card => expect(card['Beak direction']).toBe('N'))
    })
  })

  describe('bonus card filtering', () => {
    it('drops every bonus card from the results when a bonus filter is active', () => {
      const state = search({ bonus: [1000] })

      expect(allResults(state).filter(isBonusCard).length).toBe(0)
    })

    it('keeps only birds satisfying the selected bonus predicate', () => {
      const state = search({ bonus: [1000] })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      expect(birds.length).toBeGreaterThan(0)
      birds.forEach(card => expect(bonusSearchMap[1000].callbackfn(card)).toBe(true))
    })

    it('requires birds to satisfy every selected bonus predicate', () => {
      const state = search({ bonus: [1000, 1016] })
      const birds = allResults(state).filter(isBirdOrHummingbirdCard)

      birds.forEach(card => {
        expect(bonusSearchMap[1000].callbackfn(card)).toBe(true)
        expect(bonusSearchMap[1016].callbackfn(card)).toBe(true)
      })
    })

    it('narrows further as bonus filters are added', () => {
      const one = allResults(search({ bonus: [1000] })).length
      const two = allResults(search({ bonus: [1000, 1016] })).length

      expect(two).toBeLessThanOrEqual(one)
    })
  })

  describe('bonusCardSearch', () => {
    const bonusCardSearch = (overrides: Partial<{
      bonus: string[], bonusfield: string, expansion: any
    }> = {}) => appReducer(initialState, appActions.bonusCardSearch({
      bonus: [], bonusfield: '', expansion: allExpansions(), ...overrides,
    } as any))

    it('offers every bonus card for an empty query', () => {
      expect(bonusCardSearch().activeBonusCards.length).toBe(TOTAL_BONUS)
    })

    it('excludes bonus cards that are already selected', () => {
      const state = bonusCardSearch({ bonus: [1000] as any })

      expect(state.activeBonusCards.map(card => card.id)).not.toContain(1000)
      expect(state.activeBonusCards.length).toBe(TOTAL_BONUS - 1)
    })

    it('excludes bonus cards from disabled expansions', () => {
      const state = bonusCardSearch({ expansion: { ...allExpansions(), asia: false } })

      expect(state.activeBonusCards.filter(card => card.Set === 'asia').length).toBe(0)
    })

    it('narrows by text query', () => {
      const state = bonusCardSearch({ bonusfield: 'Anatomist' })

      expect(state.activeBonusCards.length).toBeGreaterThan(0)
      expect(state.activeBonusCards.length).toBeLessThan(TOTAL_BONUS)
    })
  })

  describe('scroll', () => {
    it('moves the next slice window into view', () => {
      const state = appReducer(initialState, appActions.scroll())

      expect(state.displayedCards.length).toBe(SLICE_WINDOW * 2)
      expect(state.displayedCardsHidden.length).toBe(TOTAL_CARDS - SLICE_WINDOW * 2)
      expect(state.scrollDisabled).toBe(false)
    })

    it('disables scrolling once nothing is left hidden', () => {
      let state: AppState = search()
      let guard = 0

      expect(state.displayedCardsHidden.length).toBeGreaterThan(0)

      while (state.displayedCardsHidden.length && guard++ < 200) {
        state = appReducer(state, appActions.scroll())
      }

      expect(state.displayedCardsHidden.length).toBe(0)
      expect(state.scrollDisabled).toBe(true)
    })

    // Known quirk: `search` hardcodes scrollDisabled: false, so a result set that
    // fits in one page still leaves infinite scroll armed with nothing to load.
    // It self-corrects on the first scroll event. Pinned rather than fixed here.
    it('leaves scrolling enabled after a search that fits in one page', () => {
      const state = search({ main: 'Osprey' })

      expect(state.displayedCardsHidden.length).toBe(0)
      expect(state.scrollDisabled).toBe(false)
    })

    it('preserves the cards already on screen', () => {
      const first = initialState.displayedCards.map(card => card.id)
      const state = appReducer(initialState, appActions.scroll())

      expect(state.displayedCards.slice(0, SLICE_WINDOW).map(card => card.id)).toEqual(first)
    })
  })

  describe('language', () => {
    const payload = {
      birds: {
        182: { 'Common name': 'Fischadler', 'Power text': '', 'Flavor text': '', Note: '' },
      },
      bonuses: {
        1000: { Name: 'Anatom', Condition: '', 'Explanatory text': '', VP: '', Note: '' },
      },
      other: { search: { Translated: 'Suche' } },
      parameters: { 'Show bonus cards match symbols': { Value: false } },
    }

    const setLanguage = (from: AppState = initialState) => appReducer(from, appActions.setLanguage({
      payload, language: 'de', expansion: allExpansions(),
    } as any))

    it('applies the translated common name', () => {
      const translated = setLanguage().birdCards.find(card => card.id === 182)

      expect(translated['Common name']).toBe('Fischadler')
    })

    it('applies the translated bonus card name via the Name alias', () => {
      const translated = setLanguage().bonusCards.find(card => card.id === 1000)

      expect(translated['Bonus card']).toBe('Anatom')
    })

    it('falls back to English for untranslated cards', () => {
      const untouched = setLanguage().birdCards.find(card => card.id === 157)

      expect(untouched['Common name']).toBe('Killdeer')
    })

    it('falls back to English for blank translated fields', () => {
      const translated = setLanguage().birdCards.find(card => card.id === 182)
      const english = initialState.birdCards.find(card => card.id === 182)

      expect(translated['Power text']).toBe(english['Power text'])
    })

    it('keeps the full card collections intact', () => {
      const state = setLanguage()

      expect(state.birdCards.length).toBe(TOTAL_BIRDS + TOTAL_HUMMINGBIRDS)
      expect(state.bonusCards.length).toBe(TOTAL_BONUS)
    })

    it('rebuilds both search indexes against the translated cards', () => {
      const state = setLanguage()
      const results = state.search.birdCards.search({ query: 'Fischadler', field: 'Common name' })

      expect(results.map((card: BirdCard) => card.id)).toContain(182)
    })

    it('stores the translated UI strings and parameters', () => {
      const state = setLanguage()

      expect(state.translatedContent).toEqual(payload.other as any)
      expect(state.parameters).toEqual(payload.parameters as any)
    })

    it('re-sorts bird cards by the translated name', () => {
      const sorted = setLanguage().birdCards.map(card => card['Common name'])
      const resorted = [...sorted].sort((a, b) => a.localeCompare(b, 'de'))

      expect(sorted).toEqual(resorted)
    })

    it('restores English on resetLanguage', () => {
      const state = appReducer(setLanguage(), appActions.resetLanguage({
        expansion: allExpansions(),
      } as any))

      expect(state.birdCards.find(card => card.id === 182)['Common name']).toBe('Osprey')
      expect(state.bonusCards.find(card => card.id === 1000)['Bonus card']).toBe('Anatomist')
      expect(state.translatedContent).toEqual({})
    })

    it('rebuilds the English search index on resetLanguage', () => {
      const state = appReducer(setLanguage(), appActions.resetLanguage({
        expansion: allExpansions(),
      } as any))
      const results = state.search.birdCards.search({ query: 'Osprey', field: 'Common name' })

      expect(results.map((card: BirdCard) => card.id)).toContain(182)
    })
  })

  /**
   * Issue #38. Anatomist, Cartographer, Historian and Photographer match on the bird's *name*, so
   * every i18n file carries its own per-bird flag for them: a bird whose English name contains a body
   * part need not in Polish, and vice versa. The language handlers used to translate the previous
   * result set card by card, which left an active bonus-card filter listing whichever birds qualified
   * in the language you came from. They now re-run the search instead, which is why the reducer keeps
   * the last query in `state.query`.
   */
  describe('language change with an active bonus filter', () => {
    const ASH_THROATED_FLYCATCHER = 16
    const OSPREY = 182

    // Bird 16 is an Anatomist in English and bird 182 is not; this payload swaps them, by translating
    // 16 without the flag and 182 with it.
    const payload = {
      birds: {
        [ASH_THROATED_FLYCATCHER]: { 'Common name': 'Graukehl-Tyrann' },
        [OSPREY]: { 'Common name': 'Fischadler', Anatomist: 'X' },
      },
      bonuses: {},
      other: {},
      parameters: {},
    }

    const translate = (from: AppState) => appReducer(from, appActions.setLanguage({
      payload, language: 'de', expansion: allExpansions(),
    } as any))

    const restore = (from: AppState) => appReducer(from, appActions.resetLanguage({
      expansion: allExpansions(),
    } as any))

    const matchedIds = (state: AppState): number[] =>
      allResults(state).filter(isBirdOrHummingbirdCard).map(card => card.id)

    it('remembers the query so a later action can re-run it', () => {
      const state = search({ main: 'osprey', bonus: [1000] })

      expect(state.query.main).toBe('osprey')
      expect(state.query.bonus).toEqual([1000])
    })

    it('re-applies the filter with the translated flags', () => {
      const english = search({ bonus: [1000] })

      expect(matchedIds(english)).toContain(ASH_THROATED_FLYCATCHER)
      expect(matchedIds(english)).not.toContain(OSPREY)

      const german = matchedIds(translate(english))

      expect(german).not.toContain(ASH_THROATED_FLYCATCHER)
      expect(german).toContain(OSPREY)
    })

    it('leaves the birds whose flag the translation did not touch', () => {
      const english = matchedIds(search({ bonus: [1000] }))
      const german = matchedIds(translate(search({ bonus: [1000] })))
      const swapped = [ASH_THROATED_FLYCATCHER, OSPREY]

      expect(german.filter(id => !swapped.includes(id)).sort())
        .toEqual(english.filter(id => !swapped.includes(id)).sort())
    })

    it('keeps dropping the bonus cards themselves', () => {
      const state = translate(search({ bonus: [1000] }))

      expect(allResults(state).filter(isBonusCard).length).toBe(0)
    })

    it('recomputes the stats for the new result set', () => {
      const state = translate(search({ bonus: [1000] }))

      expect(state.displayedStats.birdCards + state.displayedStats.hummingbirdCards)
        .toBe(allResults(state).filter(isBirdOrHummingbirdCard).length)
    })

    it('goes back to the English result set on resetLanguage', () => {
      const english = search({ bonus: [1000] })
      const roundTrip = restore(translate(english))

      expect(matchedIds(roundTrip).sort()).toEqual(matchedIds(english).sort())
    })

    it('applies the expansion the language action carries, not the stored copy', () => {
      const state = translate(appReducer(search({ bonus: [1000] }), appActions.setLanguage({
        payload, language: 'de', expansion: { ...allExpansions(), asia: false },
      } as any)))

      expect(state.expansion).toEqual(allExpansions())
    })

    // The other half of re-running the search: a text query means something different against the
    // translated index, so the results follow the query into the new language rather than freezing
    // the set that matched in the old one.
    it('re-runs a text query against the translated index', () => {
      const english = search({ main: 'Osprey' })

      expect(matchedIds(english)).toContain(OSPREY)

      const german = translate(english)

      expect(matchedIds(german)).not.toContain(OSPREY)
      expect(matchedIds(search({ main: 'Fischadler' }, german))).toContain(OSPREY)
    })
  })

  /**
   * Issue #46. The rulings toggle adds a second corpus rather than filtering the cards: a ruling is in
   * the result when its own text matches the query *or* when it is attached to a card that survived the
   * filters. The corpus is the general rulings only -- a ruling written about one card is already in
   * that card's detail dialog -- so `TOTAL_RULINGS` is the 58 distinct rulings the 59 rows of
   * general.json make. It is pinned the way rulings.spec.ts pins per-ruling attachment counts: if
   * regenerating master.json changes it, that is a change to what players read and belongs in the same
   * commit as an updated number.
   */
  describe('rulings view', () => {
    const TOTAL_RULINGS = 58
    const OSPREY = 182

    const rulings = (state: AppState): RulingCard[] => allResults(state).filter(isRulingCard)
    const withRulings = (overrides: SearchOverrides = {}, from: AppState = initialState) =>
      search({ ...overrides, stats: { ...overrides.stats, rulings: true } }, from)

    it('adds nothing while the toggle is off', () => {
      expect(rulings(search()).length).toBe(0)
      expect(search().displayedStats.rulingCards).toBe(0)
      expect(allResults(search()).length).toBe(TOTAL_CARDS)
    })

    it('lists every ruling when nothing else is asked for', () => {
      const state = withRulings()

      expect(rulings(state).length).toBe(TOTAL_RULINGS)
      expect(state.displayedStats.rulingCards).toBe(TOTAL_RULINGS)
      expect(allResults(state).length).toBe(TOTAL_CARDS + TOTAL_RULINGS)
    })

    // 800-odd cards would otherwise bury them 45 scroll pages down.
    it('puts the rulings before the cards', () => {
      expect(withRulings().displayedCards.every(isRulingCard)).toBe(true)
    })

    it('shows the general rulings that reach the bird whose name was typed', () => {
      const osprey = initialState.birdCards.find(card => card.id === OSPREY)
      const shown = rulings(withRulings({ main: 'Osprey' })).map(ruling => `${ruling.id} ${ruling.text}`)

      expect(osprey.additionalRulings.length).toBe(4)
      osprey.additionalRulings.forEach(ruling => expect(shown).toContain(`${ruling.id} ${ruling.text}`))
    })

    // The bird's own ruling stays where it always was, on the bird.
    it('leaves the card-specific rulings out of the corpus', () => {
      const osprey = initialState.birdCards.find(card => card.id === OSPREY)
      const shown = rulings(withRulings()).map(ruling => `${ruling.id} ${ruling.text}`)

      expect(osprey.rulings.length).toBe(1)
      osprey.rulings.forEach(ruling => expect(shown).not.toContain(`${ruling.id} ${ruling.text}`))
    })

    // The other reading of "search the rulings": words that appear in a ruling but in no card text.
    // "rulebook" is in two of them and in nothing else the search looks at.
    it('matches the ruling text itself', () => {
      const shown = rulings(withRulings({ main: 'rulebook' }))

      expect(shown.length).toBe(2)
      shown.forEach(ruling => expect(ruling.text.toLowerCase()).toContain('rulebook'))
    })

    it('titles every ruling with the heading its general row gave it', () => {
      const shown = rulings(withRulings())

      expect(shown.filter(ruling => ruling.name).length).toBe(TOTAL_RULINGS)
      expect(shown.map(ruling => ruling.name)).toContain('End of Round Reference / Game end')
    })

    it('keeps rulings when every card type is switched off', () => {
      const state = withRulings({ stats: { birds: false, hummingbirds: false, bonuses: false } })

      expect(rulings(state).length).toBe(TOTAL_RULINGS)
      expect(allResults(state).length).toBe(TOTAL_RULINGS)
    })

    it('narrows each ruling to the cards from the enabled expansions', () => {
      const state = withRulings({
        expansion: { ...noExpansions(), core: true },
        promoPack: noPromoPacks(),
      })
      const listed = rulings(state).reduce((acc, ruling) => [...acc, ...ruling.cards], [])

      expect(listed.length).toBeGreaterThan(0)
      listed.forEach(card => expect(card.Set).toBe('core'))
    })

    it('drops a ruling the filters have left no cards for', () => {
      const core = rulings(withRulings({
        expansion: { ...noExpansions(), core: true },
        promoPack: noPromoPacks(),
      }))

      expect(core.length).toBeGreaterThan(0)
      expect(core.length).toBeLessThan(TOTAL_RULINGS)
    })

    // The six that were attached to no card are rules of the game -- goal tile scoring, the order of
    // the end of a round -- so they are the ones a set filter cannot take away.
    it('keeps the unattached rulings whatever is filtered out', () => {
      const state = withRulings({ expansion: noExpansions(), promoPack: noPromoPacks() })

      expect(rulings(state).length).toBe(6)
      expect(rulings(state).every(ruling => !ruling.cards.length)).toBe(true)
    })
  })

  describe('changeAssetPack', () => {
    it('replaces the selected asset pack', () => {
      const state = appReducer(initialState, appActions.changeAssetPack({ assetPack: 'original' }))

      expect(state.assetPack).toBe('original')
    })

    it('leaves the card collections alone', () => {
      const state = appReducer(initialState, appActions.changeAssetPack({ assetPack: 'original' }))

      expect(state.birdCards).toBe(initialState.birdCards)
      expect(state.displayedCards).toBe(initialState.displayedCards)
    })
  })
})
