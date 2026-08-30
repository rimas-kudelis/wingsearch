import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core'
import { MAT_DIALOG_DATA } from '@angular/material/dialog'
import { select, Store } from '@ngrx/store'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { AppState, BirdCard, BonusCard } from '../../store/app.interfaces'
import { bonusSearchMap } from '../../store/bonus-search-map'
import { DomSanitizer } from '@angular/platform-browser'

@Component({
  standalone: false,
  selector: 'app-bird-card-detail',
  templateUrl: './bird-card-detail.component.html',
  styleUrls: ['./bird-card-detail.component.scss']
})
export class BirdCardDetailComponent implements OnInit {
  data = inject<{
    card: BirdCard;
}>(MAT_DIALOG_DATA)
  private store = inject<Store<{
    app: AppState;
}>>(Store)
  private sanitizer = inject(DomSanitizer)

  @ViewChild('cardWrapper', { read: ElementRef })
  cardWrapper: ElementRef
  @ViewChild('carousel', { read: ElementRef })
  carousel: ElementRef

  layout: 'desktop' | 'mobile'
  bonusCards$: Observable<BonusCard[]>

  ngOnInit(): void {
    this.layout = this.calculateLayout(window.innerWidth)
    this.initBonuses()
  }

  initBonuses() {
    this.bonusCards$ = this.store.pipe(
      select(({ app }) => app.bonusCards),
      map(cards => {
        const filteredCards = cards.filter(card => card['VP Average'] && bonusSearchMap[card.id].callbackfn(this.data.card))
        filteredCards.sort((a, b) => b['VP Average'] - a['VP Average'])
        return filteredCards
      })
    )
    this.cardWrapper?.nativeElement.scroll(0, 0)
    this.carousel?.nativeElement.scroll(0, 0)
  }

  // The card and carousel sizes are pure CSS now; only the layout switch is left, and it has to
  // stay in TypeScript because the template branches on it (the stats strip moves inside the card
  // on mobile, and the close-target column disappears).
  onResize(event) {
    this.layout = this.calculateLayout(event.target.innerWidth)
  }

  calculateLayout(width): 'desktop' | 'mobile' {
    if (width < 600)
      return 'mobile'
    else
      return 'desktop'
  }
}
