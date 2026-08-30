import BirdCards from '../../assets/data/master.json'

/**
 * Snapshot of the general-ruling fan-out in master.json.
 *
 * General rulings are attached at build time by scripts/general_rulings_map.py,
 * where a regex proposes candidate birds and scripts/rulings-applicability.json
 * (produced by scripts/audit_rulings.py, reviewed by hand) decides which of them
 * keep it. Neither step is visible from the app, so a mistake in either -- a
 * regenerated master.json, an edited predicate, a re-run audit -- would silently
 * change the rulings players read to settle rules disputes.
 *
 * These counts pin that fan-out. A failure here is not necessarily a bug, but it
 * is always a deliberate content change: update the numbers in the same commit
 * that changes the data, and say why in the message.
 */
describe('general rulings fan-out', () => {

    // ruling text prefix -> number of birds carrying it.
    // Recorded 2026-08-30 after the first applicability audit.
    const EXPECTED: [string, number][] = [
        ['Whenever you are entitled to gain resources', 315],
        ['You may only reroll dice when gaining food from the birdfeeder', 109],
        ['Regular reroll rules apply whenever you have the opportunity', 63],
        ['You may use a pink power during another player\'s turn', 51],
        ['You may activate each <i>"once between turns"</i> power', 51],
        ['You may not use a pink power during your turn', 51],
        ['If a pink power is triggered by a player using', 51],
        ['<i>"Discarding"</i> food while resolving a bird power', 45],
        ['You may substitute 2 [wild] for any 1 food', 18],
        ['If you perform more than one action <i>"at the end of your turn"</i>', 10],
        ['You may perform an action even if it precludes you', 8],
        ['If you use a bird\'s power to play in the same habitat a bird an alternative', 8],
        ['Only powers of birds played on a player mat can be used', 4],
        ['A bird played horizontally qualifies for one of', 4],
        ['Cards whose powers include the phrase <i>"it becomes a tucked card"</i>', 4],
        ['If information printed on a card conflicts with the card\'s appendix entry', 3],
        ['This bird counts double for <strong>Beak pointing left/right</strong>', 3],
    ]

    const counts = new Map<string, number>()
    let total = 0
    for (const card of BirdCards as any[]) {
        for (const ruling of card.additionalRulings || []) {
            counts.set(ruling.text, (counts.get(ruling.text) || 0) + 1)
            total++
        }
    }

    EXPECTED.forEach(([prefix, expected]) => {
        it(`attaches "${prefix.slice(0, 45)}..." to ${expected} birds`, () => {
            const matches = Array.from(counts.entries()).filter(([text]) => text.startsWith(prefix))
            // One entry, so a reworded ruling fails loudly instead of counting zero.
            expect(matches.map(([text]) => text.slice(0, 60)).length).toBe(1)
            expect(matches[0][1]).toBe(expected)
        })
    })

    it('attaches only these 17 general rulings, 798 times in total', () => {
        expect(counts.size).toBe(EXPECTED.length)
        expect(total).toBe(EXPECTED.reduce((sum, [, n]) => sum + n, 0))
    })

    // The pipeline strips the ruling id (see rulings-domain-knowledge.md), so text
    // is the only handle the app has on a ruling. Guard the shape it relies on.
    it('gives every attached ruling a non-empty text and source', () => {
        const bad: string[] = []
        for (const card of BirdCards as any[]) {
            for (const ruling of card.additionalRulings || []) {
                if (!ruling.text || !ruling.source) { bad.push(card['Common name']) }
            }
        }
        expect(bad).toEqual([])
    })
})
