import { appReducer, initialState } from './app.reducer'
import * as appActions from './app.actions'
import { AppState, BirdCard, BonusCard, CardType, isBonusCard, isBirdOrHummingbirdCard } from './app.interfaces'
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

/**
 * A search action that excludes nothing, so each spec can vary exactly one
 * dimension. Ranges are the true min/max present in the card data.
 */
const searchAction = (overrides: Partial<SearchAction> = {}): SearchAction => appActions.search({
  main: '',
  bonus: [],
  stats: {
    habitat: { forest: 0, grassland: 0, wetland: 0 },
    birds: true,
    bonuses: true,
    hummingbirds: true,
  },
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
} as any)

/** Filters are applied before pagination, so assert against both halves. */
const allResults = (state: AppState): (BirdCard | BonusCard)[] =>
  state.displayedCards.concat(state.displayedCardsHidden)

const search = (overrides: Partial<SearchAction> = {}, from: AppState = initialState): AppState =>
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
      allResults(state).forEach(card => expect(card.Set).toBe('core'))
    })

    it('keeps only cards from the enabled promo packs', () => {
      const state = search({
        expansion: noExpansions(),
        promoPack: { ...noPromoPacks(), promoUS: true },
      })

      expect(allResults(state).length).toBeGreaterThan(0)
      allResults(state).forEach(card => expect(card.Set).toBe('promoUS'))
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
