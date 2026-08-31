import { BrowserModule } from '@angular/platform-browser'
import { ReactiveFormsModule, FormsModule } from '@angular/forms'
import { provideHttpClient } from '@angular/common/http'
import { NgModule } from '@angular/core'
import { MatAutocompleteModule } from '@angular/material/autocomplete'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipsModule } from '@angular/material/chips'
import { MatDialogModule } from '@angular/material/dialog'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatSelectModule } from '@angular/material/select'
import { MatTooltipModule } from '@angular/material/tooltip'
import { ServiceWorkerModule } from '@angular/service-worker'
import { NgxSliderModule } from '@angular-slider/ngx-slider'
import { InfiniteScrollDirective } from 'ngx-infinite-scroll'
import { EffectsModule } from '@ngrx/effects'
import { StoreModule } from '@ngrx/store'
import { StoreDevtoolsModule } from '@ngrx/store-devtools'
import { StoreRouterConnectingModule, routerReducer } from '@ngrx/router-store'

import { AppRoutingModule } from './app-routing.module'
import { AppComponent } from './app.component'
import { SearchComponent } from './search/search.component'
import { environment } from '../environments/environment'
import { appReducer } from './store/app.reducer'
import { DisplayComponent } from './display/display.component'
import { BonusCardOptionComponent } from './bonus-card-option/bonus-card-option.component'
import { BirdCardComponent } from './bird-card/bird-card.component'
import { HummingbirdCardComponent } from './hummingbird-card/hummingbird-card.component'
import { BonusCardComponent } from './bonus-card/bonus-card.component'
import { RulingCardComponent } from './ruling-card/ruling-card.component'
import { IconizePipe } from './iconize.pipe'
import { StatsComponent } from './stats/stats.component'
import { CookiesService } from './cookies.service'
import { AnalyticsService } from './analytics.service'
import { ConsentComponent } from './consent/consent.component'
import { BirdCardDetailComponent } from './bird-card/bird-card-detail/bird-card-detail.component'
import { BonusCardDetailComponent } from './bonus-card/bonus-card-detail/bonus-card-detail.component'
import { HummingbirdCardDetailComponent } from './hummingbird-card/hummingbird-card-detail/hummingbird-card-detail.component'
import { AppEffects } from './store/app.effects'
import { TranslatePipe } from './translate.pipe'
import { LanguageDialogComponent } from './search/language-dialog/language-dialog.component'
import { AssetPackDialogComponent } from './search/asset-pack-dialog/asset-pack-dialog.component'
import { AnalyticsEventDirective } from './analytics-event.directive'
import { ApplinkDirective } from './applink.directive'
import { FitTextDirective} from './fittext.directive'
import { SafePipe } from './safe.pipe'

@NgModule({
  declarations: [
    AppComponent,
    SearchComponent,
    DisplayComponent,
    BonusCardOptionComponent,
    BirdCardComponent,
    HummingbirdCardComponent,
    BonusCardComponent,
    RulingCardComponent,
    IconizePipe,
    StatsComponent,
    ConsentComponent,
    BirdCardDetailComponent,
    BonusCardDetailComponent,
    HummingbirdCardDetailComponent,
    TranslatePipe,
    LanguageDialogComponent,
    AssetPackDialogComponent,
    AnalyticsEventDirective,
    ApplinkDirective,
    FitTextDirective,
    SafePipe,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    InfiniteScrollDirective,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    NgxSliderModule,
    ReactiveFormsModule,
    StoreModule.forRoot({ app: appReducer, router: routerReducer }, {}),
    StoreRouterConnectingModule.forRoot(),
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: environment.production }),
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production }),
    EffectsModule.forRoot([AppEffects]),
  ],
  providers: [
    AnalyticsService,
    CookiesService,
    TranslatePipe,
    // HttpClientModule is gone; the effects layer fetches the i18n files with HttpClient.
    provideHttpClient(),
  ],
  bootstrap: [AppComponent]
  // `entryComponents` was removed with ViewEngine: Ivy resolves dialog components from the
  // `open()` call site, so the four dialogs need no separate declaration.
})
export class AppModule { }
