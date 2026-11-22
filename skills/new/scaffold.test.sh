#!/usr/bin/env bash
set -euo pipefail

SCAFFOLD="$(dirname "$0")/scaffold.sh"
PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -f "$SCAFFOLD" ] || fail "scaffold.sh: No such file ($SCAFFOLD)"

COMMON=(--slug demo-app --title "Кава’Клуб" --bot-username demo_app_bot --domain demo.example.com)

run_scaffold() {
  bash "$SCAFFOLD" "$@" >"$T/out.log" 2>&1
}

expect_exit() {
  local want="$1"
  shift
  local got=0
  run_scaffold "$@" || got=$?
  if [ "$got" != "$want" ]; then
    cat "$T/out.log" >&2
    fail "expected exit $want, got $got for: $*"
  fi
}

cat >"$T/products.json" <<'JSON'
[
  {
    "id": "premium",
    "kind": "subscription",
    "priceStars": 50,
    "title": { "uk": "Преміум", "en": "Premium" },
    "description": { "uk": "Доступ до \"преміум\" розділу", "en": "Access to the \"premium\" section" }
  },
  {
    "id": "club",
    "kind": "one_time",
    "priceStars": 100,
    "title": { "uk": "Клуб", "en": "Club" },
    "description": { "uk": "Вступ до клубу", "en": "Club membership" }
  }
]
JSON

for v in empty shop; do
  dir="$T/my app $v"
  extra=()
  if [ "$v" = shop ]; then extra=(--products "$T/products.json"); fi
  expect_exit 0 --dir "$dir" "${COMMON[@]}" --variant "$v" ${extra[@]+"${extra[@]}"}
  [ -d "$dir" ] || fail "($v) --dir was not created"

  if grep -rnE '__[A-Z_]+__|tma:shop:' "$dir"; then
    fail "($v) placeholders or shop markers left in the generated project"
  fi

  if [ "$v" = empty ]; then
    [ ! -e "$dir/apps/api/src/shop" ] || fail "(empty) apps/api/src/shop must not exist"
    [ ! -e "$dir/apps/web/src/features/shop" ] || fail "(empty) apps/web/src/features/shop must not exist"
  else
    [ -d "$dir/apps/api/src/shop" ] || fail "(shop) apps/api/src/shop is missing"
    [ -d "$dir/apps/web/src/features/shop" ] || fail "(shop) apps/web/src/features/shop is missing"
  fi

  [ -f "$dir/deploy/nginx/demo-app.conf" ] || fail "($v) deploy/nginx/demo-app.conf is missing"
  [ -f "$dir/deploy/nginx/demo-app-bootstrap.conf" ] || fail "($v) deploy/nginx/demo-app-bootstrap.conf is missing"

  [ -f "$dir/.env" ] || fail "($v) .env is missing"
  grep -qE '^WEBHOOK_SECRET=[0-9a-f]{64}$' "$dir/.env" || fail "($v) .env has no 64-hex WEBHOOK_SECRET"
  grep -qx 'ADMIN_USER_IDS=1' "$dir/.env" || fail "($v) .env has no ADMIN_USER_IDS=1"
done

PRODUCTS_TS="$T/my app shop/apps/api/src/products.ts"
[ -f "$PRODUCTS_TS" ] || fail "(shop) apps/api/src/products.ts is missing"
grep -qF 'Access to the \"premium\" section' "$PRODUCTS_TS" || fail "(shop) products.ts lacks the JSON-escaped quote"
grep -qF 'Доступ до \"преміум\" розділу' "$PRODUCTS_TS" || fail "(shop) products.ts lacks the JSON-escaped quote (uk)"

