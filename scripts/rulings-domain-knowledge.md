# Rulings domain knowledge

Working notes for anyone — human or model — deciding **which birds a Wingspan ruling
applies to**, or **whether a forum comment deserves to become a ruling**.

This file is intended to be fed to the LLM as prompt context. Everything here was
verified against the data on 2026-08-30; claims carry their evidence so they can be
re-checked rather than trusted.

---

## 1. How rulings reach a card today

Two kinds of ruling live in `scripts/Wingspan - Rulings.tsv` (186 rows, **no header**,
tab-separated, 5 positional columns):

The notebook reads it as columns `id, general, specific, text, source`:

| col | name | meaning |
|-----|------|---------|
| 0 | `id` | ruling id |
| 1 | `general` | **title of a general ruling** — e.g. "Once between turns", "Copy", "Rerolling dice", "End of your turn". Blank on named rulings. Useful scope signal when judging applicability. |
| 2 | `specific` | card name — **blank means the ruling is _general_** |
| 3 | `text` | ruling text (LaTeX-ish: `` ``quoted'' ``, `\textbf{}`, `\textit{}`) |
| 4 | `source` | URL, or free text like "Card update pack." |

**34 rows are general** (col 2 blank) and **152 are named**. The 34 general rulings are
also emitted verbatim to `src/assets/data/general.json` as `{name, text, source}` keyed by
*position* `0`–`33`, not by ruling id — so you cannot look a general ruling up by id
there. That file is generated but unused at runtime. `general_rulings_map.py` supplies
predicates for only 30 of the 34; the notebook prints `Rule X not yet implemented` for
the rest.

