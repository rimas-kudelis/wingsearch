#!/usr/bin/env bash
#
# One command for the whole rulings pipeline: fetch new official answers, judge them,
# apply the confident ones, curate the pages they landed on, rebuild the JSON, test.
#
#   ./refresh.sh              # the full pass
#   ./refresh.sh --dry-run    # report what each stage would do, call nothing
#   ./refresh.sh --no-curate  # skip the curation step
#
# Every stage is incremental and safe to re-run: a thread already judged is not paid for
# twice, a ruling already in the TSV is not appended twice, and a card whose rulings have
# not changed is not re-curated. Running this with nothing new upstream is a no-op that
# costs nothing.
#
# Needs AWS credentials for Bedrock (export AWS_PROFILE=...) and Node 22 for the specs.
# Nothing here pushes, deploys, or commits -- the working tree diff is the review.

set -euo pipefail
cd "$(dirname "$0")"

DRY_RUN=
CURATE=1
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --no-curate) CURATE= ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

TSV='rulings.tsv'
NEW_ROWS=$(mktemp)
TOUCHED=$(mktemp)
trap 'rm -f "$NEW_ROWS" "$TOUCHED"' EXIT

step '1/6  Fetch new comments from the Stonemaier FAQ pages'
if [[ -n $DRY_RUN ]]; then
    python3 fetch_stonemaier.py --stats
else
    python3 fetch_stonemaier.py
fi

step '2/6  Judge unseen threads'
if [[ -n $DRY_RUN ]]; then
    python3 propose.py --dry-run
else
    python3 propose.py
fi

step '3/6  Append accepted rulings to the TSV'
# --emit-tsv prints only proposals marked "review": "accept" that are not already cited in
# the TSV, so this appends new rulings and nothing else. Anything the model was unsure of
# stays in proposals.json as "pending" for a human; see the review notes there.
python3 propose.py --emit-tsv > "$NEW_ROWS" || true
if [[ -s $NEW_ROWS ]]; then
    cut -f3 "$NEW_ROWS" | grep -v '^$' | sort -u > "$TOUCHED"
    echo "$(wc -l < "$NEW_ROWS" | tr -d ' ') new row(s) across \
$(wc -l < "$TOUCHED" | tr -d ' ') card(s)"
    if [[ -z $DRY_RUN ]]; then
        cat "$NEW_ROWS" >> "$TSV"
        echo "appended to $TSV"
    fi
else
    echo 'no new rulings to append'
    : > "$TOUCHED"
fi

if [[ -n $CURATE ]]; then
    step '4/6  Curate the cards whose rulings changed'
    # Scoped to the cards that just gained a ruling: adding one is exactly what makes a
    # page's ordering stale, and a card nobody touched was already curated. Drop the
    # --cards-file argument to sweep every card with 2+ rulings instead.
    if [[ -s $TOUCHED ]]; then
        if [[ -n $DRY_RUN ]]; then
            python3 curate.py --dry-run --cards-file "$TOUCHED"
        else
            python3 curate.py --cards-file "$TOUCHED"
            # High confidence only, and plans carrying warnings are held back. The rest
            # wait in curation.json:
            #   python3 curate.py --apply --diff     # read it first
            #   python3 curate.py --apply --confidence high,medium
            python3 curate.py --apply
        fi
    else
        echo 'no cards changed, nothing to curate'
    fi
else
    step '4/6  Curation skipped (--no-curate)'
fi

step '5/6  Regenerate src/assets/data from the spreadsheets'
if [[ -n $DRY_RUN ]]; then
    echo '(would run ../transform/run.py json-transformer)'
else
    ../transform/run.py json-transformer
fi

step '6/6  Specs'
if [[ -n $DRY_RUN ]]; then
    echo '(would run npm run test:ci)'
else
    # Angular 22 needs the Node in .nvmrc; a system Node that is too old fails the
    # build rather than the specs, which is a confusing way to end a rulings run.
    NODE_BIN="$HOME/.nvm/versions/node/$(cat ../../.nvmrc)/bin"
    [[ -d $NODE_BIN ]] && export PATH="$NODE_BIN:$PATH"
    (cd ../.. && npm run test:ci)
fi

step 'Done'
cat <<'EOF'
Review before committing:

    git diff --stat
    git diff -- scripts/rulings/rulings.tsv

Queues that need a human, if the run left anything in them:

    proposals.json   entries with "review": "pending" and "is_ruling": true
    curation.json    plans with confidence != high, or a non-empty "warnings"

rulings.spec.ts pins per-ruling attachment counts. If it failed, a general ruling's
fan-out changed: update the counts in the same commit and say why.
EOF
