import { createReducer, on } from '@ngrx/store'
import * as appActions from './app.actions'
import {
    AppState,
    isBirdCard,
    isHummingbirdCard,
    isBirdOrHummingbirdCard,
    BirdCard,
    BonusCard,
    DisplayedStats,
    isBonusCard,
    BeakDirection,
    LeftBeakDirections,
    RightBeakDirections,
    SearchQuery
} from './app.interfaces'
import BirdCards from '../../assets/data/master.json'
import BonusCards from '../../assets/data/bonus.json'
import HummingbirdCards from '../../assets/data/hummingbirds.json'
import Parameters from '../../assets/data/parameters.json'
import { birdCardsSearch, bonusCardsSearch } from './cards-search'
import { bonusSearchMap, dynamicPercentage } from './bonus-search-map'
import { CookiesService } from '../cookies.service'

const SLICE_WINDOW = 18

const BirdCardsWithHummingbirds = [...BirdCards, ...HummingbirdCards]

// @ts-ignore
const englishBirdCardsMap: BirdCard[] = BirdCardsWithHummingbirds.reduce((acc, card) => ({ ...acc, [card.id]: card }), {})
// @ts-ignore
const englishBonusCardsMap: BonusCard[] = BonusCards.reduce((acc, card) => ({ ...acc, [card.id]: card }), {})

const calculateDisplayedStats = (cards: (BirdCard | BonusCard)[]): DisplayedStats => {

    const birdCards = cards.filter(isBirdCard).length
    const bonusCards = cards.filter(isBonusCard).length
    const hummingbirdCards = cards.filter(isHummingbirdCard).length

    const habitat = cards.filter(isBirdOrHummingbirdCard).reduce((acc, val: BirdCard) => {
        acc.forest += val.Forest ? 1 : 0
        acc.grassland += val.Grassland ? 1 : 0
        acc.wetland += val.Wetland ? 1 : 0
        return acc
    }, { forest: 0, grassland: 0, wetland: 0 })

    return { birdCards, hummingbirdCards, bonusCards, habitat }
}

const eatsMustFood = (card: BirdCard, mustFood: string[]): boolean => {
    const foodKeys = ['Invertebrate', 'Seed', 'Fruit', 'Fish', 'Rodent', 'Nectar', 'Wild (food)']
    const birdFood = foodKeys.filter(key => card[key]).map(key => key.toLowerCase())
    return !!
        mustFood.every(food => birdFood.includes(food)) ||
        (!birdFood.length && mustFood.length === 1 && mustFood[0] === 'no-food')
}

const eatsMustNotFood = (card: BirdCard, mustNotFood: string[]): boolean => {
    const foodKeys = ['Invertebrate', 'Seed', 'Fruit', 'Fish', 'Rodent', 'Nectar', 'Wild (food)']
    const birdFood = foodKeys.filter(key => card[key]).map(key => key.toLowerCase())
    return !!
        mustNotFood.every(food => food === 'no-food' || !birdFood.includes(food)) &&
        (!mustNotFood.includes('no-food') || birdFood.length > 0)
}

const cookies: CookiesService = new CookiesService()

/**
 * What `AppState.query` holds until `SearchComponent`'s constructor dispatches the real form state,
 * which happens synchronously during bootstrap -- so this is a starting value, never a query whose
 * results a user sees. Deliberately more permissive than the form's own defaults (open ranges rather
 * than 0-6 eggs, 0-9 points, 0-500 wingspan, 0-3 food) so that it cannot drift out of step with the
 * form and start excluding cards: whatever reads it before the first search gets everything.
 */
