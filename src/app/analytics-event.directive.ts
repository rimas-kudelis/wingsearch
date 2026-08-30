import { Directive, ElementRef, Input, OnDestroy, OnInit, Renderer2, inject } from '@angular/core'
import { AnalyticsService } from './analytics.service'

@Directive({
  standalone: false,
  selector: '[appAnalyticsEvent]'
})
export class AnalyticsEventDirective implements OnInit, OnDestroy {
  private analytics = inject(AnalyticsService)
  private renderer = inject(Renderer2)
  private elementRef = inject(ElementRef)

  @Input('appAnalyticsEvent') eventName: string
  @Input() eventCategory = 'engagement'
  @Input() eventLabel = ''
  @Input() eventListening = 'click'

  private dispose: () => void

  ngOnInit() {
    this.dispose = this.renderer.listen(this.elementRef.nativeElement, this.eventListening, () =>
      this.analytics.sendEvent(this.eventName, { event_category: this.eventCategory, event_label: this.eventLabel })
    )
  }

  ngOnDestroy() {
    this.dispose()
  }
}
