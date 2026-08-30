import { Directive, ElementRef, Input, AfterViewInit, NgZone, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core'

@Directive({
  standalone: false,
    selector: '[appFitText]'
  })
  export class FitTextDirective implements AfterViewInit, OnChanges, OnDestroy {
    private elementRef = inject(ElementRef)
    private ngZone = inject(NgZone)

    @Input() minFontSize = 8
    @Input() appFitText = '' // text input trigger

    private el: HTMLElement
    private observer: ResizeObserver
    private lastWidth = -1

    constructor() {
      this.el = this.elementRef.nativeElement
    }

    ngAfterViewInit() {
      // The ceiling used to arrive as a `maxFontSize` px number computed from a measured card
      // height; it now comes from the stylesheet as a `cqh` value, so it moves on its own whenever
      // the card is resized -- a window resize, a dialog opening, the grid choosing a new column
      // count. Watching the *parent* is what makes that safe to react to: shrinking the text can
      // change this element's own box, but never the parent's width, so the observer cannot feed
      // itself. And the parent's width is exactly what tracks the card.
      const target = this.el.parentElement || this.el
      this.ngZone.runOutsideAngular(() => {
        this.observer = new ResizeObserver(entries => {
          const width = entries[0].contentRect.width
          if (width === this.lastWidth) {
            return
          }
          this.lastWidth = width
          this.scheduleFit()
        })
        // Fires once on observe, which is the initial fit.
        this.observer.observe(target)
      })
    }

    ngOnChanges(changes: SimpleChanges) {
      if (changes.appFitText) {
        this.scheduleFit()
      }
    }

    ngOnDestroy() {
      this.observer?.disconnect()
    }

    private scheduleFit() {
      this.ngZone.runOutsideAngular(() => {
        requestAnimationFrame(() => this.fit())
      })
    }

    private fit() {
        // Drop our own size first, so getComputedStyle reports what the stylesheet asks for. That
        // is the ceiling, already resolved against the card's current height.
        this.el.style.removeProperty('font-size')
        this.el.style.removeProperty('line-height')

        // If the stylesheet's size fits, leave it in place: it is a `cqh` value and will keep
        // tracking the card without us.
        if (this.fits()) {
          return
        }

        let low = this.minFontSize
        let high = Math.floor(parseFloat(getComputedStyle(this.el).fontSize)) - 1
        let best = low

        while (low <= high) {
          const mid = Math.floor((low + high) / 2)
          this.el.style.fontSize = mid + 'px'
          this.el.style.lineHeight = (mid + 1) + 'px'

          if (this.fits()) {
            best = mid
            low = mid + 1
          } else {
            high = mid - 1
          }
        }

        this.el.style.fontSize = best + 'px'
        this.el.style.lineHeight = (best + 1) + 'px'
    }

    private fits(): boolean {
      return (
        this.el.scrollHeight <= this.el.clientHeight &&
        this.el.scrollWidth <= this.el.clientWidth
      )
    }
  }
