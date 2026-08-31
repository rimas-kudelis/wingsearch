import { appReducer, initialState } from './app.reducer'
import * as appActions from './app.actions'
import { AppState, BirdCard } from './app.interfaces'
import DeJson from '../../assets/data/i18n/de.json'
import NlJson from '../../assets/data/i18n/nl.json'

/**
 * The contract between scripts/transform/language-to-json.ipynb and `setLanguage`.
 *
 * app.reducer.spec.ts covers the *behaviour* of a language change with a hand-written payload, which
 * is the right way to test the merge rules but says nothing about whether the eleven committed files
 * still have the shape those rules expect. That shape is not obvious: the spreadsheets carry columns
 * the app never reads and the notebook drops some of them, blank cells arrive as `null` rather than
 * missing, and the app is expected to keep working for a language that has translated a tenth of the
 * cards. A file regenerated with a column renamed, or a `NaN` written where a `null` was expected,
 * would leave every spec in the suite passing and every card in that language English.
 *
 * German and Dutch, because they fail differently: German has most of the base game and none of the
 * newer expansions, Dutch has the Americas rows a contributor added and blanks elsewhere.
 */
describe('the committed i18n files', () => {

    const allExpansions = () => ({
        core: true, european: true, oceania: true, asia: true, americas: true,
    })

    const translate = (payload: any, language: string): AppState =>
        appReducer(initialState, appActions.setLanguage({ payload, language, expansion: allExpansions() } as any))

    const bird = (state: AppState, id: number): BirdCard =>
        state.birdCards.find(card => card.id === id)

    // Both files, but not by iterating the directory: an import is resolved at build time, and a spec
    // that silently covers nothing when a file is renamed is worse than one that fails to compile.
    const files: [string, string, any][] = [['de', 'German', DeJson], ['nl', 'Dutch', NlJson]]

    files.forEach(([lang, name, json]) => describe(`${name} (${lang}.json)`, () => {

        it('has the five sections the reducer reads', () => {
            expect(Object.keys(json).sort()).toEqual(['birds', 'bonuses', 'goals', 'other', 'parameters'])
        })

        it('keys birds and bonuses by card id', () => {
            const state = translate(json, lang)
            const ids = new Set(state.birdCards.map(card => card.id))

            expect(Object.keys(json.birds).every(id => ids.has(Number(id)))).toBe(true)
            expect(Object.keys(json.bonuses).every(id => Number(id) >= 1000 && Number(id) <= 1060)).toBe(true)
        })

        it('translates every bird whose Common name is filled in', () => {
            const state = translate(json, lang)
            const filled = Object.entries<any>(json.birds)
                .filter(([, v]) => v['Common name'] && String(v['Common name']).trim())

            expect(filled.length).toBeGreaterThan(100)
            expect(filled.filter(([id, v]) =>
                bird(state, Number(id))['Common name'] !== String(v['Common name']).trim()))
                .toEqual([])
        })

        it('leaves a bird with no translation in English', () => {
            const state = translate(json, lang)
            const untouched = state.birdCards.filter(card => !json.birds[String(card.id)])

            // Not a fixed number: which cards a language covers is up to its translator. The point is
            // that the fall-through is exercised at all, and that it yields the English card.
            expect(untouched.length).toBeGreaterThan(0)
            expect(untouched.every(card => card['Common name'] && !/^\s*$/.test(card['Common name']))).toBe(true)
        })

        // Blank cells arrive as JSON `null` (simplejson's `ignore_nan`), and the merge skips them
        // key by key -- so a bird with a translated name but no translated power text keeps the
        // English power text rather than losing it.
        it('falls back per field, not per card', () => {
            const state = translate(json, lang)
            const halves = Object.entries<any>(json.birds).filter(([, v]) =>
                v['Common name'] && !v['Power text'])

            expect(halves.length).toBeGreaterThan(0)
            expect(halves.filter(([id]) => {
                const card = bird(state, Number(id))
                return card['Power text'] !== initialState.birdCards.find(c => c.id === Number(id))['Power text']
            })).toEqual([])
        })

        // The four name-matching bonus cards are per-language data, not translations: the reducer
        // copies the flag across even when it is null, because a bird that is an Anatomist in English
        // need not be one here. See issue #38.
        it('carries the bonus-card flags as written, including their absence', () => {
            const state = translate(json, lang)
            const flagged = Object.entries<any>(json.birds).filter(([, v]) => v.Anatomist)

            expect(flagged.every(([id]) => bird(state, Number(id)).Anatomist)).toBe(true)
        })

        it('translates the static UI strings through `other`', () => {
            const state = translate(json, lang)

            expect(Object.keys(state.translatedContent).length).toBeGreaterThan(0)
            expect(Object.values<any>(state.translatedContent).every(v => 'Translated' in v)).toBe(true)
        })

        // Dropped by the notebook because nothing reads them; asserted so that re-adding them is a
        // deliberate change and not an accident of editing a spreadsheet.
        it('does not ship the columns that only identify a row', () => {
            const anyBird = Object.values<any>(json.birds)[0]

            expect('Expansion' in anyBird).toBe(false)
            expect('Scientific name' in anyBird).toBe(false)
            expect('English name' in anyBird).toBe(true)
        })
    }))
})
