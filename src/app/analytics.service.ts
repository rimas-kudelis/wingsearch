import { Injectable } from '@angular/core'
import { CookiesService } from './cookies.service'

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {

  constructor(private cookies: CookiesService) {
    // @ts-ignore
    window.dataLayer = window.dataLayer || []
  }

  setLanguage(language: string) {
    if (!this.cookies.hasConsent())
      return

    this.gtag('js', new Date())
    this.gtag('config', 'UA-177825186-1', { dimension1: language })
  }

  sendEvent(eventName: string, metaData = {}) {
    this.gtag('event', eventName, metaData)
  }

  // Google's own snippet pushes the `arguments` object; gtag.js reads each
  // dataLayer entry array-like, so a rest parameter is equivalent — and it lets
  // the three call sites above be typed instead of `@ts-ignore`d for arity.
  private gtag(...args: unknown[]) {
    // @ts-ignore
    dataLayer.push(args)
  }
}
