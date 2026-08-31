import { BirdCard, GeneralRuling } from './app.interfaces'
import BirdCardsJson from '../../assets/data/master.json'
import GeneralRulingsJson from '../../assets/data/general.json'

/**
 * The one place that knows the on-disk shape of the card data, so that the difference between what the
 * notebook writes and what the app reads lives here rather than in the reducer.
 *
 * There is one such difference. A general ruling reaches many birds -- the 59 of them cover 2564 birds
 * between them -- and master.json used to carry a full copy of the text on every bird it reached: 628KB
 * of the file, 67KB of it gzipped, because gzip's 32KB window cannot see one copy from the next. Each
 * bird now holds the *row index* of each general ruling that reaches it, and they are resolved back into
 * ruling objects here, once, into the shape the rest of the app already expects. Resolving means the
 * detail dialogs, the rulings view and the specs need to know nothing about it.
 *
 * By index and not by id: three ids carry two general rows each (see `RulingCard.key`).
 */
export const generalRulings: GeneralRuling[] = Object.values(GeneralRulingsJson)

// @ts-ignore -- the JSON is typed structurally by resolveJsonModule and does not line up with BirdCard.
export const birdCards: BirdCard[] = BirdCardsJson.map(card => ({
    ...card,
    // One object per general ruling, shared by every bird that carries it. Nothing mutates a ruling
    // (`setLanguage` rebuilds cards but leaves rulings in English), and the rulings view groups by id
    // and text rather than by identity, so sharing is invisible -- it just costs 59 objects instead of
    // 2564.
    additionalRulings: card.additionalRulings.map(index => generalRulings[index]),
}))
