#!/usr/bin/env python3
"""Bring the translation spreadsheets in line with the committed card data.

Nothing has ever propagated a new card into these workbooks, so all twelve had
drifted from `src/assets/data`, in three ways that all end with a translator
unable to do the work or a player reading the wrong text:

  * Cards with no row at all. No workbook had one for any of the 150 promo-pack
    birds, the 40 hummingbirds, or 10 of the bonus cards, and the template was
    also missing the `Flavor text` column that every language file has.
  * Rows on the wrong id. Card ids are the sorted row position of
    `wingspan-card-list.xlsx`, so they move when the sort does; five Oceania
    birds were off by one in all eleven languages, which means a player looking
    up Kea read Kākāpō's name and power text. See `rekey_by_name`.
  * `Other` rows that only the template had -- the six promo-pack names the site
    shows as filter labels, and the three strings the rulings section needs.

This script is the fix and the guard:

  * Birds and Bonuses are synced against the card data. It re-keys a row to the
    id whose card carries its English name, rewrites `English name` and
    `Scientific name` from the data (19 of the Americas rows contributed in PR
    #120 carried typos there -- "Monk Parakett", "Thamophilus doliatus"), adds a
    row for every card that has none, and adds any column the sheet lacks.
  * `Other` and `Parameters` have no counterpart in the data, so missing rows are
    appended from the template.

It never touches a translation, or an `Expansion` cell of an existing row.

    scripts/transform/sync-i18n-sheets.py            # every workbook in i18n/
    scripts/transform/sync-i18n-sheets.py --check    # report drift, write nothing
    scripts/transform/sync-i18n-sheets.py i18n/de.xlsx

`Expansion` is left alone on existing rows because the sheets use a vocabulary of
their own there: the data's single `core` set is split into `originalcore` and
`swiftstart`, which is information the JSON does not have. New rows get the set
name from the data, which is what the Americas rows already use.

The Goals sheet is deliberately not synced. `goals.json` is generated but nothing
in the app reads it, so those 46 rows are asking translators for work that cannot
reach a player; and a goal's `English name` ("Bird in Forest") is a hand-written
label, not the `Goal` field of the data ("[bird] in [forest]"), so it could not be
regenerated without inventing it.

Written with openpyxl, which drops a few parts of these workbooks on save. The
ones that carry anything -- the Power Query definition under customXml/ that the
sheets were originally built from, and docProps/custom.xml -- are copied back into
the saved file afterwards. The two it also drops are empty: a `<xdr:wsDr/>` with
no drawings in it.
"""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from copy import copy

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(REPO, 'src', 'assets', 'data')
I18N = os.path.join(REPO, 'i18n')

# Column order as the language files have it; the template was missing `Flavor text`.
BIRD_COLUMNS = ['id', 'English name', 'Scientific name', 'Expansion', 'Common name',
                'Power text', 'Flavor text', 'Note',
                'Anatomist', 'Cartographer', 'Historian', 'Photographer']

BONUS_COLUMNS = ['id', 'English name', 'Expansion', 'Name', 'Condition',
                 'Explanatory text', 'VP', 'Note']

# The two sheets that have no counterpart in src/assets/data, so the template is their source:
# sheet name -> the column holding the key a translation is looked up by.
FROM_TEMPLATE = {'Other': 'English name', 'Parameters': 'Name'}

TEMPLATE = os.path.join(I18N, 'template.xlsx')

# Parts openpyxl drops that are worth keeping. Everything else it drops is either empty
# or something it rewrites itself (sharedStrings).
PRESERVE = ('customXml/', 'docProps/custom.xml')


def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def bird_cards():
    """Every card the Birds sheet should have a row for, id -> identification fields.

    Hummingbirds included: `setLanguage` looks up every card in `birdCards`, and that
    array is birds and hummingbirds concatenated, so a hummingbird row in a language
    file would be honoured. None of the eleven files has ever had one.
    """
    cards = {}
    for f in ('master.json', 'hummingbirds.json'):
        for c in load(f):
            cards[c['id']] = {'English name': c['Common name'],
                              'Scientific name': c['Scientific name'],
                              'Expansion': c['Set']}
    return cards


def bonus_cards():
    return {c['id']: {'English name': c['Bonus card'], 'Expansion': c['Set']}
            for c in load('bonus.json')}


def header_row(ws):
    """{column name: column index}, 1-based, from row 1."""
    return {str(c.value).strip(): c.column for c in ws[1] if c.value is not None}


def id_column(ws, report):
    """Column A, whatever its header says. de.xlsx's reads `=`, which pandas never
    noticed because it takes the first column as the index by position."""
    header = ws.cell(row=1, column=1)
    if str(header.value).strip() != 'id':
        report.append(f'header of the id column was {header.value!r}')
        header.value = 'id'
    return 1


