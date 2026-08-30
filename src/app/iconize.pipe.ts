import { Pipe, PipeTransform } from '@angular/core'

@Pipe({
  standalone: false,
  name: 'iconize'
})
export class IconizePipe implements PipeTransform {

  private static readonly NON_SEPARATION_SPECIAL_CHARACTERS = ['\\.', ',', ';', '\\-', '\\_', '\\)']

  static nonSeparationSpecialCharactersRegex: string = IconizePipe.NON_SEPARATION_SPECIAL_CHARACTERS.join('|')

  // The `<picture>` no longer selects between formats -- every browser Angular 22 compiles for
  // reads WebP -- but it stays as the wrapper `.icon-picture` is styled on. Note the directory
  // is still called `icons/png`; renaming it would invalidate every translator's icon table.
  private readonly BASE_HTML_STRING = `
  <picture class="icon-picture">
    <img class="icon-image" src="assets/icons/png/$1.webp" alt="$1" aria-hidden="false" aria-label="$1 icon">
  </picture>
  `
  private readonly NOBR_HTML_STRING = '<span class="nobr">' + this.BASE_HTML_STRING + '$2' + '</span>'

  private readonly DARK_MAP = {
    seed: 'seed-dark'
  }

  private readonly GLOW_MAP = {
    forest: 'forest-glow',
    grassland: 'grassland-glow',
    wetland: 'wetland-glow',
    seed: 'seed-glow',
    'seed-dark': 'seed-dark-glow',
    invertebrate: 'invertebrate-glow',
    fish: 'fish-glow',
    fruit: 'fruit-glow',
    rodent: 'rodent-glow',
    nectar: 'nectar-glow',
    wild: 'wild-glow'
  }

  transform(value: string, dark = false, glow = false): string {
    const marker = '\\[([a-z\\-\\_]+)\\]'
    const specials = IconizePipe.nonSeparationSpecialCharactersRegex
    let result = value && value
      .replace(new RegExp(marker + '(?!' + specials + ')', 'g'), this.BASE_HTML_STRING)
      .replace(new RegExp(marker + '(' + specials + ')', 'g'), this.NOBR_HTML_STRING)

    if (dark)
      Object.entries(this.DARK_MAP).forEach(([icon, variant]) =>
        result = result.replace(new RegExp(icon + '\\.webp', 'g'), variant + '.webp')
      )

    if (glow)
      Object.entries(this.GLOW_MAP).forEach(([icon, variant]) =>
        result = result.replace(new RegExp(icon + '\\.webp', 'g'), variant + '.webp')
      )

    return result
  }

}
