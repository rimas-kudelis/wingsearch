import { Directive, HostListener, inject } from '@angular/core'
import { Router } from '@angular/router'

@Directive({
  standalone: false,
  selector: '[appLinkWatcher]'
})
export class ApplinkDirective {
  private router = inject(Router)

  @HostListener('click', ['$event.target']) onClick($event) {
    const url: string = $event.getAttribute('applink')
    if (!url)
      return
    if (url.match(/http:\/\/|https:\/\//))
      window.location.href = url
    else
      this.router.navigate([url])
  }
}
