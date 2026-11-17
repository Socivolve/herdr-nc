# Shared by scripts/check, scripts/deploy and scripts/pull (bash 3.2, macOS).

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

# One deploy record per target home ("<sha1>\t<path>" per line), so a sandbox home
# and the live home never mix. local/ is gitignored.
STATE="$REPO/local/deployed-$(printf '%s' "$TARGET" | shasum | cut -c1-12).tsv"

# Every file this repo owns in the Herdr home, one path per line, relative to both.
managed_files() (
  cd "$REPO" || exit 1
  for f in keys.json settings.json programs.json layouts/*.json layouts/*.svg layouts/*.png themes/*.json; do
    if [ -f "$f" ]; then echo "$f"; fi
  done
  if [ -d mods ]; then
    # Herdr writes gpui-kit.d.ts and jsconfig.json into every mod folder it loads.
    find mods -mindepth 2 -type f ! -name gpui-kit.d.ts ! -name jsconfig.json ! -name '.*' | LC_ALL=C sort
  fi
)

# Paths only this repo uses (nobody else names things nc*), so they count as ours
# even without a deploy record, e.g. after a fresh clone on another Mac.
ours_by_name() {
  case "$1" in
    layouts/nc.*|layouts/nc-*|themes/nc.*|themes/nc-*|mods/nc-*) return 0 ;;
    *) return 1 ;;
  esac
}

hash_of() { shasum "$1" | cut -d' ' -f1; }

recorded_hash() {
  if [ -f "$STATE" ]; then awk -F'\t' -v p="$1" '$2 == p { print $1 }' "$STATE"; fi
}

set_recorded() { # <path> <hash>
  mkdir -p "$(dirname "$STATE")"
  local tmp="$STATE.tmp"
  if [ -f "$STATE" ]; then awk -F'\t' -v p="$1" '$2 != p' "$STATE" > "$tmp"; else : > "$tmp"; fi
  printf '%s\t%s\n' "$2" "$1" >> "$tmp"
  mv -f "$tmp" "$STATE"
}
