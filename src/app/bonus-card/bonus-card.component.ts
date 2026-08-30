import { Component, Input, inject } from '@angular/core'
import { BonusCard } from '../store/app.interfaces'
import { MatDialog } from '@angular/material/dialog'

@Component({
  standalone: false,
  selector: 'app-bonus-card',
  templateUrl: './bonus-card.component.html',
  styleUrls: ['./bonus-card.component.scss']
})
export class BonusCardComponent {
  dialog = inject(MatDialog)

  @Input()
  card: BonusCard

  getPointConditions(): { value: string, point: boolean }[][] {
    return this.card.VP ? this.card.VP.split(';').reduce((acc, condition) => {
      const match = condition.match(/[0-9]+\[point\]/)

      if (!match)
        return [...acc, [{ value: condition, point: false }]]
      if (!match.index)
        return [...acc, [{ value: match[0], point: true }, { value: condition.slice(match[0].length), point: false }]]
      else
        return [...acc, [{ value: condition.slice(0, match.index), point: false }, { value: match[0], point: true }]]
    }, []) : []
  }

  // Same URL the bird card's `<img src>` uses, so the two share one download and one cache
  // entry. Kept out of the stylesheet on purpose -- see bonus-card.component.scss.
  get expansionIndicator(): string {
    return `url(assets/icons/png/expansion-indicators/${this.card.Set}.webp)`
  }

  // The condition gets no fitting pass, so two buckets carry it. `cqh` is 1% of the card's height,
  // which is what the old `cardHeight * 0.052` measured -- the same number, without the JS.
  get descriptionFontSize(): string {
    const charCount = this.card.Condition.replace(/\[.*?\]/g, '1').length
    return charCount <= 100 ? '5.2cqh' : '4.5cqh'
  }
}
