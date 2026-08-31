import { createAction, props } from '@ngrx/store'
import { Expansion, PromoPack, SearchQuery } from './app.interfaces'

// The payload is the whole search form; `SearchQuery` lives in app.interfaces.ts because the reducer
// stores the last one in `AppState.query`.
export const search = createAction('[App] Search', props<SearchQuery>())

export const bonusCardSearch = createAction('[App] Bonus Card Search',
    props<{
        bonus: string[], bonusfield: string, expansion: Expansion
    }>()
)

export const scroll = createAction('[App] Scroll')

export const setLanguage = createAction('[App] Set language',
    props<{
        payload: {
            birds: { 'Common name': string, 'Power text': string, 'Note': string }[],
            bonuses: { 'Bonus card': string, 'Condition': string, 'Explanatory text': string, 'VP': string, 'Note': string },
            other: { [key: string]: { Translated: string } }
            parameters: { [key: string]: {Value: unknown} }
        },
        language: string,
        expansion: Expansion
    }>())

export const changeLanguage = createAction('[App] Change language',
    props<{
        language: string,
        expansion: Expansion,
        promoPack: PromoPack
  }>()
)

export const resetLanguage = createAction('[App] Reset language',
    props<{
        expansion: Expansion
  }>()
)

export const changeAssetPack = createAction('[App] Change asset pack',
    props<{
        assetPack: string
  }>()
)
