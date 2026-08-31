import { Component, Input } from '@angular/core'
import { BirdCard, BonusCard, RulingCard, isBonusCard } from '../store/app.interfaces'

/**
 * A ruling in the result list (issue #46). Not a card: it is prose, so it lays out as a full-width panel
 * above the card grid rather than in a 28:43 tile, and it opens no dialog -- everything a ruling has is
 * the text, its source, and the cards it applies to, all of which fit in the panel itself.
 *
 * The card list is capped rather than truncated: the widest general ruling reaches 315 birds, and a
 * player who wants to see all of them can say so.
 */
@Component({
  standalone: false,
  selector: 'app-ruling-card',
  templateUrl: './ruling-card.component.html',
  styleUrls: ['./ruling-card.component.scss']
})
export class RulingCardComponent {

  @Input()
  card: RulingCard

  readonly CARD_LIMIT = 8

  expanded = false

  get shownCards(): (BirdCard | BonusCard)[] {
    return this.expanded ? this.card.cards : this.card.cards.slice(0, this.CARD_LIMIT)
  }

  get hiddenCount(): number {
    return this.expanded ? 0 : Math.max(0, this.card.cards.length - this.CARD_LIMIT)
  }

  cardName(card: BirdCard | BonusCard): string {
    return isBonusCard(card) ? card['Bonus card'] : card['Common name']
  }

  toggle(event: MouseEvent) {
    event.stopPropagation()
    this.expanded = !this.expanded
  }
}
