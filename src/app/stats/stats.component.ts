import { Component, Input, Output, EventEmitter, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { DisplayedStats, AppState } from '../store/app.interfaces'
import { Store } from '@ngrx/store'

@Component({
  standalone: false,
  selector: 'app-stats',
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.scss']
})
export class StatsComponent {

  @Input()
  mobile: boolean

  @Input()
  statsControls: {
    habitat: { forest: number, grassland: number, wetland: number }
    birds: boolean,
    bonuses: boolean,
    hummingbirds: boolean,
    rulings: boolean
  }

  @Output()
  statsChange = new EventEmitter()

  stats$: Observable<DisplayedStats>

  constructor() {
    const store = inject<Store<{
    app: AppState;
}>>(Store)

    this.stats$ = store.select(({ app }) => app.displayedStats)
  }

  toggleHabitat(habitat: 'forest' | 'grassland' | 'wetland', event: MouseEvent) {
    event.stopPropagation()

    const newStats = {
      ...this.statsControls,
      habitat: {
        ...this.statsControls.habitat,
        [habitat]: (this.statsControls.habitat[habitat] + 1) % 3
      }
    }

    this.statsChange.emit(newStats)
  }

  toggleCards(cards: 'birds' | 'bonuses' | 'hummingbirds' | 'rulings', event: MouseEvent) {
    event.stopPropagation()

    const newStats = {
      ...this.statsControls,
      habitat: {
        ...this.statsControls.habitat,
      },
      [cards]: !this.statsControls[cards]
    }

    this.statsChange.emit(newStats)
  }
}
