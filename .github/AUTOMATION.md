# Running Claude against this repository from CI

A spike, not an installation. Nothing in this document is switched on: there is no
`claude.yml` in [workflows/](workflows/), and there cannot be until the AWS question in
§2 is answered. Everything here is copy-paste ready once it is.

The question it answers: *can Claude be plugged into GitHub to maintain this repo, and can
it run on Bedrock?* Yes to both, with one blocker and three hazards that are specific to
this repository being public.

## 1. "Listening to commits" is the wrong shape

`anthropics/claude-code-action@v1` runs in one of two modes, decided by whether the step
has a `prompt` input:

- **Interactive** — no `prompt`. Claude waits for `@claude` in an issue body, an issue
  comment, a PR comment or a PR review, then answers there.
- **Automation** — a `prompt`. Claude runs unprompted on any GitHub event, `schedule`
  included, and writes to the run log unless the prompt tells it to comment.

A `push` trigger in automation mode is what "listening to commits" literally asks for, and
it is the one shape not worth having: every commit spends tokens re-reading a repo that a
human just changed deliberately, and there is nothing to reply to. The three useful
triggers are:

| Trigger | Mode | What it buys |
|---|---|---|
| `issue_comment`, `issues` | interactive | `@claude` on the open issues. The backlog is the actual work queue here — see the triage notes in [CLAUDE.md](../CLAUDE.md) |
| `pull_request` | automation, `/code-review` skill | review on translation PRs, which is where drive-by contributions land |
| `schedule` | automation | the rulings refresh, §5 — the one genuinely autonomous job |

Two limits on `schedule` worth knowing before designing around it: GitHub runs scheduled
workflows only from the default branch, and **in a public repository it disables the
schedule after 60 days with no repository activity**.

## 2. The blocker: which AWS account

Bedrock is a one-input change to the action (`use_bedrock: "true"`) plus an OIDC step, and
it stores no long-lived credential in the repo. What it does require is an IAM role in some
AWS account whose trust policy names `repo:navarog/wingsearch:*`, granting
`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`,
`bedrock:ListInferenceProfiles` and `bedrock:GetInferenceProfile`.

The profile the `scripts/rulings/` tooling uses locally is `rufus-science-uk` — an employer
account. Wiring it up here would mean adding an OIDC identity provider in that account that
trusts a personal public GitHub repository, and billing this project's inference to it.
That is a decision for whoever owns the account, not a config detail, and it is the reason
this spike stops at a document.

The two ways forward:

- **A personal AWS account.** Request Claude model access, create the OIDC provider and the
  scoped role there. Clean separation, one bill that is yours, and the local scripts keep
  using whichever profile you like — nothing in `scripts/rulings/` names a profile. They all
  call `boto3.client('bedrock-runtime', region_name=REGION)`, i.e. the default credential
  chain, so the OIDC credentials a runner exports work with no code change.
- **An Anthropic API key instead of Bedrock.** Skips AWS entirely: one
  `ANTHROPIC_API_KEY` secret, no OIDC, no identity provider. Cheaper to set up and easier to
  revoke; loses the single-bill-with-Bedrock property that made Bedrock attractive for the
  local scripts.

Bedrock is the better fit *only* if the account question resolves. If it does not, take the
API key — none of §3–§5 changes, just the auth lines.

## 3. Three hazards, because the repository is public

None of these are hypothetical; all three are called out in the action's own docs.

**Anyone can start the run, and the credentials are minted before the check.** The action
verifies that the triggering user has write access — but it is a step, and the OIDC sign-in
and App-token steps run before it. So any passer-by commenting `@claude` assumes your AWS
role and mints a GitHub App token before being rejected, leaving audit-log entries and
burning minutes. The docs' advice is to gate on write access *before* the credential steps.
For a single-owner repo the exact gate is free and needs no token:

```yaml
if: github.event.comment.author_association == 'OWNER'
```

Widen that to `contains(fromJSON('["OWNER","COLLABORATOR"]'), ...)` only when there is
actually a collaborator.

**Belt and braces: put the role behind an environment.** A job naming an `environment`
"must follow any protection rules for the environment before running or accessing the
environment's secrets", and environment secrets "are only available to workflow jobs that
use the environment". So storing `AWS_ROLE_TO_ASSUME` as an environment secret on a
protected environment with yourself as required reviewer means a run cannot reach AWS at all
until you click approve — the same mechanism, and the same habit, as the `github-pages`
gate that already holds every deploy in [ci.yml](workflows/ci.yml). Use it for the
scheduled job at minimum.

**Issue text is attacker-controlled input to the prompt.** External contributors can hide
instructions in HTML comments, invisible characters and hidden attributes; the action
sanitizes some of it and does not claim to catch everything. Two consequences: keep
`--allowedTools` as narrow as the job needs, and never turn on `show_full_output`, whose
log is world-readable here.

A fourth, benign one: GitHub withholds secrets from fork-PR runs, so a review workflow
covers same-repo branches only. Translation PRs from forks — which is most of them — get
reviewed when you push the branch or comment on it, not automatically.

## 4. The interactive workflow

`.github/workflows/claude.yml`, using a custom GitHub App (Contents, Issues, Pull requests,
all read/write) so that Claude's pushes still trigger [ci.yml](workflows/ci.yml) — commits
made with the default `GITHUB_TOKEN` do not.

