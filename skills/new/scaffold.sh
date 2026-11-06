#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${TMA_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

die() {
  echo "scaffold.sh: $*" >&2
  exit 2
}

usage="usage: scaffold.sh --dir <path> --slug <slug> --title <title> --bot-username <name> --domain <domain> --variant empty|shop [--default-lang uk|en] [--accent '#rrggbb'] [--admin-ids 1,2] [--api-port 3200] [--products <json-file>] [--tma-source <dir>]"

DIR=""
SLUG=""
TITLE=""
BOT_USERNAME=""
DOMAIN=""
VARIANT=""
DEFAULT_LANG="uk"
ACCENT="#2f80ed"
ADMIN_IDS=""
API_PORT="3200"
PRODUCTS=""
TMA_SOURCE=""

while [ $# -gt 0 ]; do
  opt="$1"
  case "$opt" in
    --dir | --slug | --title | --bot-username | --domain | --variant | --default-lang | --accent | --admin-ids | --api-port | --products | --tma-source)
      [ $# -ge 2 ] || die "$opt requires a value"
      val="$2"
      shift 2
      ;;
    -h | --help)
      echo "$usage"
      exit 0
      ;;
    *) die "unknown argument: $opt" ;;
  esac
  case "$opt" in
    --dir) DIR="$val" ;;
    --slug) SLUG="$val" ;;
    --title) TITLE="$val" ;;
    --bot-username) BOT_USERNAME="$val" ;;
    --domain) DOMAIN="$val" ;;
    --variant) VARIANT="$val" ;;
    --default-lang) DEFAULT_LANG="$val" ;;
    --accent) ACCENT="$val" ;;
    --admin-ids) ADMIN_IDS="$val" ;;
    --api-port) API_PORT="$val" ;;
    --products) PRODUCTS="$val" ;;
    --tma-source) TMA_SOURCE="$val" ;;
  esac
done