def last_row(ws, id_col):
    """The last row that actually holds a card.

    Not `ws.max_row`, which counts rows that exist only because they carry formatting:
    jp.xlsx's Birds sheet has 553 of those past its last bird, and appending after them
    leaves a block of blank rows in the middle of the sheet, which the pipeline then reads
    as 553 cards with no id.
    """
    for row in range(ws.max_row, 1, -1):
        if ws.cell(row=row, column=id_col).value is not None:
            return row
    return 1


def rekey_by_name(ws, cards, header, report):
    """Move a row to the id whose card carries its English name.

    Card ids are the sorted row position of `wingspan-card-list.xlsx`, so they move when
    the sort does, and these spreadsheets do not follow. Five Oceania birds are off by one
    in all eleven files: `Kākāpō` sorts after `Korimako` in the card data, but the sheets
    were built when it sorted before, so id 298 means Kea in master.json and Kākāpō here.
    The translation is keyed by id, so every one of those five birds has been showing
    another bird's name and power text in every language.

    Applied as one permutation rather than row by row, because the fix is a five-way cycle:
    each row's target id belongs to another row that also has to move. A name that matches
    no card is left alone -- that is a typo in the identification column, which the caller
    corrects from the data instead.
    """
    by_name = {c['English name']: i for i, c in cards.items()}
    if len(by_name) != len(cards):
        report.append('WARNING: the card data has two cards of the same name; not re-keying')
        return

    # The latin name as a second key, because one of these five rows cannot be matched on its
    # English one: template.xlsx spells Kākāpō with a Cyrillic о and a combining macron, which
    # is not the string in the card data however it is normalized. A scientific name is ASCII
    # and unique, so it identifies the row where the common name cannot.
    by_latin = {c['Scientific name']: i for i, c in cards.items() if c.get('Scientific name')}
    if len(by_latin) != len([c for c in cards.values() if c.get('Scientific name')]):
        by_latin = {}

    ids, names, moves = id_column(ws, report), header.get('English name'), {}
    latin = header.get('Scientific name')
    if not names:
        return

    for row in range(2, ws.max_row + 1):
        current = ws.cell(row=row, column=ids).value
        if current is None:
            continue
        name = str(ws.cell(row=row, column=names).value or '').strip()
        target = by_name.get(name)
        if target is None and latin:
            target = by_latin.get(str(ws.cell(row=row, column=latin).value or '').strip())
        if target is None or target == int(current):
            continue
        moves[row] = (int(current), target)

    if not moves:
        return

    after = {ws.cell(row=r, column=ids).value for r in range(2, ws.max_row + 1)}
    after = (after - {old for old, _ in moves.values()}) | {new for _, new in moves.values()}
    if len(after) != len({ws.cell(row=r, column=ids).value for r in range(2, ws.max_row + 1)}):
        report.append(f'WARNING: re-keying {len(moves)} row(s) by name would collide; left alone')
        return

    for row, (old, new) in sorted(moves.items()):
        name = ws.cell(row=row, column=names).value
        report.append(f're-keyed {name} from id {old} to id {new} '
                      f'(id {old} is {cards[old]["English name"]} in the card data)')
        ws.cell(row=row, column=ids).value = new


def add_missing_columns(ws, wanted, report):
    """Insert any missing column at the position `wanted` gives it."""
    for position, name in enumerate(wanted, start=1):
        header = header_row(ws)
        if name in header:
            continue
        ws.insert_cols(position)
        cell = ws.cell(row=1, column=position, value=name)
        # Take the look of the header next door rather than leaving the new one unstyled.
        neighbour = ws.cell(row=1, column=position + 1 if position < ws.max_column else 1)
        cell._style = copy(neighbour._style)
        report.append(f'added column {name!r}')