if node -e 'require.resolve("typescript", { paths: [process.argv[1]] })' "$PLUGIN_ROOT" >/dev/null 2>&1; then
  node -e '
    const ts = require(require.resolve("typescript", { paths: [process.argv[1]] }));
    const fs = require("fs");
    const out = ts.transpileModule(fs.readFileSync(process.argv[2], "utf8"), {
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    if (out.diagnostics && out.diagnostics.length) {
      for (const d of out.diagnostics) console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      process.exit(1);
    }
    fs.writeFileSync(process.argv[3], out.outputText);
  ' "$PLUGIN_ROOT" "$PRODUCTS_TS" "$T/products.check.js" || fail "(shop) products.ts does not transpile"
  node --check "$T/products.check.js" || fail "(shop) transpiled products.ts is not valid JS"
fi

expect_exit 2 --dir "$T/bad-slug" --slug Bad_Slug --title "Кава’Клуб" --bot-username demo_app_bot --domain demo.example.com --variant empty
expect_exit 2 --dir "$T/bad-accent" "${COMMON[@]}" --variant empty --accent red
expect_exit 2 --dir "$T/bad-title" --slug demo-app --title "X" --bot-username demo_app_bot --domain demo.example.com --variant empty
expect_exit 2 --dir "$T/bad-title2" --slug demo-app --title "Bad<Title>" --bot-username demo_app_bot --domain demo.example.com --variant empty
expect_exit 2 --dir "$T/my app empty" "${COMMON[@]}" --variant empty
for d in bad-slug bad-accent bad-title bad-title2; do
  [ ! -e "$T/$d" ] || [ -z "$(ls -A "$T/$d")" ] || fail "invalid run left files in $T/$d"
done

FAKE_ROOT="$T/plugin root"
mkdir -p "$FAKE_ROOT"
cp -R "$PLUGIN_ROOT/template" "$FAKE_ROOT/template"
if [ -d "$PLUGIN_ROOT/.claude-plugin" ]; then
  cp -R "$PLUGIN_ROOT/.claude-plugin" "$FAKE_ROOT/.claude-plugin"
fi
mkdir -p "$FAKE_ROOT/template/docs"
printf 'left: __LEFTOVER__\n' >"$FAKE_ROOT/template/docs/leftover.md"
export TMA_PLUGIN_ROOT="$FAKE_ROOT"
expect_exit 3 --dir "$T/leftover" "${COMMON[@]}" --variant empty
unset TMA_PLUGIN_ROOT
grep -q 'leftover.md' "$T/out.log" || {
  cat "$T/out.log" >&2
  fail "exit 3 message does not list the file with the leftover placeholder"
}

TMA_VERSION="$(node -p 'require(process.argv[1]).version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")"
mkdir -p "$T/tarballs"
TARBALL="$(cd "$T/tarballs" && pwd)/tma-starter-$TMA_VERSION.tgz"
expect_exit 0 --dir "$T/from-source" "${COMMON[@]}" --variant shop --tma-source "$T/tarballs"
for pkg in package.json apps/api/package.json apps/web/package.json; do
  node -e '
    const [file, tarball] = process.argv.slice(1);
    const pkg = require(file);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const tma = Object.keys(deps).filter((name) => name === "tma-starter" || name.startsWith("@pctea/"));
    if (tma.join() !== "tma-starter") throw new Error(`${file}: expected only tma-starter, got ${tma.join(", ")}`);
    if (deps["tma-starter"] !== `file:${tarball}`) throw new Error(`${file}: tma-starter is ${deps["tma-starter"]}`);
    if (pkg.pnpm?.overrides) throw new Error(`${file}: has pnpm.overrides`);
    if (pkg.scripts?.["tma:upgrade"]) throw new Error(`${file}: has the tma:upgrade script`);
  ' "$T/from-source/$pkg" "$TARBALL" || fail "(--tma-source) $pkg does not depend on the single tarball"
done
[ ! -e "$T/from-source/scripts/tma-upgrade.mjs" ] || fail "scripts/tma-upgrade.mjs must not exist"
if grep -rnF '@pctea' "$T/from-source"; then
  fail "generated project still references @pctea packages"
fi

echo "All checks passed."