[ -n "$DIR" ] || die "--dir is required"
case "$DIR" in -*) DIR="./$DIR" ;; esac
case "$PRODUCTS" in -*) PRODUCTS="./$PRODUCTS" ;; esac
case "$TMA_SOURCE" in -*) TMA_SOURCE="./$TMA_SOURCE" ;; esac
[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || die "invalid --slug '$SLUG': expected ^[a-z][a-z0-9-]{1,30}\$"
perl -CSA -e 'exit($ARGV[0] =~ /\A[\p{L}\p{N} .,\-!?:\x{2019}]{2,32}\z/ ? 0 : 1)' -- "$TITLE" ||
  die "invalid --title '$TITLE': 2-32 letters, digits, spaces or . , - ! ? : ’"
[[ "$BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || die "invalid --bot-username '$BOT_USERNAME': expected ^[A-Za-z0-9_]{5,32}\$"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "invalid --domain '$DOMAIN': expected a host name without scheme or /"
case "$VARIANT" in empty | shop) ;; *) die "invalid --variant '$VARIANT': expected empty or shop" ;; esac
case "$DEFAULT_LANG" in uk | en) ;; *) die "invalid --default-lang '$DEFAULT_LANG': expected uk or en" ;; esac
[[ "$ACCENT" =~ ^#[0-9a-fA-F]{6}$ ]] || die "invalid --accent '$ACCENT': expected #rrggbb"
[[ "$ADMIN_IDS" =~ ^([0-9]+(,[0-9]+)*)?$ ]] || die "invalid --admin-ids '$ADMIN_IDS': expected comma-separated numeric ids"
if ! [[ "$API_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$((10#$API_PORT))" -lt 1024 ] || [ "$((10#$API_PORT))" -gt 65535 ]; then
  die "invalid --api-port '$API_PORT': expected 1024-65535"
fi
API_PORT="$((10#$API_PORT))"

if [ -e "$DIR" ]; then
  [ -d "$DIR" ] || die "--dir '$DIR' exists and is not a directory"
  [ -z "$(ls -A "$DIR")" ] || die "--dir '$DIR' is not empty"
fi

if [ -n "$TMA_SOURCE" ]; then
  [ -d "$TMA_SOURCE" ] || die "--tma-source '$TMA_SOURCE' is not a directory"
  TMA_SOURCE="$(cd "$TMA_SOURCE" && pwd)"
fi

TEMPLATE="$PLUGIN_ROOT/template"
[ -d "$TEMPLATE" ] || die "template not found: $TEMPLATE"
MANIFEST="$PLUGIN_ROOT/.claude-plugin/plugin.json"
[ -f "$MANIFEST" ] || die "plugin manifest not found: $MANIFEST"
TMA_VERSION="$(perl -0ne 'print $1 if /"version"\s*:\s*"([^"]+)"/' "$MANIFEST")"
[ -n "$TMA_VERSION" ] || die "no version in $MANIFEST"

if [ -n "$PRODUCTS" ]; then
  [ -f "$PRODUCTS" ] || die "--products '$PRODUCTS' is not a file"
  command -v node >/dev/null 2>&1 || die "node is required for --products"
  node -e '
    const fs = require("fs");
    const fail = (m) => { process.stderr.write("scaffold.sh: invalid --products: " + m + "\n"); process.exit(2); };
    let list;
    try { list = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { fail(e.message); }
    if (!Array.isArray(list)) fail("expected a JSON array");
    const len = (s) => [...s].length;
    const text = (v, max, where) => {
      if (!v || typeof v !== "object") fail(where + " must be { uk, en }");
      for (const l of ["uk", "en"]) {
        if (typeof v[l] !== "string" || len(v[l]) < 1 || len(v[l]) > max) fail(where + "." + l + " must be 1-" + max + " characters");
      }
    };
    const ids = new Set();
    list.forEach((p, i) => {
      const at = "product #" + i;
      if (!p || typeof p !== "object") fail(at + " must be an object");
      if (typeof p.id !== "string" || !/^[a-z0-9_]{1,24}$/.test(p.id)) fail(at + ".id must match ^[a-z0-9_]{1,24}$");
      if (ids.has(p.id)) fail("duplicate id " + p.id);
      ids.add(p.id);
      if (p.kind !== "one_time" && p.kind !== "subscription") fail(p.id + ".kind must be one_time or subscription");
      if (!Number.isInteger(p.priceStars) || p.priceStars < 1 || p.priceStars > 10000) fail(p.id + ".priceStars must be an integer 1-10000");
      if (p.repeatable !== undefined && typeof p.repeatable !== "boolean") fail(p.id + ".repeatable must be boolean");
      text(p.title, 32, p.id + ".title");
      text(p.description, 255, p.id + ".description");
    });
    if (list.filter((p) => p.id === "premium" && p.kind === "subscription").length !== 1) fail("exactly one product premium with kind subscription is required");
  ' -- "$PRODUCTS"
fi

mkdir -p "$DIR"
cp -R "$TEMPLATE/." "$DIR/"
find "$DIR" -mindepth 1 -depth \( -name node_modules -o -name dist \) -type d -exec rm -rf {} +
find "$DIR" -mindepth 1 -name .env -type f -exec rm -f {} +

MARKER_FILES=()
while IFS= read -r -d '' f; do
  MARKER_FILES+=("$f")
done < <(grep -rl --null -E 'tma:shop:(start|end)' "$DIR" || true)

if [ "$VARIANT" = empty ]; then
  rm -rf "$DIR/apps/api/src/shop" "$DIR/apps/web/src/features/shop"
  find "$DIR/apps/web/src/i18n" -maxdepth 1 -name 'shop.*.json' -type f -exec rm -f {} + 2>/dev/null || true
  for f in ${MARKER_FILES[@]+"${MARKER_FILES[@]}"}; do
    [ -f "$f" ] || continue
    perl -ni -e 'if (/tma:shop:start/) { $skip = 1; next } if (/tma:shop:end/) { $skip = 0; next } print unless $skip' "$f"
  done
else
  for f in ${MARKER_FILES[@]+"${MARKER_FILES[@]}"}; do
    perl -ni -e 'print unless /tma:shop:(start|end)/' "$f"
  done
fi

if [ "$VARIANT" = shop ] && [ -n "$PRODUCTS" ]; then
  mkdir -p "$DIR/apps/api/src"
  node -e '
    const fs = require("fs");
    const list = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const s = JSON.stringify;
    const lines = ["import type { Product } from \"@dmytro-rudenko/tma-nest-payments\";", "", "export const products: Product[] = ["];
    for (const p of list) {
      lines.push("  {");
      lines.push("    id: " + s(p.id) + ",");
      lines.push("    kind: " + s(p.kind) + ",");
      lines.push("    priceStars: () => " + s(p.priceStars) + ",");
      if (p.repeatable !== undefined) lines.push("    repeatable: " + s(p.repeatable) + ",");
      lines.push("    title: (lang) => ({ uk: " + s(p.title.uk) + ", en: " + s(p.title.en) + " })[lang],");
      lines.push("    description: (lang) => ({ uk: " + s(p.description.uk) + ", en: " + s(p.description.en) + " })[lang],");
      lines.push("  },");
    }
    lines.push("];", "");
    fs.writeFileSync(process.argv[2], lines.join("\n"));
  ' -- "$PRODUCTS" "$DIR/apps/api/src/products.ts"
fi

export TMA_PH_APP_SLUG="$SLUG"
export TMA_PH_APP_DB="${SLUG//-/_}"
export TMA_PH_APP_TITLE="$TITLE"
export TMA_PH_BOT_USERNAME="$BOT_USERNAME"
export TMA_PH_DOMAIN="$DOMAIN"
export TMA_PH_DEFAULT_LANG="$DEFAULT_LANG"
export TMA_PH_ACCENT="$ACCENT"
export TMA_PH_TMA_VERSION="$TMA_VERSION"
export TMA_PH_API_PORT="$API_PORT"
PH_RE='__(APP_SLUG|APP_DB|APP_TITLE|BOT_USERNAME|DOMAIN|DEFAULT_LANG|ACCENT|TMA_VERSION|API_PORT)__'
PH_SUB='s/__(APP_SLUG|APP_DB|APP_TITLE|BOT_USERNAME|DOMAIN|DEFAULT_LANG|ACCENT|TMA_VERSION|API_PORT)__/$ENV{"TMA_PH_$1"}/g'

while IFS= read -r -d '' f; do
  [ "$(file -b --mime-encoding "$f")" = binary ] && continue
  perl -pi -e "$PH_SUB" "$f"
done < <(grep -rl --null -E "$PH_RE" "$DIR" || true)

while IFS= read -r -d '' p; do
  base="$(basename "$p")"
  new="$(printf '%s' "$base" | perl -pe "$PH_SUB")"
  [ "$new" = "$base" ] || mv "$p" "$(dirname "$p")/$new"
done < <(find "$DIR" -depth -name '*__*__*' -print0)

if [ -n "$TMA_SOURCE" ]; then
  export TMA_SOURCE
  while IFS= read -r -d '' f; do
    perl -pi -e 's{"(\@dmytro-rudenko/tma-([a-z0-9-]+))"(\s*):(\s*)"([^"]+)"}{"$1"$3:$4"file:$ENV{TMA_SOURCE}/dmytro-rudenko-tma-$2-$5.tgz"}g' "$f"
  done < <(find "$DIR" -name package.json -type f -not -path '*/node_modules/*' -print0)
fi

if [ -f "$DIR/.env.example" ]; then
  TMA_ENV_WEBHOOK_SECRET="$(openssl rand -hex 32)"
  TMA_ENV_WEBHOOK_PATH_TOKEN="$(openssl rand -hex 32)"
  TMA_ENV_BOT_TOKEN="000000:dev-local-token"
  TMA_ENV_BOT_API_ROOT="http://127.0.0.1:3199"
  TMA_ENV_DATABASE_URL="postgres://postgres@127.0.0.1:54329/$TMA_PH_APP_DB"
  TMA_ENV_ADMIN_USER_IDS="${ADMIN_IDS:-1}"
  export TMA_ENV_WEBHOOK_SECRET TMA_ENV_WEBHOOK_PATH_TOKEN TMA_ENV_BOT_TOKEN TMA_ENV_BOT_API_ROOT TMA_ENV_DATABASE_URL TMA_ENV_ADMIN_USER_IDS
  perl -ne '
    BEGIN { @keys = qw(WEBHOOK_SECRET WEBHOOK_PATH_TOKEN BOT_TOKEN BOT_API_ROOT DATABASE_URL ADMIN_USER_IDS); %seen = () }
    if (/^([A-Z0-9_]+)=/ && exists $ENV{"TMA_ENV_$1"}) { $seen{$1} = 1; print "$1=$ENV{\"TMA_ENV_$1\"}\n"; next }
    s/\n?\z/\n/;
    print;
    END { for my $k (@keys) { print "$k=$ENV{\"TMA_ENV_$k\"}\n" unless $seen{$k} } }
  ' "$DIR/.env.example" >"$DIR/.env"
fi

LEFTOVERS="$(
  {
    grep -rlE '__[A-Z_]+__|tma:shop:' "$DIR" || true
    find "$DIR" -name '*__[A-Z]*__*' || true
  } | sort -u
)"
if [ -n "$LEFTOVERS" ]; then
  {
    echo "scaffold.sh: leftover placeholders or shop markers in:"
    printf '%s\n' "$LEFTOVERS" | while IFS= read -r f; do echo "  ${f#"$DIR"/}"; done
  } >&2
  exit 3
fi

echo "scaffolded $DIR ($VARIANT)"