const UNFILTERED_QUERY: SearchQuery = {
    main: '',
    bonus: [],
    stats: {
        habitat: { forest: 0, grassland: 0, wetland: 0 },
        birds: true,
        bonuses: true,
        hummingbirds: true,
    },
    expansion: {
        core: cookies.getCookie('expansion.core') !== '0',
        european: cookies.getCookie('expansion.european') !== '0',
        oceania: cookies.getCookie('expansion.oceania') !== '0',
        asia: cookies.getCookie('expansion.asia') !== '0',
        americas: cookies.getCookie('expansion.americas') !== '0',
    },
    promoPack: {
        promoAsia: cookies.getCookie('expansion.promoAsia') !== '0',
        promoCA: cookies.getCookie('expansion.promoCA') !== '0',
        promoEurope: cookies.getCookie('expansion.promoEurope') !== '0',
        promoNZ: cookies.getCookie('expansion.promoNZ') !== '0',
        promoUK: cookies.getCookie('expansion.promoUK') !== '0',
        promoUS: cookies.getCookie('expansion.promoUS') !== '0',
    },
    eggs: { min: 0, max: Infinity },
    points: { min: 0, max: Infinity },
    wingspan: { min: 0, max: Infinity },
    foodCost: { min: 0, max: Infinity },
    colors: { brown: true, pink: true, white: true, teal: true, yellow: true },
    food: {
        invertebrate: 0, seed: 0, fruit: 0, fish: 0,
        rodent: 0, nectar: 0, 'wild (food)': 0, 'no-food': 0,
    },
    nest: { bowl: true, cavity: true, ground: true, none: true, platform: true, wild: true },
    beak: { left: true, right: true },
}

export const initialState: AppState = {
    // @ts-ignore
    birdCards: BirdCardsWithHummingbirds,
    // @ts-ignore
    bonusCards: BonusCards,
    search: {
        // @ts-ignore
        birdCards: birdCardsSearch(BirdCardsWithHummingbirds),
        // @ts-ignore
        bonusCards: bonusCardsSearch(BonusCards),
    },
    // @ts-ignore
    displayedCards: BirdCardsWithHummingbirds.concat(BonusCards).slice(0, SLICE_WINDOW),
    // @ts-ignore
    displayedCardsHidden: BirdCardsWithHummingbirds.concat(BonusCards).slice(SLICE_WINDOW),
    // @ts-ignore
    activeBonusCards: BonusCards,
    // @ts-ignore
    displayedStats: calculateDisplayedStats(BirdCardsWithHummingbirds.concat(BonusCards)),
    scrollDisabled: false,
    translatedContent: {},
    parameters: Parameters,
    query: UNFILTERED_QUERY,
    expansion: UNFILTERED_QUERY.expansion,
    promoPack: UNFILTERED_QUERY.promoPack,
    assetPack: cookies.getCookie('assetPack') || 'silhouette'
}

/**
 * The search pipeline: text query, bonus card predicates, attribute filters, stats, pagination.
 *
 * Pulled out of the `search` handler so the two language handlers can re-run it, which they have to.
 * Four bonus cards -- Anatomist, Cartographer, Historian, Photographer -- match on the bird's *name*,
 * so every i18n file carries its own per-bird flag for them and `translateBirds` overwrites the
 * English one. Translating the previous result set in place therefore left an active bonus-card
 * filter listing whichever birds qualified in the language you came *from* (issue #38).
 */
