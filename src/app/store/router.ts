import * as fromRouter from '@ngrx/router-store'
import { createSelector, createFeatureSelector } from '@ngrx/store'
import { AppState, BirdCard, BonusCard } from './app.interfaces'
import { dynamicPercentage } from './bonus-search-map'

export interface State {
    router: fromRouter.RouterReducerState<any>
    app: AppState
}

export const selectRouter = createFeatureSelector<fromRouter.RouterReducerState<any>>('router')

export const {
    selectCurrentRoute,   // select the current route
    selectFragment,       // select the current route fragment
    selectQueryParams,    // select the current route query params
    selectQueryParam,     // factory function to select a query param
    selectRouteParams,    // select the current route params
    selectRouteParam,     // factory function to select a route param
    selectRouteData,      // select the current route data
    selectUrl,            // select the current url
} = fromRouter.getRouterSelectors(selectRouter)

export const selectCardId = selectRouteParam('id')

export const selectCard = createSelector(
    (state: State): (BirdCard | BonusCard)[] =>
        [...state.app.birdCards, ...state.app.bonusCards.map(dynamicPercentage(state.app.birdCards, state.app.expansion))],
    selectCardId,
    (cards: (BirdCard | BonusCard)[], id: string) => cards.find(card => card.id.toString() === id)
)
