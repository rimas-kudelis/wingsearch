# Rulings domain knowledge

Working notes for anyone — human or model — deciding **which birds a Wingspan ruling
applies to**, or **whether a forum comment deserves to become a ruling**.

This file is intended to be fed to the LLM as prompt context. Everything here was
verified against the data on 2026-08-30; claims carry their evidence so they can be
re-checked rather than trusted.

---

## 1. How rulings reach a card today

Two kinds of ruling live in `scripts/rulings/rulings.tsv` (580 rows, **no header**,
tab-separated, 5 positional columns):

The notebook reads it as columns `id, general, specific, text, source`:

| col | name | meaning |
|-----|------|---------|
| 0 | `id` | ruling id |
| 1 | `general` | **title of a general ruling** — e.g. "Once between turns", "Copy", "Rerolling dice", "End of your turn". Blank on named rulings. Useful scope signal when judging applicability. |
| 2 | `specific` | card name — **blank means the ruling is _general_** |
| 3 | `text` | ruling text (LaTeX-ish: `` ``quoted'' ``, `\textbf{}`, `\textit{}`, `---`, `--`) |
| 4 | `source` | URL, or free text like "Card update pack." |

**59 rows are general** (col 2 blank) and **532 are named**. The 59 general rulings are
also emitted verbatim to `src/assets/data/general.json` as `{name, text, source}` keyed by
*position* `0`–`58`, not by ruling id — so you cannot look a general ruling up by id
there. That file is generated but unused at runtime.

Those 59 general rows carry only **55 distinct ids**: `20201003` and `20201116a` appear
twice each and `20210199a` three times. A predicate is keyed by *id*, so it attaches every
row sharing that id — one predicate can deliver two or three separate rulings.
`general_map.py` covers all 55 ids exactly, and the notebook now *asserts* that rather than
printing `Rule X not yet implemented`: a general row with no predicate reaches no card, so
it must fail the build, not scroll past.

**6 ids remain `lambda row: False`**, each annotated with which of three reasons applies —
`scope` (the ruling is about a bonus card, a goal tile or the game as a whole, and the
predicate can only see birds), `glossary` (it defines a word rather than deciding a case),
or `covered` (the card that needs it carries it as a named ruling). The other 7 stubs were
implemented on 2026-08-30; see §3.

- **Named rulings** (col 2 filled) attach to exactly that card → `card.rulings`.
  One ruling id may repeat across many rows to hit many cards (e.g. `02a` appears for
  both Bewick's Wren and Blue Grosbeak).
- **General rulings** (col 2 blank) fan out via a *predicate* in
  `scripts/rulings/general_map.py`, keyed by ruling id → `card.additionalRulings`.

`json-transformer.ipynb` cell 5 runs each predicate over every row of `master`, then
**sorts each card's `additionalRulings` by how many cards the rule matched, ascending**
— most specific rule first.

It used to **delete the ruling `id`** after sorting by it, so shipped `master.json` entries
were `{text, source}` and nothing tied a line on the site back to a row of the TSV. **Fixed
2026-08-30:** every entry in both `rulings` and `additionalRulings` is now
`{id, text, source}`. It costs 62 KB raw / 8 KB gzipped on `master.json` and nothing renders
it yet; what it buys is traceability when a reader reports a ruling as wrong, and a fan-out
snapshot (`src/app/store/rulings.spec.ts`) keyed by id rather than by text prefix — the text
prefixes conflated rewording a ruling with changing which birds carry it, and only the second
is a change to what a player is told. The spec pins a distinct-text count per id alongside the
card count, so an omnibus row splitting under one id still fails loudly.

### Ruling id scheme

Dated ids are **the date of the source comment**, `YYYYMMDD`, with `a`/`b`/`c` suffixes
disambiguating multiple rulings from the same day. Verified: ruling `20200404` cites
`stonemaiergames.com/.../#comment-37710`, and comment 37710's API `date` is
`2020-04-04T09:39:00`. Non-dated ids (`01`, `02a`, `02g`, `03a`) predate the scheme and
come from the rulebook / official FAQ / card update pack.

New rulings should therefore be numbered from their source comment's date.

---

## 2. Trust model

The corpus cites, in order of volume: stonemaiergames 434, facebook 67, boardgamegeek 62,
discord 4, and 8 rows citing a rulebook or the card update pack in prose. The Stonemaier
share grew from 44 to 434 with the automated pipeline; the 67 Facebook rows are the
pre-existing ones, and are the only citations a reader cannot follow without being logged
in to the group.

### The allowlist

Derived by measurement over the 4,586 fetched comments (`fetch_stonemaier.py`), not by
reputation: every author was ranked by how often they reply to *someone else* — the signal
that separates answerers from askers — and the top names were then read. The live list is
`corpus.TRUSTED`.

Measurement gets you candidates, not standing. Every name below is either confirmed
Stonemaier/designer staff or explicitly rejected; where the two disagreed, the confirmation
won (Joe Aubrey looked like a fan from the comments alone, and is not one).

| author | answers | verdict |
|---|---:|---|
| `Jamey Stegmaier` | 1464 | publisher. Trusted. |
| `jameystegmaier` | 5 | **the same person, second account.** Answers real rulings ("It's upside down, so none of the content on the tucked card matters"). Easy to miss — match both. |
| `Joe Aubrey` | 337 | **Stonemaier official** (confirmed by Matej, 2026-08-30 — do not downgrade him to "trusted community member"). His answers carry the same weight as Jamey's. The comment record agrees: never once corrected in 337 answers (Jamey's only two replies are thanks), and the designer backs him explicitly — *"I'll just chime in to back up Joe on this one."* — Elizabeth Hargrave, 2020-04-20. |
| `Elizabeth Hargrave` | 2 | designer. **Exact string only.** A *different* person posts as bare `Elizabeth` and is asking a question about the Pileated Woodpecker, not answering one. |
| `David Studley`, `studleygamer` | 30 | same person, designs the **Automa** (solo mode) and signs as the Automa Team; never corrected. Authoritative, but almost entirely about solo play, which wingsearch does not cover. Kept in a separate `TRUSTED_AUTOMA` set so an Automa answer cannot silently become a card ruling. |
| `Lauren` (50), `Caracara` (22), `Marc Stephens` (16) | — | rejected. High reply counts, but reading the comments they are conversational community members, not answerers. Volume alone is a bad proxy. |