const applySearch = (state: AppState, query: SearchQuery): AppState => {
    let displayedCards = Array.from(new Set([
        'Common name',
        'Scientific name',
        'Power text',
    ].reduce((acc, val) => {
        return [
            ...acc,
            ...state.search.birdCards.search({
                query: query.main, field: val
            })
        ]
    }, [])))

    if (!displayedCards.length && !query.main) {
        // @ts-ignore
        displayedCards = state.birdCards.concat(state.bonusCards.map(dynamicPercentage(state.birdCards, query.expansion)))
    }

    if (query.bonus.length) {
        const bonusCards = state.bonusCards.filter(card => query.bonus.includes(card.id))

        displayedCards = displayedCards.filter(isBirdOrHummingbirdCard)
            .filter(card => bonusCards.reduce((acc, val) => acc && bonusSearchMap[val.id].callbackfn(card), true)
        )
    } else {
        const bonusCards = Array.from(new Set([
            'Bonus card',
            'Condition',
            'VP',
        ].reduce((acc, val) => {
            return [
                ...acc,
                ...state.search.bonusCards.search({
                    query: query.main, field: val
                })
            ]
        }, [])))

        displayedCards = displayedCards.concat(bonusCards.map(dynamicPercentage(state.birdCards, query.expansion)))
    }

    const allowedExpansions = Object.entries(query.expansion).reduce(
        (acc, val) => val[1] ? [...acc, val[0]] : acc, []
    )

    const allowedPromoPacks = Object.entries(query.promoPack).reduce(
        (acc, val) => val[1] ? [...acc, val[0]] : acc, []
    )

    const allowedColors = Object.entries(query.colors).reduce(
        (acc, val) => val[1] ? [...acc, val[0]] : acc, []
    )

    const mustFood = Object.entries(query.food).reduce(
        (acc, val) => val[1] === 1 ? [...acc, val[0]] : acc, []
    )

    const mustNotFood = Object.entries(query.food).reduce(
        (acc, val) => val[1] === 2 ? [...acc, val[0]] : acc, []
    )

    const allowedNests = Object.entries(query.nest).reduce(
        (acc, val) => val[1] ? [...acc, val[0]] : acc, []
    )

    displayedCards = displayedCards.filter(card =>
        (allowedExpansions.includes(card.Set)
            || allowedPromoPacks.includes(card.Set))
        && (isBonusCard(card) || (
            allowedColors.includes(card.Color ? card.Color.toLowerCase() : 'white')) &&
            eatsMustFood(card, mustFood) &&
            eatsMustNotFood(card, mustNotFood) &&
            allowedNests.includes(card['Nest type'])
        )
    )

    displayedCards = displayedCards.filter(card =>
        isBonusCard(card) || (query.eggs.min <= card['Egg limit'] && query.eggs.max >= card['Egg limit'])
    )

    displayedCards = displayedCards.filter(card =>
        isBonusCard(card) || (query.points.min <= card['Victory points'] && query.points.max >= card['Victory points'])
    )

    displayedCards = displayedCards.filter(card =>
        isBonusCard(card) || card.Wingspan === '*' || (query.wingspan.min <= card.Wingspan && query.wingspan.max >= card.Wingspan)
    )

    displayedCards = displayedCards.filter(card =>
        isBonusCard(card) || (query.foodCost.min <= card['Total food cost'] && query.foodCost.max >= card['Total food cost'])
    )

    displayedCards = displayedCards.filter(card =>
        isBonusCard(card)
        || (query.beak?.left && query.beak?.right)
        || (query.beak?.left && LeftBeakDirections.includes(card['Beak direction']))
        || (query.beak?.right && RightBeakDirections.includes(card['Beak direction']))
        || (!query.beak?.left && !query.beak?.right && card['Beak direction'] === BeakDirection.Neither)
    )

    displayedCards = displayedCards.filter(card =>
        (isBonusCard(card) && query.stats.bonuses)
        || (((isBirdCard(card) && query.stats.birds)
            || (isHummingbirdCard(card) && query.stats.hummingbirds))
            && (
                (
                    query.stats.habitat.forest === 0
                    || (query.stats.habitat.forest === 1 && card.Forest)
                    || (query.stats.habitat.forest === 2 && !card.Forest)
                )
                && (
                    query.stats.habitat.grassland === 0
                    || (query.stats.habitat.grassland === 1 && card.Grassland)
                    || (query.stats.habitat.grassland === 2 && !card.Grassland)
                )
                && (
                    query.stats.habitat.wetland === 0
                    || (query.stats.habitat.wetland === 1 && card.Wetland)
                    || (query.stats.habitat.wetland === 2 && !card.Wetland)
                )
            )
        )
    )

    const displayedStats = calculateDisplayedStats(displayedCards)

    const displayedCardsHidden = displayedCards.slice(SLICE_WINDOW)
    displayedCards = displayedCards.slice(0, SLICE_WINDOW)

    return { ...state, query, displayedCards, displayedCardsHidden, displayedStats, scrollDisabled: false, expansion: query.expansion }
}

