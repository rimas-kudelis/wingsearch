import { Directive, ElementRef, Input, OnDestroy, OnInit, Renderer2 } from '@angular/core'
import { AnalyticsService } from './analytics.service'

@Directive({
  standalone: false,
  selector: '[appAnalyticsEvent]'
})
export class AnalyticsEventDirective implements OnInit, OnDestroy {

  @Input('appAnalyticsEvent') eventName: string
  @Input() eventCategory = 'engagement'
  @Input() eventLabel = ''
  @Input() eventListening = 'click'

  private dispose: () => void

  constructor(private analytics: AnalyticsService, private renderer: Renderer2, private elementRef: ElementRef) { }

  ngOnInit() {
    this.dispose = this.renderer.listen(this.elementRef.nativeElement, this.eventListening, () =>
      this.analytics.sendEvent(this.eventName, { event_category: this.eventCategory, event_label: this.eventLabel })
    )
  }

  ngOnDestroy() {
    this.dispose()
  }
}