- **Named rulings** (col 2 filled) attach to exactly that card → `card.rulings`.
  One ruling id may repeat across many rows to hit many cards (e.g. `02a` appears for
  both Bewick's Wren and Blue Grosbeak).
- **General rulings** (col 2 blank) fan out via a *predicate* in
  `scripts/general_rulings_map.py`, keyed by ruling id → `card.additionalRulings`.

`json-transformer.ipynb` cell 5 runs each predicate over every row of `master`, then
**sorts each card's `additionalRulings` by how many cards the rule matched, ascending**
— most specific rule first — and **deletes the ruling `id` from the output**. So shipped
`master.json` entries are `{text, source}` only, with no id. That lost id is why
provenance can't currently be traced from the site back to a ruling.

### Ruling id scheme

Dated ids are **the date of the source comment**, `YYYYMMDD`, with `a`/`b`/`c` suffixes
disambiguating multiple rulings from the same day. Verified: ruling `20200404` cites
`stonemaiergames.com/.../#comment-37710`, and comment 37710's API `date` is
`2020-04-04T09:39:00`. Non-dated ids (`01`, `02a`, `02g`, `03a`) predate the scheme and
come from the rulebook / official FAQ / card update pack.

New rulings should therefore be numbered from their source comment's date.

---

## 2. Trust model

The existing corpus cites, in order of volume: facebook 66, boardgamegeek 63,
stonemaiergames 44, discord 4.

Authors treated as authoritative (**needs Matej's confirmation before being used as an
allowlist**):

- **Jamey Stegmaier** — publisher (Stonemaier Games). Answers most FAQ comments.
- **Elizabeth Hargrave** — designer.
- **Joe Aubrey** — community answerer; authored comment 37710, which Matej cited as the
  source for ruling `20200404`. Proof that the allowlist is *not* just official staff.

Being on the allowlist is necessary, not sufficient — see §4.

---

## 3. Known failure modes in the current fan-out

`general_rulings_map.py` holds 30 predicates. Only **13 actually match any card**:

- **13 are literal `lambda row: False`** — parked, never implemented. One is annotated
  `# TODO think about implementation for this one`. The rulings exist in the TSV and
  reach nobody.
- **4 are broken by a casing typo.** They test `row['Color'] == 'Pink'`, but Color is
  stored lowercase (`brown` 409, `white` 138, `teal` 63, `pink` 51, `yellow` 40) and the
  notebook applies no normalisation to `master['Color']`. Result: `20190205`, `20190313`,
  `20200208`, `20200330` attach to **0 cards instead of 51**. These are load-bearing
  timing rulings about pink / "once between turns" powers.

Of the 13 live predicates, fan-out is heavily skewed and was **never validated against
cards released after early 2021** (Asia, Americas, and 150 promo birds):

| ruling | cards matched | of those, released after the predicate was written |
|--------|--------------:|---------------------------------------------------:|
| `20200404` | **474** | 239 |
| `20190601` | 109 | 55 |
| `20201117` | 83 | 46 |
| `02g` | 66 | 24 |
| `20200716b` | 18 | 6 |
| others (8) | ≤10 each | 0–1 |

**524 of 707 birds carry at least one `additionalRulings` entry, and 249 of those birds
did not exist when the predicates were written.** Roughly half the fan-out is unreviewed.

### Worked example of a false positive

`20200404` — *"Whenever you are entitled to gain resources, you may choose to take some
but not all of the quantity specified."* Predicate:
`re.search(r"(\s|^)draw|(\s|^)lay|(\s|^)gain", row['Power text'])`.

It therefore tags **Amazonian Parrotlet** (Americas), whose power is *"Draw 2 [card] from
the deck. You may tuck either or both of them behind this bird."* The match is the bare
word "Draw". But the source comment (37710, Joe Aubrey) was specifically about **food
from the birdfeeder** — *"you can take fewer than 'all' invertebrates from the feeder
with the Northern Flicker"*. Cards are not the resource the ruling is about, and the card
text already says "either or both", so the ruling is redundant at best, misleading at
worst.

**The generalisation is where the error entered.** Matej's rule text is a fair
generalisation of Joe's answer, but the regex chosen to fan it out (`draw|lay|gain`) is
far broader than the rule itself.

### A case that needs a human ruling, not a guess

`20190601` — *"You may only reroll dice when gaining food from the birdfeeder and not
when gaining food from the supply."* Predicate requires Power text to contain both "gain"
and "supply" (and neither "steal" nor "give"). That selects birds gaining from the
**supply**, i.e. precisely where the ruling says reroll does *not* apply. This may be
deliberate (warning the reader) or inverted. **Do not silently "fix" it — ask.**

---

## 4. Rules for judging applicability

1. **A regex match is a candidate, never a decision.** Word-level matching ignores who
   acts, whether the phrase is a cost or a benefit, timing, and negation.
2. **Read the source comment, not just the ruling text.** The ruling is a generalisation;
   the comment states the actual question answered. When they disagree in scope, the
   comment bounds the ruling.
3. **Distinguish resource kinds.** food ≠ eggs ≠ cards ≠ nectar. A ruling about "gaining
   food" does not automatically govern drawing cards or laying eggs.
4. **Card colour encodes timing** and several rulings are colour-scoped:
   `brown` = WHEN ACTIVATED, `white` = WHEN PLAYED, `pink` = ONCE BETWEEN TURNS,
   `teal` = ROUND END (Oceania), `yellow` = predator/other. Compare colour case-insensitively.
5. **Beware mechanics that postdate the ruling.** Nectar (Oceania, 2020) and the Asia /
   Americas mechanics arrived after most rulings were written. A 2019 ruling about food
   may never have contemplated nectar's spend-or-lose behaviour. Prefer "uncertain" to
   extrapolating.
6. **Redundancy is a reason to exclude.** If the card text already states the ruling's
   content explicitly, attaching it adds noise.
7. **General rulings never reach hummingbirds or bonus cards.** Cell 5's loop iterates
   `master` only, though `general_dict` is initialised with hummingbird and bonus names
   too. Confirmed: 0 of 40 hummingbirds carry any ruling. If a general rule *should*
   cover hummingbirds, the pipeline currently cannot express it.
8. **`Common name` is a safe join key** — all 707 master names are unique, with no
   collisions against the 40 hummingbirds. Card `id` is *not* safe across regenerations:
   ids come from sorted row position, so inserting a bird renumbers later ones.

## 5. Established rulings principles worth reusing

- *"'May' creates a choice."* — Jamey Stegmaier, comment 168922 (2026-08-18).
- *"As a general premise in Wingspan, you can take less of an action beneficial to
  yourself."* — Joe Aubrey, comment 37710 (2020-04-04). Note this is scoped to actions
  benefiting yourself, which is narrower than "any quantity specified".

## 6. Open questions for Matej

1. Confirm the author allowlist (§2) — anyone to add or remove?
2. `20190601`: is tagging supply-gaining birds intentional?
3. The 13 `False` stubs: implement, or are some deliberately unfannable?
4. Should general rulings be able to target hummingbirds and bonus cards (§4.7)?
