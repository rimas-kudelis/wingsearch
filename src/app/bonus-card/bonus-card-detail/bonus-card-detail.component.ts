import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core'
import { MAT_DIALOG_DATA } from '@angular/material/dialog'
import { select, Store } from '@ngrx/store'
import { Observable } from 'rxjs'
import { first, flatMap, map, tap } from 'rxjs/operators'
import { AppState, BirdCard, BonusCard } from '../../store/app.interfaces'
import { bonusSearchMap, dynamicPercentage } from '../../store/bonus-search-map'

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
  bonusCards$: Observable<BonusCard[]>
  birds: BirdCard[]
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
        this.compatibleBirdIds = birds.filter((bird) => bonusSearchMap[this.data.card.id].callbackfn(bird)).map(bird => bird.id)
      }),
      flatMap(() => this.store.select(({ app }) => app.bonusCards.map(dynamicPercentage(this.birds, app.expansion)))),
      map(cards => cards.filter(card => card['VP Average'] && card.id !== this.data.card.id)
        .map(bonus => ({
          ...bonus,
          birdIds: this.birds.filter((bird) => bonusSearchMap[bonus.id].callbackfn(bird))
            .map(bird => bird.id).filter(id => this.compatibleBirdIds.includes(id))
        }))
        .filter(bonus => bonus.birdIds.length).
        sort((a, b) => b.birdIds.length * b['VP Average'] - a.birdIds.length * a['VP Average'])
      )
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