Being on the allowlist is necessary, not sufficient — see §4. An authoritative author can
still be answering a shipping question, speculating about a future expansion, or agreeing
with a wrong premise.

### Not all answers by a trusted author are equally strong

These comments are written in a browser, from memory, at the rate of several a day. The
text often says which it is, and that tells you how far to trust it:

| the source reads like | strength |
|---|---|
| quotes the rulebook or Appendix, or says "as confirmed by the appendix" | strongest. This *is* the rules text. |
| a flat statement of the rule, no hedge | strong |
| "I'm pretty sure that's how I've heard Elizabeth answer it", "I believe", "I'll look up those birds to see what they do" | **improvisation marker.** The author is reasoning from the card text in the moment. Keep looking before publishing. |
| "I'll ask Elizabeth and get back to you" with no later reply | not an answer. Do not publish (`hedged`). |

An improvisation marker is not a reason to reject — it is a reason to search the corpus for
the same author revisiting the question. `20230225` was published from Jamey answering
whether a card drawn with Wilson's Storm Petrel could be tucked with Common Grackle; he
opened with *"I'll look up those birds to see what they do"*, quoted the card text back, and
answered the adjacent question instead. Nine months later, in comment 64737, he quoted the
Appendix — *"These cards should be kept separate… They cannot be spent during this turn."* —
which makes the published answer the reverse of the rule. Joe Aubrey confirmed the Appendix
reading again in 85569. Two later citations of published rules text beat one improvised
reply, and the improvisation marker was visible in the source from the start.

### Newer usually wins, but check whether the conflict is real first

When two official answers on the same card disagree, the later one is normally the one to
keep: the corpus spans 2019 to 2026, cards were errata'd, and the Appendix was written
after much of the early Q&A. Two caveats, both learned the hard way:

- **Rank by source strength before date.** An Appendix citation from 2023 beats an
  improvised reply from 2024. Date is the tiebreaker, not the first test.
- **A contradiction is evidence of a transcription bug before it is evidence of a rules
  change** — see §9. Read both sources before concluding either is superseded. Of the three
  conflicts found so far, one (`20260617`) was our own inversion, one (`20230225`) was a
  genuine self-correction by the author, and one (`20230918`) was the author getting the same
  distinction wrong for the third time.
- **Some questions the author reliably gets wrong.** Before treating a lone comment as
  authoritative, check whether the corpus shows the author being corrected on that exact point
  before — `graph.py --related` is the cheap way to see it. Repeat-versus-copy is the known
  case; see §9.

Removing a superseded ruling is a human step. `curate.py`'s `check()` hard-gates against
any plan that drops a ruling, so a model cannot delete one; deletions go through
`rejections.json`, which is what stops `propose.py` re-proposing the comment forever.

---

## 3. Known failure modes in the current fan-out

`general_map.py` holds 55 predicates. **49 match at least one card**:

- **7 of the 13 `lambda row: False` stubs were implemented on 2026-08-30**, taking the
  fan-out from 18 rulings / 861 attachments to 28 / 941; resolving the pending proposals the
  same day added 8 more general rulings and promoted 1 named ruling to general, reaching
  **37 rulings / 1186 attachments**. `20191202` (a "counts double" card
  in hand does not count) reuses `20210318`'s regex; `20200712` (trading counts as
  spending), `20201003` (you may read the discard pile), `20210101` (giving is not
  spending), `20210199a` (repeat of a copy power) and `20210199b` (a copy retains effects
  until end of turn) key off the corresponding word in the power text; `20200109a` (your
  actions affect only your own mat) matches powers acting on "any bird" or "another bird",
  which is the wording that raises the question and the wording of American Avocet, the
  ruling's own example.
