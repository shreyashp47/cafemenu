#!/usr/bin/env bash
# Builds CafeMenu's two live sites from this checkout and deploys them to the
# getcafemenu Firebase project:
#
#   https://getcafemenu.web.app        the CafeMenu console (apps/console)
#   https://getcafemenu-demo.web.app   the demo cafe (apps/cafe, demo mode)
#
# Needs Node 20+, `npm ci` working, and `firebase login` as an owner of
# getcafemenu. Run from anywhere: ./scripts/deploy-live.sh
set -euo pipefail

PROJECT="${PROJECT:-getcafemenu}"
DEMO_SITE="${DEMO_SITE:-getcafemenu-demo}"

cd "$(dirname "$0")/.."

echo "==> Installing"
npm ci --no-audit --no-fund

echo "==> Building the console and the cafe app"
npm run build -w @cafemenu/console
npm run build -w @cafemenu/cafe

echo "==> Deploying the console to https://$PROJECT.web.app"
(cd apps/console && firebase deploy --only hosting --project "$PROJECT" --non-interactive)

echo "==> Deploying the demo cafe to https://$DEMO_SITE.web.app"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R apps/cafe/out "$STAGE/out"
node - "$STAGE" "$DEMO_SITE" <<'NODE'
const fs = require("node:fs");
const [stage, site] = process.argv.slice(2);
// The demo cafe's settings: the TOE fixture's shape, renamed, in minor units
// (the demo store keeps paise), with `demo: true` so the site uses the
// in-browser demo store rather than a database.
const settings = JSON.parse(fs.readFileSync("apps/cafe/fixtures/toe.json", "utf8"));
Object.assign(settings, {
  name: "Mochi & Beans",
  tagline: "A CafeMenu demo cafe",
  moneyUnit: "minor",
  maxOrderTotal: 1000000,
  tables: [1, 2, 3, 4, 5, 6],
  baseUrl: `https://${site}.web.app`,
  demo: true,
});
fs.writeFileSync(`${stage}/out/site.json`, JSON.stringify(settings, null, 2));
const { hosting } = JSON.parse(fs.readFileSync("apps/cafe/firebase.json", "utf8"));
fs.writeFileSync(
  `${stage}/firebase.json`,
  JSON.stringify({ hosting: { ...hosting, site } }, null, 2),
);
NODE
(cd "$STAGE" && firebase deploy --only hosting --project "$PROJECT" --non-interactive)

echo "==> Checking both sites"
for url in "https://$PROJECT.web.app/" "https://$DEMO_SITE.web.app/" "https://$DEMO_SITE.web.app/order?table=3"; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$url")" "$url"
done
echo "Done."
