import BirdCards from '../../assets/data/master.json'

/**
 * Snapshot of the general-ruling fan-out in master.json.
 *
 * General rulings are attached when master.json is regenerated, by
 * scripts/rulings/general_map.py, where a regex proposes candidate birds and
 * scripts/rulings/applicability.json (produced by scripts/rulings/audit.py,
 * reviewed by hand) decides which of them keep it. Neither step is visible from
 * the app, so a mistake in either -- a regenerated master.json, an edited
 * predicate, a re-run audit -- would silently change the rulings players read to
 * settle rules disputes.
 *
 * These counts pin that fan-out. A failure here is not necessarily a bug, but it
 * is always a deliberate content change: update the numbers in the same commit
 * that changes the data, and say why in the message.
 */
describe('general rulings fan-out', () => {

    // ruling text prefix -> number of birds carrying it.
    // Recorded 2026-08-30, after the applicability audit, after implementing the predicates
    // that had been left as `lambda row: False`, after resolving the pending proposals, and
    // after promoting 14 rulings that had been published on one card but stated a rule true of
    // every card with that power (see `graph.py --transferable`).
    const EXPECTED: [string, number][] = [
        ['Whenever you are entitled to gain resources, ', 315],
        ['There is no limit to the number of [card] tha', 152],
        ['[egg] laid by a bird power must always be pla', 139],
        ['A <i>"When Played"</i> power resolves only af', 138],
        ['Activating a bird power is optional, includin', 114],
        ['You may only reroll dice when gaining food fr', 109],
        ['When a bird power has each player make a sele', 69],
        ['Each player chooses the order in which they a', 63],
        ['Regular reroll rules apply whenever you have ', 63],
        ['Teal ROUND END powers trigger at the end of e', 63],
        ['Unless a card says otherwise, the birdfeeder ', 63],
        ['A power that says <i>"Draw [card]"</i> withou', 57],
        ['If a pink power is triggered by a player usin', 51],
        ['You may activate each <i>"once between turns"', 51],
        ['You may not use a pink power during your turn', 51],
        ['You may use a pink power during another playe', 51],
        ['Powers that refer to types of birds (e.g., <s', 48],
        ['<i>"Discarding"</i> food while resolving a bi', 45],
        ['Unless specifically stated, your actions are ', 30],
        ['The food a power tells you to discard is a co', 21],
        ['Paying 2 food of one type in place of 1 food ', 20],
        ['[nectar] is not wild for a bird power that na', 20],
        ['You may substitute 2 [wild] for any 1 food in', 18],
        ['Powers that say <i>"Roll all dice not in bird', 15],
        ['When the birdfeeder becomes empty, all 5 [die', 15],
        ['<i>"Giving"</i> a resource to another player ', 14],
        ['A <i>"you may cache"</i> power is literal and', 13],
        ['A power that says <i>"Look at a [card] from t', 13],
        ['A [star] wingspan is wild for each bonus card', 12],
        ['A bird with a [star] wingspan has no printed ', 12],
        ['When a bird with a <i>"copy"</i> power copies', 12],
        ['If you perform more than one action <i>"at th', 10],
        ['Powers that trigger <i>"at the end of your tu', 10],
        ['[card] you draw enter your hand immediately, ', 9],
        ['If you use a bird\'s power to play in the same', 8],
        ['You may perform an action even if it preclude', 8],
        ['Cards discarded to the discard pile are place', 5],
        ['Players may look through the discard pile at ', 5],
        ['A bird played horizontally qualifies for one ', 4],
        ['Cards whose powers include the phrase <i>"it ', 4],
        ['Only powers of birds played on a player mat c', 4],
        ['When a power tells you to gain more than one ', 4],
        ['A card in your hand with the power, <i>"This ', 3],
        ['If information printed on a card conflicts wi', 3],
        ['Since being a predator power is a property of', 3],
        ['The restriction that [egg] must be laid on di', 3],
        ['This bird counts double for <strong>Beak poin', 3],
        ['When a bird (e.g., the <strong applink="/card', 3],
        ['When a bird with a <i>"repeat"</i> power (e.g', 3],
        ['When a power refers to the <i>"player(s) with', 3],
        ['<i>"Trading"</i> (e.g., when using the <stron', 2],
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

    it('attaches only these 51 general rulings, 1954 times in total', () => {
        expect(counts.size).toBe(EXPECTED.length)
        expect(total).toBe(EXPECTED.reduce((sum, [, n]) => sum + n, 0))
    })

    // The pipeline strips the ruling id (see scripts/rulings/domain-knowledge.md), so text
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