- **6 remain `False` on purpose**, and say so: `02c` (prairie), `20191203c` (violet) and
  `20201009` (honey) are bonus-card keyword rulings that Cartographer and Photographer
  already state on their own pages, and this map cannot reach a bonus card at all;
  `20190122` is a goal tile, and `goals.json` is not read at runtime; `20201116a` is a
  game-end sequencing rule belonging to no bird; `20201211` ("ability" means "power") is a
  glossary entry. The three keyword rulings now also have named rows on the birds that
  carry the keyword — including two prairie birds and two violet birds that had none.
- **9 predicates were added on 2026-08-30**, when the pending `is_ruling` proposals were
  resolved. Eight are new general rulings whose answer the source stated generally but named
  only one or two cards for: `20240713` (what the reroll rules actually *are* — 02g had only
  said "regular reroll rules apply", so this shares 02g's candidate set and, via
  `applicability-overrides.json`, its exclusions), `20260605` (all-players selections go in
  turn order, 69), `20231228` and `20221013` (a `[star]` wingspan is no wingspan; treat it as
  any length, separately per bonus card — 12 each), `20260520b` (end-of-turn powers trigger
  after hummingbird actions, 10), `20221116` (a `[card]` just drawn is already in your hand,
  9), `20260816` (gain only the birdfeeder foods actually present, 4) and `20260814` (a power
  laying 2+ `[egg]` may put them on one bird, 3). The ninth, `20191004` (you choose the order
  of your own teal powers), is a **promotion**: it existed as two named rows on Griffon
  Vulture and Lesser Whitethroat, and the fact is about every teal power, so the rows were
  replaced by one general row reaching all 63.

  Promotion is the preferred move whenever a named ruling's text says nothing specific to
  its card. It is cheaper than copying rows onto siblings and it cannot go stale as new
  birds are added.