def sync_sheet(ws, cards, wanted, report):
    # The id header first: de.xlsx's says `=`, and a sheet whose `id` column looks missing
    # would have one inserted in front of the real one.
    id_col = id_column(ws, report)
    add_missing_columns(ws, wanted, report)
    header = header_row(ws)

    # Before anything reads the ids: a row sitting on the wrong id has to move first, or the
    # identification columns below would be "corrected" to the wrong bird and the mistake
    # would become permanent.
    rekey_by_name(ws, cards, header, report)

    rows = {}
    for row in range(2, ws.max_row + 1):
        value = ws.cell(row=row, column=id_col).value
        if value is not None:
            rows[int(value)] = row

    unknown = sorted(i for i in rows if i not in cards)
    if unknown:
        # Never deleted: an id the data does not have is either a card that was removed or
        # a spreadsheet edited by hand, and both want a human to look.
        report.append(f'WARNING: {len(unknown)} row(s) with an id absent from the card data: {unknown}')

    # Identification columns are the script's to own; a typo in one is a translator reading
    # the wrong row. Everything else on an existing row is the translator's.
    for card_id, row in sorted(rows.items()):
        card = cards.get(card_id)
        if not card:
            continue
        for name in ('English name', 'Scientific name'):
            if name not in header or name not in card:
                continue
            cell = ws.cell(row=row, column=header[name])
            if str(cell.value or '').strip() != card[name]:
                report.append(f'id {card_id}: {name} {cell.value!r} -> {card[name]!r}')
                cell.value = card[name]

    missing = [i for i in cards if i not in rows]
    if not missing:
        return

    # Appended rather than inserted in id order, so that a translator's file does not
    # reshuffle under them and the diff is confined to the end of the sheet. By English
    # name because that is the order the sheets are broadly in.
    template_row = min(rows.values()) if rows else 1
    row = last_row(ws, id_col)
    for card_id in sorted(missing, key=lambda i: (cards[i]['English name'], i)):
        row += 1
        for name, column in header.items():
            cell = ws.cell(row=row, column=column)
            cell._style = copy(ws.cell(row=template_row, column=column)._style)
            if name == 'id':
                cell.value = card_id
            elif name in cards[card_id]:
                cell.value = cards[card_id][name]

    report.append(f'added {len(missing)} row(s): '
                  + ', '.join(f'{i} {cards[i]["English name"]}' for i in sorted(missing)[:3])
                  + (f' ... and {len(missing) - 3} more' if len(missing) > 3 else ''))

    # A table whose range stops short of the data is what the workbooks already do -- the
    # Other sheet's table has covered 7 of its 13 rows for years -- but extending it keeps
    # the autofilter useful on the rows just added.
    for table in ws.tables.values():
        start = table.ref.split(':')[0]
        table.ref = f'{start}:{ws.cell(row=row, column=max(header.values())).coordinate}'
        if table.autoFilter is not None:
            table.autoFilter.ref = table.ref


def as_key(value):
    """A whitespace-insensitive form of a lookup key.

    One of them, `of cards`, contains a real non-breaking space. `TranslatePipe` normalizes those
    away when it builds its lookup, so a row differing from an existing one only in the kind of
    space it contains is the same row, and appending it would ask a translator to translate the
    same string twice.
    """
    exotic = '[\u00A0\u1680\u180e\u2000-\u200a\u200b\u202f\u205f\u3000]'
    return re.sub(r'\s+', ' ', re.sub(exotic, ' ', str(value if value is not None else ''))).strip()


def template_keys(sheet, key_column):
    """The keys the template's `sheet` has, in its order."""
    ws = openpyxl.load_workbook(TEMPLATE, read_only=True)[sheet]
    rows = ws.iter_rows(values_only=True)
    header = [as_key(c) for c in next(rows)]
    column = header.index(key_column)
    return [row[column] for row in rows if as_key(row[column])]


def sync_from_template(ws, sheet, key_column, report):
    """Append the rows of the template's `sheet` that this workbook has not got.

    Birds and Bonuses are synced against the card data, but `Other` and `Parameters` have no
    counterpart there, so the template is their source -- and nothing has ever propagated a row
    from it into an existing language file. Ten of the eleven were missing nine `Other` rows: the
    six promo-pack names, which the site shows as filter labels, and the three strings the rulings
    section needs. No translator had been offered any of them.
    """
    header = header_row(ws)
    if key_column not in header:
        report.append(f'WARNING: no {key_column!r} column')
        return
    key_col = header[key_column]

    have = {as_key(ws.cell(row=r, column=key_col).value) for r in range(2, ws.max_row + 1)}
    missing = [k for k in template_keys(sheet, key_column) if as_key(k) not in have]
    if not missing:
        return

    row = last_row(ws, key_col)
    for key in missing:
        row += 1
        for name, column in header.items():
            cell = ws.cell(row=row, column=column)
            cell._style = copy(ws.cell(row=2, column=column)._style)
            cell.value = key if name == key_column else None

    report.append(f'added {len(missing)} row(s): ' + ', '.join(repr(k) for k in missing))

    for table in ws.tables.values():
        start = table.ref.split(':')[0]
        table.ref = f'{start}:{ws.cell(row=row, column=max(header.values())).coordinate}'
        if table.autoFilter is not None:
            table.autoFilter.ref = table.ref


