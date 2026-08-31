import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core'
import { MAT_DIALOG_DATA } from '@angular/material/dialog'
import { select, Store } from '@ngrx/store'
import { Observable } from 'rxjs'
import { first, flatMap, tap } from 'rxjs/operators'
import { AppState, BirdCard, BonusCard } from '../../store/app.interfaces'
import { compatibleBirdIdsFor, RelatedBonusCard, relatedBonusCards } from '../../store/carousel-bonuses'

@Component({
  standalone: false,
  selector: 'app-bonus-card-detail',
  templateUrl: './bonus-card-detail.component.html',
  styleUrls: ['./bonus-card-detail.component.scss']
})
export class BonusCardDetailComponent implements OnInit {
  data = inject<{
    card: BonusCard;
}>(MAT_DIALOG_DATA)
  private store = inject<Store<{
    app: AppState;
}>>(Store)

  @ViewChild('cardWrapper', { read: ElementRef })
  cardWrapper: ElementRef
  @ViewChild('carousel', { read: ElementRef })
  carousel: ElementRef

  layout: 'desktop' | 'mobile'
  bonusCards$: Observable<RelatedBonusCard[]>
  birds: BirdCard[]
  // The template divides each carousel card's shared-bird count by this, so it has to stay on the
  // component even though `relatedBonusCards` derives its own copy.
  compatibleBirdIds: number[]

  ngOnInit(): void {
    this.layout = this.calculateLayout(window.innerWidth)
    this.initBonuses()
  }

  initBonuses() {
    this.bonusCards$ = this.store.pipe(
      select(({ app }) => app.birdCards),
      first(),
      tap(birds => {
        this.birds = birds
        this.compatibleBirdIds = compatibleBirdIdsFor(birds, this.data.card)
      }),
      flatMap(() => this.store.select(({ app }) =>
        relatedBonusCards(app.bonusCards, this.birds, app.expansion, this.data.card)))
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