- **14 more predicates were added on 2026-08-30**, all promotions, working through
  `graph.py --transferable` — rulings published on one card that state a rule true of every
  card with that power. Fan-out went **37 rulings / 1186 attachments to 51 / 1954**:
  `20200413` (no limit to cards tucked behind a bird, 152), `20210830d` (an `[egg]` a power
  lays needs a nest with room, 139), `20210830b` (a "When Played" power resolves after the
  bird is played, so its cost is paid first, 138 — every white power), `20220326` (activating
  a power is optional, 114 — scoped to teal and pink, the powers that trigger without you
  choosing to spend an action on them), `20220429b` (a power that says "Draw" without naming
  a source may take from the tray or the deck, 57), `20230827` (powers that look at types of
  birds mean birds on a mat, never in hand, 48 — the official answer generalised itself),
  `20190617` / `20220516` / `20200423b` (food substitution, `[nectar]`, and skipping: three
  different questions about the 21 powers that cost a named food), `20210830` and `20200504`
  (where the dice are rolled, and that there can be at most 4 of them, 15 each),
  `20260503` (a "you may cache" power is a genuine choice, 13), `20220429` ("Look at a
  `[card]` from the deck" means the deck, 13), `20210830c` (a tie for "fewest" means everyone
  tied benefits, 3).

  Two mechanics of promotion are worth copying. First, **an omnibus row splits**:
  `20210830` was one comment answering four unrelated questions, published whole on Anhinga
  and Brown Pelican, so three of its four answers sat on cards they say nothing about while
  the cards they do apply to had none of them. It is now four general rows, same source URL
  on each. Second, where a card already states the rule as a named ruling with its own
  source, the card is **excluded in `applicability-overrides.json`** rather than the named row
  being deleted — that keeps the citation and stops the general row printing the same
  sentence underneath it (Red-Tailed Hawk, American White Pelican, Sandhill Crane and the
  four "may cache" birds).

  Five rulings were **copied** instead of promoted, because they really are about one card
  and only their identical-power sibling was missing them: Red Knot, Crested Ibis (two),
  White-Backed Woodpecker and Common Nightingale.

  What `--transferable` listed after that pass was 9 groups / 17 cards, and almost every one
  was a deliberate no-op: the sibling already carried the same rule as a *general* ruling in
  different words, which the tool could not see because it compared named rows only. **That
  blind spot is fixed** — `load_cards()` now keeps each card's `additionalRulings` texts and
  `general_overlap()` annotates every candidate with the general rulings its lacking cards
  already carry, ending with an explicit "open gaps" list. 15 of the 17 cards were covered;
  the tool now says so instead of leaving the reader to check 17 cards by hand.

  The fix annotates rather than suppresses, deliberately. The overlap test is word-level and
  can be wrong in both directions, and `about_the_power()` is already biased towards showing
  too much for the stated reason that a false positive costs one wasted read while a false
  negative is a rule a player never sees. Hiding a candidate on a word-overlap score would
  trade that bias for the opposite one.

  The 5 remaining open gaps became **6 named rows on 2026-08-30**, and what makes each of them
  a gap is worth reading, because it is the shape to look for next time: the *general* rulings
  the lacking card carries answer a neighbouring question, not this one. All four generals on
  the "Discard 1 `[seed]` to tuck 2 `[card]`" birds say the discard is a cost that may not be
  substituted or skipped; none says the `[seed]` may be paid from **Eurasian Nuthatch**'s cache
  (`20201010b` → Black-Bellied Whistling-Duck, Canada Goose). `20260503` tells every "you may
  cache" bird that the *may* is a genuine choice but not that the choice is made once
  (`20200423` → Acorn Woodpecker, Steller's Jay). "Whenever you are entitled to gain resources,
  you may choose to take some but not all" is true of laying `[egg]` but a player counting eggs
  will not read it that way (`20201203` → Lesser Whitethroat). And the end-of-turn general is
  written for the bird that owes the discard, so the bird that *empties the hand* is not
  covered by it (`20210124` → Common Chaffinch).

  Two of those were reworded for the receiving card rather than copied, because the source row
  named its own card — a row that tells the reader of one card about a different card is the
  defect §9 splits out of `20201104`. Per-card wording under one ruling id is already how
  `20231204` sits on Wood Duck and Common Chiffchaff.
- **4 were broken by a casing typo — fixed 2026-08-30.** They tested
  `row['Color'] == 'Pink'`, but Color is stored lowercase (`brown` 409, `white` 138,
  `teal` 63, `pink` 51, `yellow` 40) and the notebook applies no normalisation to
  `master['Color']`. Result: `20190205`, `20190313`, `20200208`, `20200330` attached to
  **0 cards instead of 51** — four load-bearing pink / "once between turns" timing rulings
  reaching nobody since 2019. They now go through `_is_pink()`, which lowercases. This was
  the only *under*-application found; everything else in this section over-applies.

Of the 13 predicates that were live before the 2026-08-30 work, fan-out is heavily skewed
and was **never validated against cards released after early 2021** (Asia, Americas, and
150 promo birds):

| ruling | cards matched | of those, released after the predicate was written |
|--------|--------------:|---------------------------------------------------:|
| `20200404` | **474** | 239 |
| `20190601` | 109 | 55 |
| `20201117` | 83 | 46 |
| `02g` | 66 | 24 |
| `20200716b` | 18 | 6 |
| others (8) | ≤10 each | 0–1 |

**524 of 707 birds carried at least one `additionalRulings` entry, and 249 of those birds
did not exist when the predicates were written.** Roughly half of that fan-out was
unreviewed. It is 644 of 707 birds after the promotions above, at a mean of 2.8 general
rulings each and a maximum of 8.

That table is the *pre-audit* state, kept because it is what the predicates still generate
— the audit narrows the result afterwards. See §8 for what it narrowed to.

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
   (all attached) in `applicability-overrides.json`, which explains how to resolve
   it either way. This is the one question that is blocking nothing but is worth a decision.
3. ~~The 13 `False` stubs~~ — resolved 2026-08-30: 7 implemented, 6 deliberately
   unfannable and annotated with why. What is left of this question is whether the three
   bonus-card keyword rulings should stop being general rows at all, which depends on
   question 4.
4. Should general rulings be able to target hummingbird cards and bonus cards (§4.8)?
5. 44 birds now show **no** rulings at all where they previously showed one (always the
   over-applied `20200404`). Is "no rulings" the right presentation, or should the card
   detail view say something?

---

## 7. Target model: one reviewed "Rulings" list per bird

**Half of this section is now built.** `curate.py` does the per-bird pass described under
"Ordering" below, for the bird-specific `rulings` list. What remains direction rather than
description is the *merge* of the two lists, and ordering within `additionalRulings`. It
states Matej's intent (2026-08-30) alongside what shipped.

Today a bird's card detail shows two lists: `rulings` (researched for that specific bird)
and `additionalRulings` (generic rules fanned out by predicate), the second after the first.
The split exists only because the second list is not trustworthy per-bird — it is a
category of *provenance*, which is an implementation detail leaking into the UI. Players
want to know what is true for the bird in front of them, not which mechanism attached it.

**The target: a single "Rulings" section per bird.** The precondition is that every entry has
been reviewed *for that bird* rather than generically applied. So merging the two lists is
the last step of the per-bird review, not a display change that can be made first — merge
early and generic noise becomes indistinguishable from researched content, which is worse
than the current honest split.

### Ordering: least obvious first

Cell 5 currently sorts `additionalRulings` by how many birds the rule matched, ascending,
using rarity as a proxy for specificity. That proxy is weak. The intent is **least obvious
first**: the ruling a competent player is most likely to get *wrong* about this bird goes
top, and rules that merely restate what the card already implies go last.

This is a per-bird judgement and cannot be computed from fan-out counts. Some signals:

- A ruling that *contradicts* a natural reading of the card text is maximally non-obvious.
- A ruling covering an interaction with another card or a later expansion's mechanic ranks
  above one about the card in isolation.
- A ruling that only says "yes, the obvious reading is correct" ranks last.
- A ruling saying an option is *unavailable* on a card where it never looked available
  ranks last — see `20190601` below.

**`20190601` is settled: keep it, rank it last.** Matej's decision — the rule ("you may only
reroll when gaining food from the birdfeeder, not from the supply") is largely obsolete, but
it should stay attached to all ~104 supply-gaining birds for consistency rather than being
present on 27 and absent on 77 indistinguishable cards. It is the archetype of a
low-priority ruling: technically true, never surprising. The override in
`applicability-overrides.json` keeps it attached; because it is a *general* ruling, the
ordering half is still not implemented — see below.

### What is implemented, and what the remaining blocker actually blocks

For **bird-specific `rulings`**, ordering needs no id at all: the notebook's
`groupby().apply()` preserves within-group row order, so a card's display order simply *is*
its TSV row order. `curate.py` exploits that — it rewrites a card's rows in the order it
wants, and that is what players see. Merging restatements and rewriting for scanning work
the same way. This is live as of 2026-08-30.

For **`additionalRulings`**, the blocker was that cell 5 **deleted the ruling `id`** before
writing `master.json`, so shipped entries were `{text, source}` with no stable handle and
their order came from the fan-out-count proxy. **Removed 2026-08-30** (§1): entries are
`{id, text, source}`, so a per-bird ordering now has something to key to. What is still
missing is the ordering itself — the fan-out-count proxy is unchanged, and a per-card override
would need somewhere to live (a column in the TSV cannot express it, since one general row
serves hundreds of cards) plus a reason to prefer it, since "most specific first" is a decent
approximation. Do that only if a card turns up whose general rulings read badly in that order.

Do not repeat the earlier mistake of reading this as having blocked *all* reordering. It never
did.

---

## 8. The 2026-08-30 applicability audit

`audit.py` judged all 973 candidate (ruling, card) pairs with
`us.anthropic.claude-opus-5` on Bedrock — 51 calls, 23 minutes, $3.58 — writing
`applicability.json`. Verdicts are `applies` / `does_not_apply` × confidence;
**only a high-confidence `does_not_apply` removes anything**, so hedging can never silently
delete content (`general_map.applies`).

Every stage that emits a confidence rating wants it to *report* how certain the judgement is,
not to argue for the judgement. Rating something high because high ratings get acted on
defeats the whole arrangement: the queue exists so that "I am not sure" is a useful, cheap
answer, and a human reads every item in it. Say `low` when it is low.

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

These are the audit's own before/after numbers and are not the current state: the stub
implementations, the resolved proposals and the promotions of the same day took the fan-out
to 52 rulings / 2032 attachments, with 63 birds carrying none (§3).

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
    python3 audit.py --dry-run         # plan and cost only
    python3 audit.py                   # judge anything not yet decided
    python3 audit.py --ruling 20200404 --recheck   # re-judge one ruling

It is incremental: already-decided pairs are skipped, so a new expansion costs only its own
cards. It must never run in the site build — the committed JSON is what the build consumes,
which keeps CI hermetic and free. Hand corrections go in
`applicability-overrides.json`, which the audit never overwrites.

`src/app/store/rulings.spec.ts` pins the resulting per-ruling attachment counts, so a
regenerated `master.json` or an edited predicate fails CI rather than quietly changing what
players read.

---

## 9. The 2026-08-30 Stonemaier ingestion

Phase 2 of Track B: the audit in §8 fixed *over*-application of the rulings we had; this
adds the ones we never had. Coverage before was 98 of 707 birds, nothing at all for Asia,
Americas or any promo pack, and nothing dated after March 2021.

### Pipeline

Three scripts, each doing one thing, and only the middle one costs money:

1. `fetch_stonemaier.py` — pulls every comment from the six Wingspan FAQ pages through
   WordPress's open REST API into `stonemaier-comments.json` (**4,586 comments**,
   2018-12-07 → 2026-08-30, 1,753 threads). Incremental, so re-running costs only what is
   new. Wyrmspan (post 26515) is deliberately excluded: different game, different rules.
