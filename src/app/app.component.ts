import { Component, OnInit, inject } from '@angular/core'
import { MatIconRegistry } from '@angular/material/icon'
import { DomSanitizer } from '@angular/platform-browser'
import { CookiesService } from './cookies.service'

@Component({
  standalone: false,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  private cookies = inject(CookiesService)

  title = 'wingsearch'
  displayConsent = false

  constructor() {
    const registry = inject(MatIconRegistry)
    const sanitizer = inject(DomSanitizer)

    registry.addSvgIcon('externalLink', sanitizer.bypassSecurityTrustResourceUrl('assets/icons/svg/external-link.svg'))
  }

  ngOnInit(): void {
    this.displayConsent = !Number(this.cookies.getCookie('consent'))
  }

  onConsentChange() {
    this.displayConsent = false
  }
}
