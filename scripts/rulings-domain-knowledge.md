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
- **4 were broken by a casing typo — fixed 2026-08-30.** They tested
  `row['Color'] == 'Pink'`, but Color is stored lowercase (`brown` 409, `white` 138,
  `teal` 63, `pink` 51, `yellow` 40) and the notebook applies no normalisation to
  `master['Color']`. Result: `20190205`, `20190313`, `20200208`, `20200330` attached to
  **0 cards instead of 51** — four load-bearing pink / "once between turns" timing rulings
  reaching nobody since 2019. They now go through `_is_pink()`, which lowercases. This was
  the only *under*-application found; everything else in this section over-applies.

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

That table is the *pre-audit* state, kept because it is what the predicates still generate
— the audit narrows the result afterwards. See §7 for what it narrowed to.

### Worked example: `20200404`, the 474-card fan-out

`20200404` — *"Whenever you are entitled to gain resources, you may choose to take some
but not all of the quantity specified."* Predicate:
`re.search(r"(\s|^)draw|(\s|^)lay|(\s|^)gain", row['Power text'])`.

**Read the source thread (comments 37699 → 37710) before judging this one.** It is the
single most load-bearing document in the corpus, and it is broader than the ruling text
suggests. Travis W. asked one question with *three* worked examples, deliberately spanning
all three resource kinds:

- **eggs** — Red-Legged Partridge, *"Lay 1 [egg] on each bird in this column"*: may I lay
  on some birds but not others?
- **food** — Northern Flicker, *"Gain all [invertebrate] in the birdfeeder"*: may I leave
  some?
- **cards** — Audouin's Gull, *"Draw 2 [card]"* — noting this case is *"largely academic,
  as there is rarely (if ever?) a reason to draw fewer than the maximum"*.

Joe Aubrey answered all three at once: *"As a general premise in Wingspan, you can take
less of an action beneficial to yourself… And the others apply in the same way. This
premise applies as long as there is not a conditional statement in the bird power."*

So this ruling is **not** food-scoped. An earlier version of this document claimed it was,
and that claim was wrong — it was fed to the audit model as reference and produced a
confidently wrong exclusion. Do not reintroduce it. Eggs, food and cards are all in scope
by name.

**Where the error actually is.** The rule is broad *by design*, so the honest problem with
474 matches is not that the ruling is false for those cards — it is that it is
**uninformative** for most of them. Two things genuinely narrow it:

1. **The conditional carve-out** Joe states explicitly and the rule text drops. For
   *"Do X. Then if you do, do Y"* powers the ruling's answer changes, so those cards need
   it more than the average card, not less.
2. **Nothing to partially take.** A power granting exactly one indivisible unit
   (*"gain 1 [seed]"*, *"lay 1 [egg] on this bird"*) has no "some but not all" to choose.
   Whether you may decline it entirely is the separate "may creates a choice" principle
   (§5), not this ruling.

Amazonian Parrotlet (*"Draw 2 [card] from the deck. You may tuck either or both of them
behind this bird."*) is still a fair exclusion — but only on redundancy: the card already
prints the choice. Not because cards are out of scope.

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
3. **Distinguish resource kinds — but check the source first.** food ≠ eggs ≠ cards ≠
   nectar, and a ruling about gaining food does not *automatically* govern drawing cards.
   But do not infer scope from the one example you happen to see quoted: `20200404` reads
   food-only in the ruling text and is explicitly all-three in its source thread. Narrow a
   ruling by resource kind only when the source actually supports narrowing it.
4. **Card colour encodes timing** and several rulings are colour-scoped:
   `brown` = WHEN ACTIVATED, `white` = WHEN PLAYED, `pink` = ONCE BETWEEN TURNS,
   `teal` = ROUND END (Oceania), `yellow` = predator/other. Compare colour case-insensitively.
5. **Beware mechanics that postdate the ruling.** Nectar (Oceania, 2020) and the Asia /
   Americas mechanics arrived after most rulings were written. A 2019 ruling about food
   may never have contemplated nectar's spend-or-lose behaviour. Prefer "uncertain" to
   extrapolating.
6. **Redundancy is a reason to exclude.** If the card text already states the ruling's
   content explicitly, attaching it adds noise.
7. **Judge the game, not the pipeline.** Facts about how this repo generates data are
   background for *humans*; they are never a reason a ruling does or does not apply to a
   card. (Observed failure: a card was excluded "because hummingbird cards never receive
   general rulings via the pipeline" — a true statement about §1 that says nothing about
   the rules of Wingspan. Note also that birds named "…Hummingbird" in `master.json` are
   ordinary bird cards; the 40 *hummingbird cards* are a separate deck in
   `hummingbirds.json`.) Decide from the card text, the ruling, and the source discussion.
8. **General rulings never reach hummingbird cards or bonus cards.** Cell 5's loop iterates
   `master` only, though `general_dict` is initialised with hummingbird and bonus names
   too. Confirmed: 0 of 40 hummingbird cards carry any ruling. If a general rule *should*
   cover them, the pipeline currently cannot express it.
9. **`Common name` is a safe join key** — all 707 master names are unique, with no
   collisions against the 40 hummingbirds. Card `id` is *not* safe across regenerations:
   ids come from sorted row position, so inserting a bird renumbers later ones.

## 5. Established rulings principles worth reusing

- *"'May' creates a choice."* — Jamey Stegmaier, comment 168922 (2026-08-18).
- *"As a general premise in Wingspan, you can take less of an action beneficial to
  yourself."* — Joe Aubrey, comment 37710 (2020-04-04). Scoped to actions benefiting
  *yourself*: it does not license taking less of an effect that helps opponents (e.g.
  "each player draws 1 card").
- *"This premise applies as long as there is not a conditional statement in the bird
  power… You can't do action2 without first having done action1 (but you can do action1
  without doing action2 if you wish)."* — same comment. The one crisp structural test in
  the corpus: partial-taking is free, but a *"Then if you do…"* chain still requires its
  antecedent.