2. `corpus.py` — deterministic reading: thread rooting via each comment's
   `parent`, the trusted-author check (§2), card-name matching. Kept free of anything
   billable so it can be inspected and re-measured at will.
3. `propose.py` — the one Bedrock stage. Judges four threads per call against the
   cards named in them *and the rulings those cards already have*, and writes
   `proposals.json`.

`proposals.json` is a **review queue, not an edit**. Nothing reaches the TSV until
a proposal is marked `"review": "accept"` and `--emit-tsv` prints the rows. Same principle
as §8: the model proposes, a reviewed artifact decides, and no LLM ever runs in the build.

### Yield

Of 1,753 threads, 1,489 have a reply from a trusted author. Filtering to those that name a
card and are not already cited in the TSV leaves **452 candidates**, judged for ~$13:

| | |
|---|---:|
| threads judged | 459 |
| became a proposed ruling | 323 |
| already covered by an existing ruling (`duplicates`) | 70 |
| rejected as not a ruling | 102 |
| after clustering restatements | **314 distinct** |
| TSV rows they would produce | 424 |
| cards touched | 233 |
| cards going from *no* ruling to having one | 173 |

Per set, birds with at least one ruling: core 51 → 90, european 38 → 55, oceania 9 → 41,
**asia 0 → 35, americas 0 → 16**, promo 0 → 12, bonus cards 12 → 34. Americas stays thin
because its FAQ page is the newest and yields only 19 candidate threads — that gap is a
sourcing problem, not a pipeline one.

