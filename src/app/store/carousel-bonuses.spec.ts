import BirdCardsJson from '../../assets/data/master.json'
import HummingbirdCardsJson from '../../assets/data/hummingbirds.json'
import BonusCardsJson from '../../assets/data/bonus.json'
import { BirdCard, BonusCard, Expansion } from './app.interfaces'
import { compatibleBirdIdsFor, compatibleBonusCards, relatedBonusCards } from './carousel-bonuses'

/**
 * What the detail dialogs' bonus-card carousels show.
 *
 * The point of these is issue #76: all three carousels used to read the bonus card list without
 * consulting the expansion filter, so with only the base game enabled a bird still offered European
 * and Asia bonus cards. Only four of the 28 bonus cards carrying a `VP Average` are non-core, which
 * is why the bug survived so long, and which is why the counts below are stated as exact numbers --
 * the four are the whole test.
 */

// @ts-ignore -- the JSON imports are typed structurally and don't line up with the interfaces.
const birdCards: BirdCard[] = [...BirdCardsJson, ...HummingbirdCardsJson]
// @ts-ignore
const bonusCards: BonusCard[] = BonusCardsJson

const allExpansions = (): Expansion => ({
  core: true, european: true, oceania: true, asia: true, americas: true,
})

const coreOnly = (): Expansion => ({
  core: true, european: false, oceania: false, asia: false, americas: false,
})

const bird = (name: string): BirdCard =>
  birdCards.find(card => card['Common name'] === name)

const bonus = (name: string): BonusCard =>
  bonusCards.find(card => card['Bonus card'] === name)

/** The four non-core bonus cards that carry a `VP Average`, and so can reach a carousel at all. */
const NON_CORE_IN_CAROUSELS = [
  { name: 'Bird Bander', set: 'european' },
  { name: 'Citizen Scientist', set: 'european' },
  { name: 'Diet Specialist', set: 'european' },
  { name: 'Endangered Species Protector', set: 'asia' },
]