```yaml
name: Claude

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened]

permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write
  actions: read

concurrency:
  group: claude-${{ github.event.issue.number || github.event.pull_request.number }}
  cancel-in-progress: false

jobs:
  claude:
    # The author check comes first and costs nothing, so a stranger's `@claude`
    # never reaches the credential steps below. See AUTOMATION.md §3.
    if: |
      (github.event.comment.author_association == 'OWNER' ||
       github.event.issue.author_association == 'OWNER') &&
      (contains(github.event.comment.body, '@claude') ||
       contains(github.event.issue.body, '@claude') ||
       contains(github.event.issue.title, '@claude'))
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: us-east-1

      - uses: anthropics/claude-code-action@v1
        with:
          github_token: ${{ steps.app-token.outputs.token }}
          use_bedrock: "true"
          claude_args: |
            --model us.anthropic.claude-opus-5
            --max-turns 40
```

`us-east-1` and the `us.` inference-profile prefix have to agree, and Bedrock model access
must be granted in every region of that profile's group.

The `timeout-minutes` and `--max-turns` are not decoration. This repo's specs and build are
fast (~22s build, 197 specs), but `npm ci` on a cold runner plus a wide-ranging change can
run long, and an unbounded agent loop bills by the token.

## 5. The scheduled rulings refresh — the one job worth automating

[scripts/rulings/refresh.sh](../scripts/rulings/refresh.sh) is already incremental, already
free when nothing upstream is new, and already writes to review queues rather than
publishing. That makes it the right thing to put on a cron, and the only track where
autonomy adds something a human would not otherwise do: Stonemaier answers new FAQ comments
continuously, and nobody notices for months.

What it must **not** do is commit to master. The output is a diff for review, so the job
opens a PR:

```yaml
name: Rulings refresh

on:
  schedule:
    - cron: "0 6 1 * *"   # monthly; new FAQ answers arrive slower than that
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    # Required-reviewer gate: the run cannot assume the role until approved.
    environment: bedrock

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      # Not the whole requirements.txt: its images group pulls OpenCV, which no
      # stage of the rulings pipeline touches. The pandas pin has to match,
      # though -- json-transformer.ipynb is byte-identity-verified against it.
      - run: python3 -m pip install "pandas==3.0.1" openpyxl simplejson boto3

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: us-east-1

      # refresh.sh is `set -euo pipefail` and its last stage is `npm run test:ci`,
      # so a changed pinned count in rulings.spec.ts aborts it -- and a failed step
      # would skip the PR below, losing the diff exactly when it is most
      # interesting. Let it fail, record that it did, and put it in the PR body.
      - id: refresh
        continue-on-error: true
        run: scripts/rulings/refresh.sh

      - uses: peter-evans/create-pull-request@v6
        with:
          branch: rulings/refresh
          title: "Rulings refresh"
          body: |
            Automated `scripts/rulings/refresh.sh` — outcome:
            `${{ steps.refresh.outcome }}`.

            Review the TSV diff, then the queues: `proposals.json` entries with
            `"review": "pending"`, and `curation.json` plans with
            `confidence != high` or non-empty `warnings`.

            A `failure` outcome is most likely `rulings.spec.ts`: a general
            ruling's fan-out changed, so update the pinned counts in this PR and
            say why.
```

Only the Stonemaier stage can work from a runner, and a runner is a datacenter IP. Measured
from a residential connection on 2026-08-30: `stonemaiergames.com` serves its WordPress
comment API openly (200, no auth), while BoardGameGeek answers 403 behind a Cloudflare
challenge and its `xmlapi2` returns 401, Reddit's `.json` endpoints return 403, and the
Facebook group returns 400 anonymously. Those three are worse, not better, from a runner. So
a scheduled job cannot close the Facebook and BGG gaps — 129 rows of the corpus cite sources
we cannot fetch. That is a property of the sources, not of the tooling, and no amount of
automation fixes it; the Facebook rows need hand-captured pages.

## 6. What stays manual, deliberately

- **Deploys.** The `github-pages` environment's approval gate is the whole reason a bad
  build cannot reach players. Automating past it would undo track A.
- **Publishing a ruling.** `proposals.json` and `curation.json` are review queues by
  design: only high-confidence output is applied, and hedged output waits for a human, so
  hedging can never silently publish or delete a ruling. A cron that auto-merged its own PR
  would delete that property.
- **The model out of the build path.** The committed JSON under `src/assets/data/` is what
  CI reads. Keeping every model call in `scripts/` is what keeps CI hermetic, deterministic
  and free.
- **Regenerated card data.** Ids are positional; a regeneration desynchronizes translations,
  artwork and links, and needs the checks in CLAUDE.md's data-pipeline section.

## 7. Cost

Actions minutes are free on public repositories, so the bill is tokens. The shape matters
more than the rate: an interactive workflow costs only when you ask it something, whereas
a `push`-triggered one costs on every commit forever. Bound both with `--max-turns` and
`timeout-minutes`, and keep [CLAUDE.md](../CLAUDE.md) tight, since it is read on every run.

## 8. Recommended order

1. Settle §2. Personal AWS account, or an API key and no AWS at all.
2. Register the custom GitHub App, add `APP_ID` / `APP_PRIVATE_KEY`, and add the role ARN
   as an **environment** secret on a protected `bedrock` environment.
3. Land §4 on a branch and test it with `@claude` on a closed issue before it touches an
   open one.
4. Add §5 last, with `workflow_dispatch` only. Promote it to `cron` after one run whose PR
   you were happy to merge.