### Four bugs this phase found, all of them in my own code

Worth reading before extending any of this, because each was invisible in the output until
it was measured:

- **`Bird Feeder` is a bonus card *and* the dice tower.** 142 mentions, nearly all the
  component ("roll the dice not in the bird feeder"), dragging 38 threads into the queue on
  a false positive. Now in `corpus.AMBIGUOUS`: such names only count when the
  thread visibly discusses bonus cards.
- **Diacritics broke recall on exactly the sets that needed it most.** Seven cards are
  spelled with macrons — `Tūī`, `Kākāpō`, `Kererū`, `Pūkeko`, `North Island Kōkako`,
  `South Island Takahē`, `Chiloé Wigeon` — and almost nobody types them that way. Matching
  unfolded found `Tūī` 10 times; folded finds 36. All NZ/Oceania.
- **Hyphens are optional in the wild.** 176 card names are hyphenated and people drop them
  ("California Scrub Jay"). Hyphen and space are now equivalent.
- **A thread can hold two unrelated questions.** People reply to a stranger's comment to
  ask something new, so WordPress threading is correct but a thread is not one Q&A. Taking
  "the last official comment" as the source miscited **23 of 115** multi-answer threads.
  The model now reports `source_comment` explicitly and it is validated against the thread.

The general lesson matches §8's: the deterministic half of the pipeline is where the silent
errors live. The model's judgement was good; my regexes were not. Measure recall against
the raw corpus rather than trusting that a name matcher matches names.

### Two things the model cannot do, by construction

- **Cross-thread duplicates.** Four threads per call means it cannot know the same question
  was answered in 2020 and again in 2023. `cluster()` groups near-identical proposals that
  share a card — it found the Galah "is the tuck conditional?" question **asked and answered
  six separate times over five years**. It cannot catch restatements that share no card, so
  the same rule proposed for `Lineated Woodpecker` and for `Great Kiskadee`/`Tropical
  Kingbird` (identical powers) arrives as two proposals.
- **Wingspan Pocket.** Pocket reworks card texts and wingsearch carries no Pocket cards, so
  a Pocket thread's card names resolve to full-game cards with different powers. The prompt
  tells the model to propose from a Pocket thread only where the rule holds in the full
  game, and it does decline correctly — but only 5 of 452 candidates come from that page, so
  this is a small risk either way.

### Inverted transcription: the one failure mode that survives every gate

Found 2026-08-30, in `20260617`, live on two cards. Eric Chow asked *"So the bird power
activation is considered part of the main action. here 'gain food' action?"*; Jamey answered
*"A bird power about gaining food is not part of the main action. The main actions are printed
on the player mat."* That is a **no**. The ruling published from it said Loggerhead Shrike
triggers *"including [rodent] gained from a bird power activated during that action"* — a
**yes**, the opposite of the source.

Why every existing gate missed it:

- `validate()` checks markup, not meaning.
- The text was internally coherent: it stated the correct principle (*bird powers are not main
  actions*) and then drew the wrong conclusion from it, so nothing read as broken.
- `curate.py` inherited it and reasoned *about* it, describing the newest ruling as "reversing
  the earlier answers" and flagging a conflict. **The conflict existed nowhere in the source
  corpus** — all four other answers on the card agree, including `20260708`, which is newer
  still. The pipeline manufactured a disagreement and then asked a human to adjudicate it.

The mechanism is specific and worth naming: **the polarity of a terse answer often lives in
the question, and the question is not quoted in the ruling.** "Nope!", "That's correct!", "It's
not part of the main action" mean nothing on their own. Get the question's direction wrong once
and the published text inverts with no surviving evidence of the error.

So when a ruling is derived from a short answer, restate the question in your reasoning before
writing the ruling, and check that the ruling answers *that* question. A negation in the answer
is usually a caveat, not a reversal — of 22 rows flagged by a polarity heuristic across the
whole corpus, 21 were correct transcriptions where the negation sat in a subordinate clause.
Only reading the pair settles it.

