import { Pipe, PipeTransform, inject } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'

@Pipe({
  standalone: false,
  name: 'safe'
})
export class SafePipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer)

  transform(value: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(value)
  }
}
