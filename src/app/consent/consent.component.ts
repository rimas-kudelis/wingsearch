import { Component, EventEmitter, Output, inject } from '@angular/core'
import { AnalyticsService } from '../analytics.service'
import { CookiesService } from '../cookies.service'

@Component({
  standalone: false,
  selector: 'app-consent',
  templateUrl: './consent.component.html',
  styleUrls: ['./consent.component.scss']
})
export class ConsentComponent {
  private cookies = inject(CookiesService)
  private analytics = inject(AnalyticsService)

  @Output()
  consentChange = new EventEmitter<string>()

  setConsent(value: string) {
    this.cookies.setCookie('consent', value, 180, true)
    this.consentChange.emit(value)

    if (value === '1')
      this.analytics.setLanguage(this.cookies.getCookie('language') || 'en')
  }
}