**A contradiction between two official answers is evidence of a transcription bug before it is
evidence of a rules change.** Check both against their sources before believing either.
Rejected rulings and the reasons are recorded permanently in `rejections.json`, which also
blocks the comment from being re-proposed.

### The terse-source review: 30 items, 3 defects, and what they were

`verify.py` flags an item `terse source` when the licensing quote is too short to carry the
ruling's direction — "Nope!", "It does!", "(a) is correct :)". That is the `20260617` class,
so the queue was worked through card by card: for each item, walk `parent` up the comment
thread to recover the question the answer was replying to, then check the published ruling
answers *that* question in *that* direction. All 30 are recorded in `reviewed.json` with the
recovered question quoted, so an approval can be re-checked without re-walking the thread.

**Not one was inverted.** 27 were faithful and are approved as they stood. The three defects
were all the same shape — the ruling answered *more* than its question:

- `20190416`@Osprey. "(a) is correct" answers a two-option question, and (a) is only the
  first half of what the row claimed. Its second sentence (other players may still decline
  their `[fish]`) is true, but it comes from `20221121`, a different comment on a different
  card. Trimmed; the fact now arrives as a general ruling.
- `20240219`@Silvereye. "It can indeed!" to *"can the colour be part of a name, ie.
  silvereye?"* was published as *"the color may be part of a larger word"* — which
  contradicts `20190724` (**Barred Owl** does not count) and `20230529` (**Baya Weaver**
  does not count). The rule Jamey actually stated is *compound words*, in comment 60794.
  Rewritten to that, with the contrast named and 60794 in `extra-citations.json`.
- `20251210`@Blackpoll Warbler and `20260212`@Great Crested Grebe, found by the same full
  re-verification pass. Both dropped a hedge the source made explicit — *"as long as you're
  consistent with your group, it's fine"* and *"at least for now"* — while the bonus-card row
  for the same ruling kept it. Restored.

Two generalisable findings:

- **A terse answer is a weak signal about polarity and a strong signal about scope.** The
  danger is not that the answer means the opposite; it is that a one-word yes gets published
  as an answer to a wider question than the one asked. Check the *breadth* of the question
  as carefully as its direction.
- **When the same ruling id sits on a bird and on a bonus card, diff the two rows.** Both
  hedge-dropping defects were visible that way with no source lookup at all: the general or
  bonus-card row carried a caveat its sibling had lost.

### The medium/qualified review: 38 items, 4 defects, and the omnibus-on-the-wrong-card shape

The last two queues `verify.py` keeps — `medium` confidence and `official answer was
qualified` — are both about **scope**, not polarity. A medium verdict almost always means the
rule was transferred to a card the thread never named; a qualified verdict means the answer
carried a caveat that may not have survived. Neither is a lie detector, so neither can be
cleared by re-reading the cited comment: the check is the whole thread plus the sibling rows
carrying the same id.

All 38 are approved in `reviewed.json`, each reason naming which comment licenses which
clause and, for a transfer, why the unnamed card is covered. Four needed the ruling changed:

- `20201104` and `20260208` were **omnibus rows landing on the wrong cards**. Each is one
  numbered reply answering two unrelated questions, published whole on every card the *first*
  half touches — so **Wild Turkey** and **American Woodcock** were being told about **Common
  Blackbird**'s sideways placement, and neither Kiskadee card's row separated the habitat rule
  from the pink-power rule that also covers **Lineated Woodpecker**. Split, as `20210830` and
  `20221121b` were. This is the omnibus failure mode's *second* form: the earlier cases wasted
  space on cards the ruling did not concern, but here the wasted half is card-specific, so it
  reads as a claim about the card it is printed on.
- `20260128`@Ivory Gull said *"never* to play a bird" for *"I would say no. It's close, but
  it's not meant to replace the cost of playing a bird."* One word, dropped.
- `20190311`@American Oystercatcher asserted the third card is discarded where the source only
  said the Automa gets nothing. Reworded so the discard arrives as the consequence it is.

Two generalisable findings:

- **A verbal hedge is not a stated qualification.** *"I would say yes"* is politeness; *"at
  least for now"* and *"as long as you're consistent with your group"* are a limit and a
  permission, and a player needs both. Publishing the first flat is fine; publishing the
  second flat is the defect the terse-source pass found twice. `20260324` and `20260731` are
  approved on that reading, `20251210` and `20260212` were rewritten on it.
- **A dropped clause is only a defect if no sibling row carries it.** `20240903`@Forster's
  Tern publishes only the contrast half of its answer, which looks like a loss until you see
  that the main half is on the same card as `20210124` with its own source. Read the card's
  other rows before restoring anything — the alternative is two rows saying one thing.

### Repeat versus copy: a question the author gets wrong about half the time

