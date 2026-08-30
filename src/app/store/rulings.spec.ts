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

    // ruling id -> [birds carrying it, distinct texts published under that id].
    //
    // Keyed by id since 2026-08-30, when the pipeline stopped stripping it. Text prefixes
    // used to be the only handle, which conflated two different events: rewording a ruling
    // failed exactly as loudly as changing which birds carry it, even though only one of
    // those is a change to what a player is told about their card. The text count is what
    // still catches a reword -- specifically the kind that matters, a row splitting into two
    // texts under one id or two merging into one.
    //
    // Three ids legitimately carry more than one text: one comment answering several
    // unrelated questions becomes several rows sharing its date-derived id (see
    // scripts/rulings/domain-knowledge.md, "the omnibus split").
    const EXPECTED: [string, number, number][] = [
        ['20200404', 315, 1],
        ['20200413', 152, 1],
        ['20210830d', 139, 1],
        ['20210830b', 138, 1],
        ['20220326', 114, 1],
        ['20190601', 109, 1],
        ['20221121b', 78, 1],
        ['20260605', 69, 1],
        ['02g', 63, 1],
        ['20191004', 63, 1],
        ['20210920', 63, 1],
        ['20240713', 63, 1],
        ['20220429b', 57, 1],
        ['20190205', 51, 1],
        ['20190313', 51, 1],
        ['20200208', 51, 1],
        ['20200330', 51, 1],
        ['20230827', 48, 1],
        ['20201117', 45, 1],
        ['20200109a', 30, 1],
        ['20200423b', 21, 1],
        ['20190617', 20, 1],
        ['20220516', 20, 1],
        ['20200716b', 18, 1],
        ['20200504', 15, 1],
        ['20210830', 15, 1],
        ['20210101', 14, 1],
        ['20220429', 13, 1],
        ['20260503', 13, 1],
        ['20210199b', 12, 1],
        ['20221013', 12, 1],
        ['20231228', 12, 1],
        ['20191010', 10, 1],
        ['20201003', 10, 2],
        ['20260520b', 10, 1],
        ['20210199a', 9, 3],
        ['20221116', 9, 1],
        ['20190908', 8, 1],
        ['20200511', 8, 1],
        ['03a', 4, 1],
        ['2020022b', 4, 1],
        ['20210206', 4, 1],
        ['20260816', 4, 1],
        ['20191202', 3, 1],
        ['20200716a', 3, 1],
        ['20210318', 3, 1],
        ['20210830c', 3, 1],
        ['20260814', 3, 1],
        ['20200712', 2, 1],
    ]

    const counts = new Map<string, number>()
    const texts = new Map<string, Set<string>>()
    let total = 0
    for (const card of BirdCards as any[]) {
        for (const ruling of card.additionalRulings || []) {
            counts.set(ruling.id, (counts.get(ruling.id) || 0) + 1)
            if (!texts.has(ruling.id)) { texts.set(ruling.id, new Set()) }
            texts.get(ruling.id).add(ruling.text)
            total++
        }
    }

    EXPECTED.forEach(([id, expected, expectedTexts]) => {
        it(`attaches ${id} to ${expected} birds as ${expectedTexts} ruling(s)`, () => {
            expect(counts.get(id)).toBe(expected)
            expect(texts.get(id) && texts.get(id).size).toBe(expectedTexts)
        })
    })

    it('attaches only these 49 general rulings, 2032 times in total', () => {
        expect(counts.size).toBe(EXPECTED.length)
        expect(total).toBe(EXPECTED.reduce((sum, [, n]) => sum + n, 0))
    })

    it('gives every attached ruling an id, a text and a source', () => {
        const bad: string[] = []
        for (const card of BirdCards as any[]) {
            for (const ruling of [...(card.rulings || []), ...(card.additionalRulings || [])]) {
                if (!ruling.id || !ruling.text || !ruling.source) { bad.push(card['Common name']) }
            }
        }
        expect(bad).toEqual([])
    })

    // The id is what ties a line on the site back to a row of scripts/rulings/rulings.tsv,
    // which is the only way a reader's report ("this ruling looks wrong") can be traced to
    // the source comment it came from. Ids are the source comment's date, YYYYMMDD, with a
    // letter suffix where one comment produced several rulings.
    //
    // The exceptions are enumerated rather than matched by a looser pattern. `01`--`03c`
    // predate the dating scheme and come from the rulebook, the official FAQ and the card
    // update pack, which have no comment date. `2020022b` is a 7-digit typo inherited from
    // the original corpus; renaming it would lapse the curation signatures that quote it, so
    // it stays until those are next regenerated.
    const LEGACY_IDS = ['01', '02a', '02b', '02c', '02d', '02e', '02f', '02g',
        '03a', '03b', '03c', '2020022b']

    it('gives every ruling an id of the documented shape', () => {
        const bad = new Set<string>()
        for (const card of BirdCards as any[]) {
            for (const ruling of [...(card.rulings || []), ...(card.additionalRulings || [])]) {
                if (!/^\d{8}[a-z]?$/.test(ruling.id) && !LEGACY_IDS.includes(ruling.id)) {
                    bad.add(ruling.id)
                }
            }
        }
        expect(Array.from(bad)).toEqual([])
    })
})
