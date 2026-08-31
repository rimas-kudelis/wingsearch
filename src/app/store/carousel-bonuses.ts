import { BirdCard, BonusCard, Expansion } from './app.interfaces'
import { bonusSearchMap, dynamicPercentage } from './bonus-search-map'

/**
 * What the "compatible bonus cards" carousels in the three detail dialogs show.
 *
 * This lived inline in each dialog component, and all three read `app.bonusCards` without consulting
 * `app.expansion` -- so with only the base game enabled a Golden Eagle still offered Bird Bander and
 * Diet Specialist (issue #76). Four of the 28 bonus cards carrying a `VP Average` are non-core
 * (Bird Bander, Citizen Scientist, Diet Specialist, Endangered Species Protector), which is the whole
 * visible extent of the bug, but it was three copies of the same omission.
 *
 * Pulling it here also puts it where the rest of the suite can reach it: the dialogs are Material
 * dialogs needing `MAT_DIALOG_DATA` and a store to instantiate, whereas these are plain functions
 * over the card arrays.
 */

/** A bonus card in the related-bonus carousel, tagged with the birds it shares with the open card. */
export type RelatedBonusCard = BonusCard & { birdIds: number[] }

/**
 * Bonus cards a bird qualifies for, best point value first -- the carousel in the bird and
 * hummingbird dialogs.
 *
 * The survivors go through `dynamicPercentage` because every other place a bonus card is emitted
 * does (search, language change, the `selectCard` router selector), and the carousel showing
 * bonus.json's static `%` meant the same card disagreed with itself between the grid and the dialog.
 */
export const compatibleBonusCards = (
    bonusCards: BonusCard[],
    birdCards: BirdCard[],
    expansion: Expansion,
    bird: BirdCard,
): BonusCard[] =>
    bonusCards
        .filter(card => card['VP Average'] && expansion[card.Set] && bonusSearchMap[card.id].callbackfn(bird))
        .map(dynamicPercentage(birdCards, expansion))
        .sort((a, b) => b['VP Average'] - a['VP Average'])

/**
 * Bonus cards that overlap with an open bonus card, most-shared-birds-by-point-value first -- the
 * carousel in the bonus dialog.
 *
 * Filtering ahead of `dynamicPercentage` rather than after keeps it from computing a percentage over
 * the whole bird list for cards that are about to be dropped.
 */
export const relatedBonusCards = (
    bonusCards: BonusCard[],
    birdCards: BirdCard[],
    expansion: Expansion,
    bonus: BonusCard,
): RelatedBonusCard[] => {
    // A Set rather than the `Array.includes` this replaced: the ids are checked once per bird per
    // carousel card, so on the full collection that was ~28 x 747 x 747 comparisons.
    const compatibleBirdIds = new Set(compatibleBirdIdsFor(birdCards, bonus))

    return bonusCards
        .filter(card => card['VP Average'] && card.id !== bonus.id && expansion[card.Set])
        .map(dynamicPercentage(birdCards, expansion))
        .map(card => ({
            ...card,
            birdIds: compatibleBirdIdsFor(birdCards, card).filter(id => compatibleBirdIds.has(id)),
        }))
        .filter(card => card.birdIds.length)
        .sort((a, b) => b.birdIds.length * b['VP Average'] - a.birdIds.length * a['VP Average'])
}

/** Ids of every bird satisfying a bonus card's predicate, across all expansions. */
export const compatibleBirdIdsFor = (birdCards: BirdCard[], bonus: BonusCard): number[] =>
    birdCards.filter(bird => bonusSearchMap[bonus.id].callbackfn(bird)).map(bird => bird.id)