const reducer = createReducer(
    initialState,
    on(appActions.search, (state, action) => applySearch(state, action)),

    on(appActions.bonusCardSearch, (state, action) => {
        let activeBonusCards = Array.from(new Set([
            'Bonus card',
            'Condition',
            'VP',
        ].reduce((acc, val) => {
            return [
                ...acc,
                ...state.search.bonusCards.search({
                    query: action.bonusfield, field: val
                })
            ]
        }, [])))

        if (!activeBonusCards.length && !action.bonusfield) {
            // @ts-ignore
            activeBonusCards = state.bonusCards
        }

        activeBonusCards = activeBonusCards
            .filter(card => !action.bonus.includes(card.id))
            .filter(card => action.expansion[card.Set])

        return { ...state, activeBonusCards }
    }),

    on(appActions.scroll, (state) => {
        const displayedCards = state.displayedCards.concat(state.displayedCardsHidden.slice(0, SLICE_WINDOW))
        const displayedCardsHidden = state.displayedCardsHidden.slice(SLICE_WINDOW)

        return { ...state, displayedCards, displayedCardsHidden, scrollDisabled: !displayedCardsHidden.length }
    }),

    on(appActions.setLanguage, (state, action) => {
        const translateBirds = (card: BirdCard) => {
            const translatedKeys = ['Common name', 'Power text', 'Flavor text', 'Note']
            const bonusKeys = ['Anatomist', 'Cartographer', 'Historian', 'Photographer']
            const translated = action.payload.birds[card.id]
            const englishBird = englishBirdCardsMap[card.id]

            if (!translated)
                return englishBird

            const mergeContent = translatedKeys.reduce((acc, key) =>
                (translated[key] && String(translated[key]).trim() ? { ...acc, [key]: String(translated[key]).trim() } : acc), {})

            const bonuses = bonusKeys.reduce((acc, key) => ({...acc, [key]: translated[key]}), {})
            return { ...englishBird, ...mergeContent, ...bonuses }
        }

        const translateBonuses = (card: BonusCard) => {
            const renameKeys = {Name: 'Bonus card'}
            const translated = Object.keys(action.payload.bonuses[card.id] || {}).reduce((acc, key) =>
                ({...acc, [renameKeys[key] || key]: action.payload.bonuses[card.id][key]}), {})
            const translatedKeys = ['Bonus card', 'Condition', 'Explanatory text', 'VP', 'Note']
            const englishBonus = englishBonusCardsMap[card.id]

            if (!translated)
                return englishBonus

            const mergeContent = translatedKeys.reduce((acc, key) =>
                (translated[key] && String(translated[key]).trim() ? { ...acc, [key]: String(translated[key]).trim() } : acc), {})

            return { ...englishBonus, ...mergeContent }
        }

        const sortCardsByKey = (key: string, automaLast = false) => {
            if (automaLast)
                return (a, b) => ((Number(!!a['Bonus card'].match(/\[automa\]/)) - Number(!!b['Bonus card'].match(/\[automa\]/))) ||
                    a[key].localeCompare(b[key], action.language))
            else
                return (a, b) => a[key].localeCompare(b[key], action.language)
        }

        // @ts-ignore
        const birdCards: BirdCard[] = BirdCardsWithHummingbirds.map(translateBirds).sort(sortCardsByKey('Common name'))

        // @ts-ignore
        const bonusCards: BonusCard[] = BonusCards.map(translateBonuses).sort(sortCardsByKey('Bonus card', true))

        // Re-run the search rather than translating the previous result set: the text query now means
        // something different against the translated index, and the name-derived bonus card flags have
        // changed outright. `action.expansion` wins over the stored query's copy so that the
        // ROOT_EFFECTS_INIT path, which reads the expansion straight from the cookies, still applies.
        return applySearch({
            ...state,
            birdCards,
            bonusCards,
            search: { birdCards: birdCardsSearch(birdCards), bonusCards: bonusCardsSearch(bonusCards) },
            activeBonusCards: bonusCards.filter(b => state.activeBonusCards.find(ab => b.id === ab.id)),
            translatedContent: action.payload.other,
            parameters: action.payload.parameters,
        }, { ...state.query, expansion: action.expansion })
    }),

    // @ts-ignore
    on(appActions.resetLanguage, (state, action) => {
        // Same reasoning as setLanguage: the English flags are back, so the results have to be
        // recomputed rather than mapped back card by card. The card arrays go back to the module-level
        // English ones, already in English order, which is why the per-card English lookups and the
        // re-sort this handler used to do are gone -- the order now matches a fresh English load
        // exactly, hummingbirds after the birds rather than merged in among them.
        return applySearch({
            ...state,
            // @ts-ignore
            birdCards: BirdCardsWithHummingbirds,
            // @ts-ignore
            bonusCards: BonusCards,
            // @ts-ignore
            search: { birdCards: birdCardsSearch(BirdCardsWithHummingbirds), bonusCards: bonusCardsSearch(BonusCards) },
            // @ts-ignore
            activeBonusCards: BonusCards.filter(eb => state.activeBonusCards.find(b => b.id === eb.id)),
            translatedContent: {},
            parameters: Parameters,
        }, { ...state.query, expansion: action.expansion })
    }),

    on(appActions.changeAssetPack, (state, action) => {
        return {
            ...state,
            assetPack: action.assetPack
        }
    })
)

export function appReducer(state, action) {
    return reducer(state, action)
}
