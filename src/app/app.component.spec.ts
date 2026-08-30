import { TestBed, ComponentFixture } from '@angular/core/testing'
import { NO_ERRORS_SCHEMA } from '@angular/core'
import { RouterTestingModule } from '@angular/router/testing'
import { AppComponent } from './app.component'
import { CookiesService } from './cookies.service'

// AppComponent's template is just the app-search / app-display / app-consent
// shell, so NO_ERRORS_SCHEMA lets us assert on the component without pulling in
// the whole module graph (store, Material, every card component).
describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>
  let component: AppComponent
  let cookies: jasmine.SpyObj<CookiesService>

  beforeEach(() => {
    cookies = jasmine.createSpyObj('CookiesService', ['getCookie', 'setCookie'])

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [AppComponent],
      providers: [{ provide: CookiesService, useValue: cookies }],
      schemas: [NO_ERRORS_SCHEMA],
    })

    fixture = TestBed.createComponent(AppComponent)
    component = fixture.componentInstance
  })

  it('creates the component', () => {
    expect(component).toBeTruthy()
  })

  it('has the title "wingsearch"', () => {
    expect(component.title).toEqual('wingsearch')
  })

  it('renders the search and display shell', () => {
    fixture.detectChanges()
    const compiled: HTMLElement = fixture.nativeElement

    expect(compiled.querySelector('app-search')).toBeTruthy()
    expect(compiled.querySelector('app-display')).toBeTruthy()
  })

  describe('consent banner', () => {
    it('shows when the consent cookie is absent', () => {
      cookies.getCookie.and.returnValue('')

      component.ngOnInit()

      expect(component.displayConsent).toBe(true)
    })

    it('stays hidden when consent has already been given', () => {
      cookies.getCookie.and.returnValue('1')

      component.ngOnInit()

      expect(component.displayConsent).toBe(false)
    })

    it('hides once consent is acknowledged', () => {
      cookies.getCookie.and.returnValue('')
      component.ngOnInit()

      component.onConsentChange()

      expect(component.displayConsent).toBe(false)
    })
  })
})
