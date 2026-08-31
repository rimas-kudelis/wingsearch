import { BirdCard, BonusCard, CardType, Ruling, RulingCard } from './app.interfaces'
import { generalRulings } from './card-data'
import { rulingCardsSearch } from './cards-search'

/**
 * The rulings corpus, turned around so it can be searched from the ruling end rather than the card end
 * (issue #46). The cards already carry their rulings -- `rulings` for the ones written about that card,
 * `additionalRulings` for the general ones a predicate in scripts/rulings/general_map.py fanned out --
 * and every one of the 59 general rulings therefore appears on many cards. Grouping them back together
 * gives 469 distinct rulings out of 2564 attachments, and 74KB of text rather than 813KB.
 *
 * A ruling is identified by its id *and* its text, never the id alone: three ids carry two general rows
 * each. `key` is the surrogate the FlexSearch document id needs.
 */

// `generalRulings` is the 59 rows of general.json in file order (see card-data.ts). `name` is the
// heading its rulings.tsv row gave it, which is the only title any ruling has; a ruling written about
// specific cards is titled by those cards instead.
const rulingKey = (ruling: Ruling): string => `${ruling.id} ${ruling.text}`

// 59 rows but 58 distinct rulings: the Oceania end-of-round comment (20201116a) is filed under both
// `End of Round Reference` and `Game end`, because one comment settled both. Joining the headings keeps
// the second one instead of letting whichever row came last win.
const generalNames: { [key: string]: string } = generalRulings
    .reduce((acc, ruling) => ({
        ...acc,
        [rulingKey(ruling)]: acc[rulingKey(ruling)] && acc[rulingKey(ruling)] !== ruling.name
            ? `${acc[rulingKey(ruling)]} / ${ruling.name}`
            : ruling.name
    }), {})

export const buildRulingCards = (birdCards: BirdCard[], bonusCards: BonusCard[]): RulingCard[] => {
    const byKey = new Map<string, RulingCard>()
    const cards: (BirdCard | BonusCard)[] = [...birdCards, ...bonusCards]

    const add = (card: BirdCard | BonusCard) => (ruling: Ruling) => {
        const key = rulingKey(ruling)
        const existing = byKey.get(key)

        if (existing) existing.cards.push(card)
        else byKey.set(key, {
            key: 0,
            id: ruling.id,
            name: generalNames[key] || null,
            text: ruling.text,
            source: ruling.source,
            cards: [card],
            CardType: CardType.Ruling,
        })
    }

    // Both lists in one pass, and in one expression: this file omits semicolons like the rest of the
    // store, so a statement that starts with `(` would be read as a call on the line above it.
    cards.forEach(card => [
        ...(card.rulings || []),
        // Only birds carry general rulings, so `additionalRulings` is absent on the rest.
        ...((card as BirdCard).additionalRulings || []),
    ].forEach(add(card)))

    // Six of the general rulings reach no card at all -- the goal-tile scoring rules, the end-of-round
    // order -- and would otherwise be the only rulings on the site with nowhere to appear. They are
    // rules of the game like the rest, so they get a card of their own with an empty `cards` list
    // rather than being dropped.
    generalRulings.forEach(ruling => {
        const key = rulingKey(ruling)
        if (!byKey.has(key)) byKey.set(key, {
            key: 0,
            id: ruling.id,
            // `generalNames`, not `ruling.name`: the row's own heading would lose the other heading the
            // same ruling is filed under, and the one ruling that has two reaches no card.
            name: generalNames[key],
            text: ruling.text,
            source: ruling.source,
            cards: [],
            CardType: CardType.Ruling,
        })
    })

    const order: Map<BirdCard | BonusCard, number> = new Map(cards.map((card, index) => [card, index]))
    const firstCard = (ruling: RulingCard) => ruling.cards.length ? order.get(ruling.cards[0]) : -1

    // Titled rulings first -- those are the general ones, the rules a player is most likely to be
    // looking up -- then the card-specific ones in the order of the cards they belong to, which is the
    // order the card list is already sorted in and so follows a language change.
    return Array.from(byKey.values())
        .sort((a, b) =>
            (a.name ? 0 : 1) - (b.name ? 0 : 1)
            || (a.name || '').localeCompare(b.name || '')
            || firstCard(a) - firstCard(b))
        .map((ruling, index) => ({ ...ruling, key: index }))
}

/**
 * The corpus and its index for a given pair of card arrays, built on first use and then kept until the
 * cards are replaced -- which happens only on a language change, and rebuilds because a ruling card
 * holds the card objects themselves so that it can render their names in the current language.
 *
 * Not part of `AppState`, and not built in `initialState`, because `initialState` is evaluated during
 * initial script evaluation: whatever it touches is paid for before anything paints. The grouping is
 * 1.4ms warm but 9.5ms on a cold JIT, which is the same order as the bird index that cards-search.ts
 * went to some length to defer, and the rulings toggle is off by default -- most sessions never ask for
 * this at all. Memoizing on array identity rather than caching one build is what lets `resetLanguage`,
 * which restores the module-level English arrays, land back on the corpus it already had. The bird array
 * alone is the key because the two are only ever replaced together, by `setLanguage`.
 */
const corpusCache = new WeakMap<BirdCard[], { rulingCards: RulingCard[], search: any }>()

export const rulingCorpus = (birdCards: BirdCard[], bonusCards: BonusCard[]) => {
    if (!corpusCache.has(birdCards)) {
        const rulingCards = buildRulingCards(birdCards, bonusCards)
        corpusCache.set(birdCards, { rulingCards, search: rulingCardsSearch(rulingCards) })
    }

    return corpusCache.get(birdCards)
}

/**
 * A ruling with its card list narrowed to the cards the current filters leave standing, or null when the
 * filters have left it nothing: an Americas-only ruling with the Americas expansion unchecked is not a
 * ruling this player can apply. The six rulings that were attached to no card in the first place are
 * general rules of the game, so they survive any filter.
 */
export const restrictRuling = (ruling: RulingCard, visible: Set<number>): RulingCard | null => {
    if (!ruling.cards.length)
        return ruling

    const remaining = ruling.cards.filter(card => visible.has(card.id))
    return remaining.length ? { ...ruling, cards: remaining } : null
}
