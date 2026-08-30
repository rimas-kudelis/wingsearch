import { TestBed } from '@angular/core/testing'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideHttpClient } from '@angular/common/http'
import { Actions, ROOT_EFFECTS_INIT } from '@ngrx/effects'
import { ReplaySubject, firstValueFrom } from 'rxjs'
import { AppEffects } from './app.effects'
import { CookiesService } from '../cookies.service'
import { changeLanguage } from './app.actions'

// `loadLanguage$` is a class *field* whose initializer reads `this.actions$`. Under native
// class fields -- what an ES2022 target emits -- field initializers run in declaration order,
// so `actions$` must be declared *above* `loadLanguage$` or it is still undefined when the
// effect is built and AppEffects throws `Cannot read properties of undefined (reading 'pipe')`
// while bootstrapping, which renders the entire app blank with one console line. The build and
// every other spec stay green through that. These specs construct the effect for real, so
// reordering the fields (or going back to constructor DI) fails here instead of in production.
describe('AppEffects', () => {
  let actions$: ReplaySubject<unknown>
  let http: HttpTestingController
  let cookieJar: { [key: string]: string }

  beforeEach(() => {
    actions$ = new ReplaySubject(1)
    cookieJar = {}

    TestBed.configureTestingModule({
      providers: [
        AppEffects,
        CookiesService,
        { provide: Actions, useValue: actions$ },
        provideHttpClient(),
        provideHttpClientTesting(),
      ]
    })

    const cookies = TestBed.inject(CookiesService)
    spyOn(cookies, 'getCookie').and.callFake((name: string) => cookieJar[name] || '')
    spyOn(cookies, 'hasConsent').and.callFake(() => cookieJar.consent === '1')

    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('constructs with its effect wired to the action stream', () => {
    const effects = TestBed.inject(AppEffects)
    expect(effects.loadLanguage$).toBeDefined()
    expect(typeof effects.loadLanguage$.subscribe).toBe('function')
  })

  it('falls back to English when no language cookie is set', async () => {
    const effects = TestBed.inject(AppEffects)
    actions$.next({ type: ROOT_EFFECTS_INIT })

    expect(await firstValueFrom(effects.loadLanguage$)).toEqual({ type: '[App] English' })
  })

  it('ignores a language cookie that was stored without consent', async () => {
    cookieJar.language = 'de'
    const effects = TestBed.inject(AppEffects)
    actions$.next({ type: ROOT_EFFECTS_INIT })

    expect(await firstValueFrom(effects.loadLanguage$)).toEqual({ type: '[App] English' })
  })

  it('fetches the i18n file named by the language cookie on init', async () => {
    cookieJar.consent = '1'
    cookieJar.language = 'de'
    // `!== '0'` is the encoding: absent means enabled, so only an explicit '0' turns one off.
    cookieJar['expansion.oceania'] = '0'

    const effects = TestBed.inject(AppEffects)
    const dispatched = firstValueFrom(effects.loadLanguage$)
    actions$.next({ type: ROOT_EFFECTS_INIT })

    const request = http.expectOne('assets/data/i18n/de.json')
    expect(request.request.method).toBe('GET')
    request.flush({ birds: {} })

    const action = await dispatched as { type: string, language: string, expansion: { [key: string]: boolean } }
    expect(action.type).toBe('[App] Set language')
    expect(action.language).toBe('de')
    expect(action.expansion.core).toBe(true)
    expect(action.expansion.oceania).toBe(false)
  })

  it('prefers the language on a changeLanguage action over the cookie', async () => {
    cookieJar.consent = '1'
    cookieJar.language = 'de'

    const effects = TestBed.inject(AppEffects)
    const dispatched = firstValueFrom(effects.loadLanguage$)
    // @ts-ignore -- changeLanguage's payload type is wider than the fields the effect reads.
    actions$.next(changeLanguage({ language: 'fr' }))

    http.expectOne('assets/data/i18n/fr.json').flush({ birds: {} })

    expect((await dispatched as unknown as { language: string }).language).toBe('fr')
  })
})