def restore_parts(original, saved):
    """Copy back the parts openpyxl dropped that carry something, and re-reference them."""
    with zipfile.ZipFile(original) as src, zipfile.ZipFile(saved) as dst:
        keep = [n for n in src.namelist()
                if n.startswith(PRESERVE) and n not in set(dst.namelist())]
        if not keep:
            return
        parts = {n: src.read(n) for n in keep}
        types = src.read('[Content_Types].xml').decode('utf-8')
        root_rels = src.read('_rels/.rels').decode('utf-8')
        new = {n: dst.read(n) for n in dst.namelist()}
        infos = list(dst.infolist())

    # The overrides and the package-level relationships for the restored parts come from
    # the original, so nothing here has to know what a DataMashup is.
    import re
    overrides = ''.join(m for m in re.findall(r'<Override[^>]*/>', types)
                        if any(('/' + n) in m or n in m for n in keep))
    kept_rels = ''.join(m for m in re.findall(r'<Relationship[^>]*/>', root_rels)
                        if any(os.path.basename(n) in m for n in keep))

    new_types = new['[Content_Types].xml'].decode('utf-8')
    for override in re.findall(r'<Override[^>]*/>', overrides):
        if override not in new_types:
            new_types = new_types.replace('</Types>', override + '</Types>')
    new['[Content_Types].xml'] = new_types.encode('utf-8')

    new_rels = new['_rels/.rels'].decode('utf-8')
    existing = set(re.findall(r'Id="(rId\d+)"', new_rels))
    for rel in re.findall(r'<Relationship[^>]*/>', kept_rels):
        rid = re.search(r'Id="(rId\d+)"', rel).group(1)
        if rid in existing:
            rid_new = f'rId{max(int(i[3:]) for i in existing) + 1}'
            rel, existing = rel.replace(f'Id="{rid}"', f'Id="{rid_new}"'), existing | {rid_new}
        new_rels = new_rels.replace('</Relationships>', rel + '</Relationships>')
    new['_rels/.rels'] = new_rels.encode('utf-8')

    with zipfile.ZipFile(saved, 'w', zipfile.ZIP_DEFLATED) as out:
        for info in infos:
            out.writestr(info, new[info.filename])
        for name, data in parts.items():
            out.writestr(name, data)


def resolve_formulas(wb, cached, report):
    """Replace a formula with the value Excel last computed for it.

    openpyxl keeps a formula but discards its cached result, and the pipeline reads results --
    so saving a workbook untouched is enough to lose one. Every language file but two had
    `Show bonus cards match symbols` written as the formula `=FALSE()` (Spanish: `=TRUE()`),
    which is a boolean with extra steps, and es.json would have silently stopped tagging bird
    names with bonus-card icons. The cached value is what Excel displayed, so writing it back
    changes nothing a translator sees and takes the trap out of the file.
    """
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith('='):
                    value = cached[sheet][cell.coordinate].value
                    report.append(f'{sheet}!{cell.coordinate}: formula {cell.value!r} '
                                  f'-> its value {value!r}')
                    cell.value = value


def sync(path, check):
    wb = openpyxl.load_workbook(path)
    report = []

    # Before anything else: a formula does not survive the save, and one of these carries a
    # per-language feature flag.
    resolve_formulas(wb, openpyxl.load_workbook(path, data_only=True), report)

    for sheet, cards, columns in (('Birds', bird_cards(), BIRD_COLUMNS),
                                  ('Bonuses', bonus_cards(), BONUS_COLUMNS)):
        if sheet not in wb.sheetnames:
            report.append(f'WARNING: no {sheet} sheet')
            continue
        before = len(report)
        sync_sheet(wb[sheet], cards, columns, report)
        report[before:before] = [f'{sheet}:'] if len(report) > before else []

    # The template is the source for these two, so there is nothing to sync it against.
    if os.path.abspath(path) != os.path.abspath(TEMPLATE):
        for sheet, key_column in FROM_TEMPLATE.items():
            if sheet not in wb.sheetnames:
                report.append(f'WARNING: no {sheet} sheet')
                continue
            before = len(report)
            sync_from_template(wb[sheet], sheet, key_column, report)
            report[before:before] = [f'{sheet}:'] if len(report) > before else []

    name = os.path.basename(path)
    if not report:
        print(f'{name}: up to date')
        return False

    print(f'{name}:')
    for line in report:
        print(('  ' if line.endswith(':') else '    ') + line)

    if check:
        return True

    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
        wb.save(tmp.name)
    restore_parts(path, tmp.name)
    shutil.move(tmp.name, path)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('files', nargs='*', help='workbooks to sync (default: all of i18n/)')
    parser.add_argument('--check', action='store_true',
                        help='report what would change and exit non-zero if anything would')
    args = parser.parse_args()

    files = args.files or sorted(os.path.join(I18N, f) for f in os.listdir(I18N)
                                 if f.endswith('.xlsx'))
    drift = [sync(f, args.check) for f in files]

    if args.check and any(drift):
        print('\nRun scripts/transform/sync-i18n-sheets.py to apply.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
