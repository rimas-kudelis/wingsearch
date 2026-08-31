export interface AppState {
    birdCards: BirdCard[]
    bonusCards: BonusCard[]
    search: {
        birdCards: any
        bonusCards: any
    }
    query: SearchQuery
    // No `rulingCards` beside these: the rulings corpus is derived from them and memoized in rulings.ts
    // rather than stored, so that a view which is off by default costs nothing until it is switched on.
    displayedCards: (BirdCard | BonusCard | RulingCard)[]
    displayedCardsHidden: (BirdCard | BonusCard | RulingCard)[]
    activeBonusCards: BonusCard[]
    expansion: Expansion
    swiftstart: boolean
    promoPack: PromoPack
    displayedStats: DisplayedStats
    scrollDisabled: boolean
    translatedContent: { [key: string]: { Translated: string } }
    parameters: { [key: string]: {Value: unknown} }
    assetPack: string
}

export interface BirdCard {
    id: number
    'Common name': string
    'Native name': string
    'Scientific name': string
    Set: ExpansionType
    Pack: PackType
    Color: Color | null
    PowerCategory: PowerCategory | null
    'Power text': null | string
    Note: null | string
    Group: GroupType
    Benefit: BenefitType
    Predator: string | null
    Flocking: string | null
    'Bonus card': string | null
    'Victory points': number
    'Nest type': NestType
    'Egg limit': number
    Wingspan: string
    Forest: string | null
    Grassland: string | null
    Wetland: string | null
    Invertebrate: number | null
    Seed: number | null
    Fruit: number | null
    Fish: number | null
    Nectar: number | null
    Rodent: number | null
    'Wild (food)': number | null
    '/ (food cost)': string | null
    '* (food cost)': string | null
    'Total food cost': number
    'Beak direction': BeakDirection | null
    'Swift Start': string | null
    Anatomist: string | null
    Cartographer: string | null
    Historian: string | null
    Photographer: string | null
    'Backyard Birder': string | null
    'Bird Bander': string | null
    'Bird Counter': string | null
    'Bird Feeder': string | null
    'Caprimulgiform Specialist': string | null
    'Diet Specialist': string | null
    'Enclosure Builder': string | null
    Falconer: string | null
    'Fishery Manager': string | null
    'Food Web Expert': string | null
    Forester: string | null
    'Large Bird Specialist': string | null
    'Nest Box Builder': string | null
    'Omnivore Expert': string | null
    'Passerine Specialist': string | null
    'Platform Builder': string | null
    'Prairie Manager': string | null
    Rodentologist: string | null
    rulings: Ruling[]
    additionalRulings: Ruling[]
    Viticulturalist: string | null
    'Wetland Scientist': string | null
    'Wildlife Gardener': string | null
    'Small Clutch Specialist': string | null
    'Endangered Species Protector': string | null
    CardType: CardType
}

export enum CardType {
    Bird = 'Bird',
    Hummingbird = 'Hummingbird',
    Bonus = 'Bonus',
    Ruling = 'Ruling',
}

export function isBirdCard(object: any): object is BirdCard {
    return object?.CardType === CardType.Bird
}

export function isHummingbirdCard(object: any): object is BirdCard {
    return object?.CardType === CardType.Hummingbird
}

export function isBirdOrHummingbirdCard(object: any): object is BirdCard {
    return isBirdCard(object) || isHummingbirdCard(object)
}

export enum Color {
    Brown = 'brown',
    Pink = 'pink',
    Teal = 'teal',
    White = 'white',
    Yellow = 'yellow',
}

export enum NestType {
    Bowl = 'bowl',
    Cavity = 'cavity',
    Ground = 'ground',
    None = 'none',
    Platform = 'platform',
    Wild = 'wild',
}

export enum BeakDirection {
    Left = 'L',
    LeftLeft = 'LL',
    LeftRight = 'LR',
    Neither = 'N',
    Right = 'R',
}

export const LeftBeakDirections = [
    BeakDirection.Left,
    BeakDirection.LeftLeft,
    BeakDirection.LeftRight
]

export const RightBeakDirections = [
    BeakDirection.LeftRight,
    BeakDirection.Right
]

export enum PowerCategory {
    CachingFood = 'Caching Food',
    CardDrawing = 'Card-drawing',
    EggLaying = 'Egg-laying',
    Flocking = 'Flocking',
    FoodFromBirdfeeder = 'Food from Birdfeeder',
    FoodFromSupply = 'Food from Supply',
    FoodRelated = 'Food-related',
    HuntingAndFishing = 'Hunting and Fishing',
    HuntingFishing = 'Hunting/Fishing',
    Other = 'Other',
    PowerCategoryHuntingAndFishing = 'Hunting and fishing',
    Tucking = 'Tucking',
}

export interface Ruling {
    // Row id in scripts/rulings/rulings.tsv, so a line on the site can be traced back to the
    // comment it came from. Not rendered; see src/app/store/rulings.spec.ts.
    id: string
    text: string
    source: string
}