Found 2026-08-30, in `20230918`, live on two cards. Comment 63050 (Jamey, 2023) said that a
\[seed] from a repeated **Eurasian Nuthatch** *"just becomes a cached food"* on the repeating
bird — i.e. the repeating bird performs the power and keeps the result. That is the wrong side
of the distinction, and the corpus says so twice: Joe Aubrey in 36250 (2020) — *"The
Mockingbird does not take on the powers of the other bird and so in this instance would not
gain a tucked card"* — and Jamey himself in 150843 (2026) — *"The catbird causes the other bird
to trigger again."* Both rows were deleted and the two correct answers published on Gray
Catbird and Northern Mockingbird.

What makes this different from `20260617` is that nothing was transcribed wrongly. The source
says what the ruling said; the source is simply mistaken. The tell is the author's own record
on the point:

| comment | date | said | then |
|---|---|---|---|
| 35726 | 2019-11-29 | *"repeats the power as if it's printed on the repeating bird"* | corrected in an `EDIT:` on the same comment |
| 63050 | 2023-09-18 | the repeating bird keeps the cached food | never revisited; this is the row we removed |
| 150562 | 2026-03-16 | *"it's linked to the Catbird, not the original bird"* | corrected three days later in 150843 |

Three errors, two self-corrections, one wrong answer left standing — so **a lone comment on
repeat-versus-copy is weak evidence regardless of its date**, and the newer-wins rule does not
settle it. Prefer the answers that survived a correction (35726's edit, 150843) and Joe
Aubrey's, whose record on the distinction is clean.

The generalisable part: **check the author's track record on the specific distinction before
trusting a single comment on it.** Where the corpus shows repeated self-correction on one point,
treat every uncorrected answer on that point as unverified. `graph.py --related` surfaces this
for free; judging the comment alone does not.

### A hedge attached to a condition is not a hedge you can drop

`"Yes, unless X"` is not a yes. `20201206` published Jamey's *"based on the information you
provided, yes, it counts"* as a flat conclusion and dropped what followed it: *"However, if
the ability on the Spangled Drongo looks for other players to gain nectar while taking the
'gain food' action, it would not count."* Dropping the `unless` publishes a stronger claim
than the author made.

The condition is usually answerable, and the corpus usually answers it — here comment 109108,
four years later, established that the Drongo triggers on a nectar gain by any means. So the
move is not to delete and not to publish flat, but to **resolve X against the corpus and carry
the resolution into the ruling text**, recording the second comment in
`extra-citations.json` so the verifier can see what licenses the clause.

### The review loop, and why the queue has to be able to shrink

`verify.py` re-surfaces every medium-confidence and flagged item on every run. Without a way
to record that something was looked at, the same items get re-read forever and the queue
stops carrying information. Three files, each with a distinct meaning:

| file | meaning | effect |
|---|---|---|
| `rejections.json` | do not publish | blocks the comment from being re-proposed, forever |
| `reviewed.json` | a human read it; the verdict stands but needs no action | settles the item |
| `extra-citations.json` | this comment licenses part of the text but is not the `source` | widens what counts as supported |

A `reviewed.json` approval is scoped to the signature of the ruling text and its sources at
review time. Rewrite the ruling and the approval lapses. Without that scoping the file is a
permanent silencer, which is the only real risk it carries.

Do not loosen a gate to make an item green. The Red-Winged Parrot entry in `reviewed.json`
is the worked example: the model's objection was correct about the comment it was shown and
moot given a second comment, so the right output is an approval that explains why — not a
weaker gate, which would cost the next inversion.

**When judging a queued item, read `graph.py --related <ruling_id>` first.** Judging a ruling
alone is what let `20260617` through; the same rule stated six other times is what exposes it.

Where the queue stands: **the source-verifiable queue is empty.** 402 of 591 rows are
verifiable against a held comment, all 402 are judged, 401 are `faithful` and the one
`overstated` (Red-Winged Parrot) is approved with reasons. Nothing is pending. The other 189
rows cannot be checked this way at all: 130 cite no Stonemaier comment (Facebook, BGG,
rulebooks) and 59 are general rulings, which have no per-card source to check against and are
reviewable only for internal consistency. Those two sets are where the next unverified defect
will be, and neither has a mechanical check — the 130 need their sources held (the Facebook
captures and the BGG threads), and the 59 need `graph.py --related` read against each other.

### Re-running

    export AWS_PROFILE=...
    python3 fetch_stonemaier.py                 # refresh the comment corpus
    python3 propose.py --dry-run        # what would be judged
    python3 propose.py --limit 12       # validate on a few and read them
    python3 propose.py                  # judge the rest (~$0.09/call, 4 threads)
    python3 propose.py --emit-tsv       # rows for accepted proposals

Read the output before scaling: the first 12-thread run had every ruling scoped `general`
and inconsistent markup, both fixed by sharpening the prompt rather than by post-processing.
`validate()` catches markup that would reach a player literally — an icon marker the app
does not ship renders as the text `[food]`.