describe('carousel bonus cards', () => {

  it('has exactly four non-core cards able to reach a carousel', () => {
    const reachable = bonusCards.filter(card => card['VP Average'])
    expect(reachable.length).toBe(28)
    expect(reachable.filter(card => card.Set !== 'core').map(card => card['Bonus card']).sort())
      .toEqual(NON_CORE_IN_CAROUSELS.map(card => card.name).sort())
  })

  describe('compatibleBonusCards', () => {

    it('offers a bird the bonus cards it qualifies for', () => {
      const result = compatibleBonusCards(bonusCards, birdCards, allExpansions(), bird('Golden Eagle'))
      expect(result.map(card => card['Bonus card'])).toContain('Bird Bander')
      expect(result.map(card => card['Bonus card'])).toContain('Diet Specialist')
    })

    // Issue #76, exactly as reported: Golden Eagle offering two European cards with only the base
    // game enabled.
    it('drops bonus cards from disabled expansions', () => {
      const result = compatibleBonusCards(bonusCards, birdCards, coreOnly(), bird('Golden Eagle'))
      expect(result.map(card => card['Bonus card'])).not.toContain('Bird Bander')
      expect(result.map(card => card['Bonus card'])).not.toContain('Diet Specialist')
      expect(result.every(card => card.Set === 'core')).toBe(true)
    })

    it('leaves the core cards a bird qualifies for untouched by the expansion filter', () => {
      const all = compatibleBonusCards(bonusCards, birdCards, allExpansions(), bird('Golden Eagle'))
      const core = compatibleBonusCards(bonusCards, birdCards, coreOnly(), bird('Golden Eagle'))
      expect(core.map(card => card.id)).toEqual(all.filter(card => card.Set === 'core').map(card => card.id))
    })

    it('orders by point value, best first', () => {
      const result = compatibleBonusCards(bonusCards, birdCards, allExpansions(), bird('Golden Eagle'))
      const averages = result.map(card => card['VP Average'])
      expect(averages).toEqual([...averages].sort((a, b) => b - a))
    })

    // The `%` used to come straight from bonus.json, so the same card disagreed with itself between
    // the grid (which maps `dynamicPercentage`) and the carousel (which did not).
    it('recomputes the percentage against the enabled expansions', () => {
      const all = compatibleBonusCards(bonusCards, birdCards, allExpansions(), bird('Golden Eagle'))
      const core = compatibleBonusCards(bonusCards, birdCards, coreOnly(), bird('Golden Eagle'))

      // Whichever percentage-bearing card the eagle qualifies for; the point is that narrowing the
      // bird pool moves the figure, not which card carries it.
      const shared = all.filter(card => card['%'] !== '-' && core.some(c => c.id === card.id))
      expect(shared.length).toBeGreaterThan(0)

      const moved = shared.filter(card => card['%'] !== core.find(c => c.id === card.id)['%'])
      expect(moved.length).toBeGreaterThan(0)
    })

    it('leaves non-percentage cards showing a dash', () => {
      const result = compatibleBonusCards(bonusCards, birdCards, allExpansions(), bird('Golden Eagle'))
      const wetlandSpecialist = result.find(card => card['Bonus card'] === 'Wetland Specialist')
      if (wetlandSpecialist)
        expect(wetlandSpecialist['%']).toBe('-')
    })

    it('works for hummingbirds, which carry no expansion of their own', () => {
      const hummingbird = birdCards.find(card => card.CardType === 'Hummingbird')
      const result = compatibleBonusCards(bonusCards, birdCards, allExpansions(), hummingbird)
      expect(result.every(card => card['VP Average'])).toBe(true)
    })

    it('returns nothing when every expansion is disabled', () => {
      const none: Expansion = {
        core: false, european: false, oceania: false, asia: false, americas: false,
      }
      expect(compatibleBonusCards(bonusCards, birdCards, none, bird('Golden Eagle'))).toEqual([])
    })
  })

  describe('relatedBonusCards', () => {

    it('never offers the open card back to itself', () => {
      const anatomist = bonus('Anatomist')
      const result = relatedBonusCards(bonusCards, birdCards, allExpansions(), anatomist)
      expect(result.map(card => card.id)).not.toContain(anatomist.id)
    })

    it('drops bonus cards from disabled expansions', () => {
      const result = relatedBonusCards(bonusCards, birdCards, coreOnly(), bonus('Anatomist'))
      expect(result.every(card => card.Set === 'core')).toBe(true)
      expect(result.map(card => card['Bonus card'])).not.toContain('Bird Bander')
    })

    it('offers only cards sharing at least one bird with the open card', () => {
      const result = relatedBonusCards(bonusCards, birdCards, allExpansions(), bonus('Anatomist'))
      expect(result.length).toBeGreaterThan(0)
      expect(result.every(card => card.birdIds.length > 0)).toBe(true)
    })

    it('tags each card with the birds it shares, not every bird it matches', () => {
      const anatomist = bonus('Anatomist')
      const compatible = compatibleBirdIdsFor(birdCards, anatomist)
      const result = relatedBonusCards(bonusCards, birdCards, allExpansions(), anatomist)

      result.forEach(card => {
        expect(card.birdIds.every(id => compatible.includes(id))).toBe(true)
        expect(card.birdIds.length).toBeLessThanOrEqual(compatibleBirdIdsFor(birdCards, card).length)
      })
    })

    it('orders by shared birds weighted by point value', () => {
      const result = relatedBonusCards(bonusCards, birdCards, allExpansions(), bonus('Anatomist'))
      const weights = result.map(card => card.birdIds.length * card['VP Average'])
      expect(weights).toEqual([...weights].sort((a, b) => b - a))
    })
  })

  describe('compatibleBirdIdsFor', () => {

    it('returns the ids of every bird matching the predicate', () => {
      const anatomist = bonus('Anatomist')
      const ids = compatibleBirdIdsFor(birdCards, anatomist)
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.every(id => birdCards.some(card => card.id === id))).toBe(true)
    })

    it('ignores the expansion filter, which is applied by the callers instead', () => {
      const ids = compatibleBirdIdsFor(birdCards, bonus('Anatomist'))
      const sets = new Set(ids.map(id => birdCards.find(card => card.id === id).Set))
      expect(sets.size).toBeGreaterThan(1)
    })
  })
})
