import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core'
import { MAT_DIALOG_DATA } from '@angular/material/dialog'
import { Store } from '@ngrx/store'
import { combineLatest, Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { AppState, BirdCard, BonusCard } from '../../store/app.interfaces'
import { compatibleBonusCards } from '../../store/carousel-bonuses'
import { DomSanitizer } from '@angular/platform-browser'

@Component({
  standalone: false,
  selector: 'app-hummingbird-card-detail',
  templateUrl: './hummingbird-card-detail.component.html',
  styleUrls: ['./hummingbird-card-detail.component.scss']
})
export class HummingbirdCardDetailComponent implements OnInit {
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

  // Three separate `select` calls rather than one projector returning an object: each is memoised on
  // reference, and `app.expansion` only gets a new identity when the user actually changes
  // expansions, so a keystroke behind the dialog does not recompute 28 percentages over 747 birds.
  initBonuses() {
    this.bonusCards$ = combineLatest([
      this.store.select(({ app }) => app.bonusCards),
      this.store.select(({ app }) => app.birdCards),
      this.store.select(({ app }) => app.expansion),
    ]).pipe(
      map(([bonusCards, birdCards, expansion]) =>
        compatibleBonusCards(bonusCards, birdCards, expansion, this.data.card))
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
