import { Component, OnInit, inject } from '@angular/core'
import { Store } from '@ngrx/store'
import {
  BirdCard, BonusCard, RulingCard, isBirdCard, isHummingbirdCard, isBonusCard, isRulingCard
} from '../store/app.interfaces'
import { selectCard, State } from '../store/router'
import { Observable } from 'rxjs'
import { MatDialog } from '@angular/material/dialog'
import { scroll } from '../store/app.actions'
import { BirdCardDetailComponent } from '../bird-card/bird-card-detail/bird-card-detail.component'
import { BonusCardDetailComponent } from '../bonus-card/bonus-card-detail/bonus-card-detail.component'
import { HummingbirdCardDetailComponent } from '../hummingbird-card/hummingbird-card-detail/hummingbird-card-detail.component'
import { AnalyticsService } from '../analytics.service'
import { ActivatedRoute, Router } from '@angular/router'

@Component({
  standalone: false,
  selector: 'app-display',
  templateUrl: './display.component.html',
  styleUrls: ['./display.component.scss']
})
export class DisplayComponent implements OnInit {
  private store = inject<Store<State>>(Store)
  dialog = inject(MatDialog)
  private analytics = inject(AnalyticsService)
  private router = inject(Router)
  private route = inject(ActivatedRoute)

  cards$: Observable<(BirdCard | BonusCard | RulingCard)[]>
  selectedCard$: Observable<BirdCard | BonusCard>
  scrollDisabled$: Observable<boolean>

  private readonly BIRD_DIALOG_ID = '0'
  private readonly BONUS_DIALOG_ID = '1'
  private readonly HUMMINGBIRD_DIALOG_ID = '2'

  selectedCardType: 'bird' | 'hummingbird' | 'bonus' | null = null

  constructor() {
    this.cards$ = this.store.select(({ app }) => app.displayedCards)
    this.scrollDisabled$ = this.store.select(({ app }) => app.scrollDisabled)
    this.selectedCard$ = this.store.select(selectCard)
  }

  ngOnInit(): void {
    this.selectedCard$.subscribe(card => {
      if (!card) {
        this.dialog.closeAll()
        this.selectedCardType = null
        return
      }

      const newCardType = isBirdCard(card) ? 'bird'
        : isHummingbirdCard(card) ? 'hummingbird'
        : 'bonus'

      if (newCardType === this.selectedCardType) {
        // Update existing dialog
        const dialogId = newCardType === 'bird' ? this.BIRD_DIALOG_ID
          : newCardType === 'hummingbird' ? this.HUMMINGBIRD_DIALOG_ID
          : this.BONUS_DIALOG_ID
        const dialogRef = this.dialog.getDialogById(dialogId).componentInstance
        dialogRef.data = { card }
        dialogRef.initBonuses()
      } else {
        // Open new dialog
        this.dialog.closeAll()
        this.selectedCardType = newCardType
        if (newCardType === 'bird') {
          this.openBirdDialog(card as BirdCard)
        } else if (newCardType === 'hummingbird') {
          this.openHummingbirdDialog(card as BirdCard)
        } else {
          this.openBonusDialog(card as BonusCard)
        }
      }
    })
  }

  isBirdCard(card: BirdCard | BonusCard | RulingCard): card is BirdCard {
    return isBirdCard(card)
  }

  isHummingbirdCard(card: BirdCard | BonusCard | RulingCard): card is BirdCard {
    return isHummingbirdCard(card)
  }

  isBonusCard(card: BirdCard | BonusCard | RulingCard): card is BonusCard {
    return isBonusCard(card)
  }

  isRulingCard(card: BirdCard | BonusCard | RulingCard): card is RulingCard {
    return isRulingCard(card)
  }

  openBirdDialog(card: BirdCard) {
    this.dialog.open(BirdCardDetailComponent, {
      data: { card },
      panelClass: 'card-detail-panel',
      closeOnNavigation: false,
      height: '100vh',
      width: '80vw',
      maxWidth: '80vw',
      id: this.BIRD_DIALOG_ID,
      autoFocus: false,
    }).afterClosed().subscribe(() => {
      if (!this.dialog.getDialogById(this.HUMMINGBIRD_DIALOG_ID)
          && !this.dialog.getDialogById(this.BONUS_DIALOG_ID))
        this.router.navigate(['/'])
    })
  }

  openBonusDialog(card: BonusCard) {
    this.dialog.open(BonusCardDetailComponent, {
      data: { card },
      panelClass: 'card-detail-panel',
      closeOnNavigation: false,
      height: '100vh',
      width: '80vw',
      maxWidth: '80vw',
      id: this.BONUS_DIALOG_ID,
      autoFocus: false,
    }).afterClosed().subscribe(() => {
      if (!this.dialog.getDialogById(this.BIRD_DIALOG_ID)
          && !this.dialog.getDialogById(this.HUMMINGBIRD_DIALOG_ID))
        this.router.navigate(['/'])
    })
  }

  openHummingbirdDialog(card: BirdCard) {
    this.dialog.open(HummingbirdCardDetailComponent, {
      data: { card },
      panelClass: 'card-detail-panel',
      closeOnNavigation: false,
      height: '100vh',
      width: '80vw',
      maxWidth: '80vw',
      id: this.HUMMINGBIRD_DIALOG_ID,
      autoFocus: false,
    }).afterClosed().subscribe(() => {
      if (!this.dialog.getDialogById(this.BIRD_DIALOG_ID)
          && !this.dialog.getDialogById(this.BONUS_DIALOG_ID))
        this.router.navigate(['/'])
    })
  }

  onScroll() {
    this.store.dispatch(scroll())
    this.analytics.sendEvent('Scroll cards', { event_category: 'engagement' })
  }
}