/**
 * A general ruling as `general.json` holds it: a `Ruling` plus the heading its TSV row gave it, which
 * only the general ones have. Birds reference these by row index rather than carrying a copy -- see
 * card-data.ts, which resolves the references before anything else sees a card.
 */
export interface GeneralRuling extends Ruling {
    name: string
}

/**
 * One ruling turned around: the cards carry their rulings, and this carries a ruling's cards, so that
 * the same corpus can be searched from either end (issue #46). Built by `buildRulingCards` in
 * rulings.ts from the same `rulings`/`additionalRulings` arrays the detail dialogs render, which is why
 * nothing here is a new contract with the data pipeline -- the only addition was the ruling id in
 * general.json, so a general ruling can be titled.
 */
export interface RulingCard extends Ruling {
    /**
     * The FlexSearch document id, and the only unique handle a ruling has. The ruling id is not one:
     * three ids (20201003, 20201116a, 20210199a) carry two general rows each, because one comment can
     * settle two rules and the fan-out predicate in general_map.py is keyed per id, not per row.
     */
    key: number
    /** The general ruling's heading from general.json; null for a ruling that belongs to named cards. */
    name: string | null
    cards: (BirdCard | BonusCard)[]
    CardType: CardType
}

export function isRulingCard(object: any): object is RulingCard {
    return object?.CardType === CardType.Ruling
}

export interface BonusCard {
    id: number
    'Bonus card': string
    Set: ExpansionType
    Automa: string | null
    Condition: string
    'Explanatory text': null | string
    VP: string
    '%': number | string
    Note: null | string
    'VP Average': number
    birdIds?: number[]
    rulings: Ruling[]
    additionalRulings: Ruling[]
    CardType: CardType
}

export function isBonusCard(object: any): object is BonusCard {
    return object?.CardType === CardType.Bonus
}

export enum ExpansionType {
    Core = 'core',
    European = 'european',
    Oceania = 'oceania',
    Asia = 'asia',
    Americas = 'americas'
}

export enum PackType {
    promoAsia = 'promoAsia',
    promoCA = 'promoCA',
    promoEurope = 'promoEurope',
    promoNZ = 'promoNZ',
    promoUS = 'promoUS',
    promoUK = 'promoUK'
}

export interface Expansion {
    core: boolean,
    european: boolean,
    oceania: boolean,
    asia: boolean,
    americas: boolean
}

export interface PromoPack {
    promoAsia: boolean,
    promoCA: boolean,
    promoEurope: boolean,
    promoNZ: boolean,
    promoUS: boolean,
    promoUK: boolean
}

/**
 * The entire search form, which `SearchComponent` owns as mutable component state and re-dispatches
 * whole on every control change. The reducer keeps the last one in `AppState.query` so that actions
 * which invalidate the results without touching the form -- a language change, which rewrites the
 * name-derived bonus card flags -- can re-run the search instead of guessing.
 */
export interface SearchQuery {
    main: string,
    bonus: number[],
    stats: {
        habitat: {
            forest: number,
            grassland: number,
            wetland: number
        },
        birds: boolean,
        bonuses: boolean,
        hummingbirds: boolean,
        // Off by default, and the only one of these that adds rather than filters: the rulings view is
        // a second corpus rather than a subset of the cards. See `applySearch` in app.reducer.ts.
        rulings: boolean
    },
    expansion: Expansion,
    promoPack: PromoPack,
    eggs: {
        min: number,
        max: number
    },
    points: {
        min: number,
        max: number
    },
    wingspan: {
        min: number,
        max: number
    }
    foodCost: {
        min: number,
        max: number
    }
    colors: {
        brown: boolean,
        pink: boolean,
        white: boolean,
        teal: boolean,
        yellow: boolean
    },
    food: {
        invertebrate: number,
        seed: number,
        fruit: number,
        fish: number,
        rodent: number,
        nectar: number,
        'wild (food)': number,
        'no-food': number
    },
    nest: {
        bowl: boolean,
        cavity: boolean,
        ground: boolean,
        none: boolean,
        platform: boolean,
        wild: boolean
    },
    beak: {
        left: boolean,
        right: boolean
    }
}

export interface DisplayedStats {
    birdCards: number
    hummingbirdCards: number
    bonusCards: number
    rulingCards: number
    habitat: {
        forest: number
        grassland: number
        wetland: number
    }
}

export enum GroupType {
    Bee = 'bees & mountaingems',
    Brilliant = 'brilliants & coquettes',
    Emerald = 'emeralds',
    Mango = 'mangoes',
    Topaz = 'topazes, jacobins, & hermits'
}
export enum BenefitType {
    Card = 'card',
    Nectar = 'nectar',
    Egg = 'egg',
    Row = 'row',
    Advance = 'advance'
}