## 6. Open questions for Matej

1. Confirm the author allowlist (§2) — anyone to add or remove?
2. **`20190601`: should a ruling that says "you may *not* reroll here" be attached to the
   104 birds where rerolling cannot arise at all?** The audit could not answer this and
   should not have tried — it is an editorial preference, not a fact, and the model split
   27/77 across indistinguishable cards when asked. Currently overridden back to status quo
   (all attached) in `rulings-applicability-overrides.json`, which explains how to resolve
   it either way. This is the one question that is blocking nothing but is worth a decision.
3. The 13 `False` stubs: implement, or are some deliberately unfannable?
4. Should general rulings be able to target hummingbird cards and bonus cards (§4.8)?
5. 44 birds now show **no** rulings at all where they previously showed one (always the
   over-applied `20200404`). Is "no rulings" the right presentation, or should the card
   detail view say something?

---

## 7. The 2026-08-30 applicability audit

`audit_rulings.py` judged all 973 candidate (ruling, card) pairs with
`us.anthropic.claude-opus-5` on Bedrock — 51 calls, 23 minutes, $3.58 — writing
`rulings-applicability.json`. Verdicts are `applies` / `does_not_apply` × confidence;
**only a high-confidence `does_not_apply` removes anything**, so hedging can never silently
delete content (`general_rulings_map.applies`).

Net effect on `master.json`: 798 attachments, from 794. Only the `additionalRulings` field
changed — card ids and all five other generated JSON files stayed byte-identical, so
translations, artwork and `/card/:id` links are unaffected.

| | |
|---|---|
| removed | 159 × `20200404`, 38 × `20201117`, 3 × `02g` |
| added | 4 pink timing rulings × 51 birds (the casing fix, §3) |
| birds with more rulings | 51 |
| birds with fewer | 147 |
| birds with none | 183 → 227 |

The two clean wins were both *resource-kind* errors — the regex could not tell what was
being drawn or discarded:

- `20201117` (*"discarding food counts as spending"*) matched cards discarding **eggs, bird
  cards and bonus cards**. All 38 removals are "discards a non-food thing".
- `20200404` matched the bare words draw/lay/gain. Removals are cards granting a single
  indivisible unit ("gain 1 [seed]", "lay 1 [egg] on this bird" — nothing to take "some but
  not all" of) or cards already printing the choice.

### Calibration is a real risk, and it was mis-set on the first run

The first attempt returned 19 exclusions but only **1** at high confidence: 23 of 25 cards
landed in the review queue, so auto-applying would have changed almost nothing. Two causes,
both mine:

1. **The prompt made "medium" the safe default** ("prefer low or medium over guessing" plus
   "only use high when you would defend it to the designer"). Confidence guidance now
   describes what each level *means* and says outright that blanket hedging has a cost.
2. **This document contained a factual error** — it claimed `20200404` was food-scoped —
   and it is fed to the model as reference. The model could read the source thread, found
   it contradicted its own notes, and hedged. It also produced one confidently wrong
   exclusion reasoned from the false premise.

After fixing both, the same 25 cards gave 13 decided / 12 queued instead of 2 / 23, with
every exclusion resting on one checkable criterion. **The lesson: errors in this file are
not documentation bugs, they are prompt bugs, and they show up as bad verdicts.** Re-derive
before you trust.

Adding the conditional carve-out (§5) also flipped three cards *to* `applies` — "Do X, then
if you do, Y" powers need this ruling more than average, not less. That content would have
been lost.

### Re-running

    export AWS_PROFILE=...                     # needs bedrock:InvokeModel
    python3 audit_rulings.py --dry-run         # plan and cost only
    python3 audit_rulings.py                   # judge anything not yet decided
    python3 audit_rulings.py --ruling 20200404 --recheck   # re-judge one ruling

It is incremental: already-decided pairs are skipped, so a new expansion costs only its own
cards. It must never run in the site build — the committed JSON is what the build consumes,
which keeps CI hermetic and free. Hand corrections go in
`rulings-applicability-overrides.json`, which the audit never overwrites.

`src/app/store/rulings.spec.ts` pins the resulting per-ruling attachment counts, so a
regenerated `master.json` or an edited predicate fails CI rather than quietly changing what
players read.
