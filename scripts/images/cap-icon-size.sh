#!/usr/bin/env bash
# Re-encode any icon whose longest edge exceeds MAX px, from its PNG master, at that cap.
#
# Icons are drawn at 1em (.icon-image), 30px (.pack-image), 80px (.power-image) or 15cqw of a
# card that is never wider than 400px (.wingspan-icon), so the largest any icon can be painted
# is ~60 CSS px -- 180 device px on a 3x phone. Several masters were 1000px+, which costs bytes
# on the wire and ~50x the decoded bitmap in memory, with 18 cards on screen at a time.
#
# 256 leaves 1.4x headroom over the worst case (wingspan at DPR 3) and 3x+ over everything else.
# Files already within the cap are left untouched so the diff stays reviewable -- re-encoding all
# 81 with a different cwebp build than the original would rewrite every one for no gain.
#
# Run from anywhere; paths resolve from the repo root.
set -euo pipefail

MAX=${MAX:-256}
ICONS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/src/assets/icons/png"

for png in "$ICONS"/*.png; do
    webp="${png%.png}.webp"
    # `identify -format` emits no trailing newline, which would make `read` return non-zero.
    read -r w h <<< "$(magick identify -format '%w %h' "$png")"
    long=$(( w > h ? w : h ))
    [ "$long" -le "$MAX" ] && continue

    if [ "$w" -ge "$h" ]; then resize=("$MAX" 0); else resize=(0 "$MAX"); fi
    before=$(wc -c < "$webp")
    cwebp -quiet -resize "${resize[0]}" "${resize[1]}" "$png" -o "$webp.new"
    after=$(wc -c < "$webp.new")

    # A file only barely over the cap can come out *larger*: the committed WebP was encoded with
    # settings we no longer know, and default q=75 from the PNG master need not beat it. Downscaling
    # is only worth doing when it actually wins, so keep the original in that case (none.webp).
    if [ "$after" -ge "$before" ]; then
        rm "$webp.new"
        printf '%-24s %5dx%-5d   skipped: re-encode would grow %d -> %d bytes\n' \
            "$(basename "$webp")" "$w" "$h" "$before" "$after"
        continue
    fi

    mv "$webp.new" "$webp"
    printf '%-24s %5dx%-5d -> cap %d   %7d -> %7d bytes\n' \
        "$(basename "$webp")" "$w" "$h" "$MAX" "$before" "$after"
done
