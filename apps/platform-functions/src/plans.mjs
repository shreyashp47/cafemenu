/**
 * The steps each kind of deployment shows, in order. A deployment is created
 * with all of them `pending`, so a progress screen has its list from the
 * start. `provision` has the platform's own steps; the others are the
 * deployer's (packages/deployer/src/commands/release.mjs and rollback.mjs),
 * which replace these with what really ran when the deployer finishes.
 */
export const PLANS = {
  provision: [
    ["check", "Check CafeMenu's access to your project"],
    ["provision", "Set up your Firebase project"],
    ["deploy", "Put CafeMenu online"],
    ["menu", "Load your starting menu"],
    ["owner", "Create your account and send the password email"],
  ],
  deploy: [
    ["package", "Fetch and verify the release package"],
    ["migrations", "Migrate the cafe's data"],
    ["rules", "Firestore rules"],
    ["indexes", "Firestore indexes"],
    ["settings", "Cafe settings"],
    ["hosting", "Hosting"],
    ["smoke", "Smoke test"],
  ],
  rollback: [
    ["schema", "Check the data's schema"],
    ["rules", "Firestore rules"],
    ["hosting", "Hosting"],
  ],
  branding: [
    ["settings", "Cafe settings"],
    ["hosting", "Hosting"],
  ],
};

export const newSteps = (kind) =>
  PLANS[kind].map(([id, label]) => ({ id, label, status: "pending" }));

/**
 * The deployer prints `> <title>` when it starts a step (src/log.mjs). Those
 * titles say which of the deployer's steps is running now, which is how a
 * deploy shows live progress without the deployer reporting it: a title that
 * matches nothing only changes the "now doing" line.
 */
const TITLES = [
  [/^Release package/, "package"],
  [/^Data schema/, null], // `migrations` in a deploy, `schema` in a rollback
  [/^Firestore rules/, "rules"],
  [/^Firestore indexes/, "indexes"],
  [/^Cafe settings/, "settings"],
  [/^Hosting /, "hosting"],
  [/^Smoke test/, "smoke"],
];

/** The step id a `> title` line starts, among `steps`, or null. */
export function stepForTitle(title, steps) {
  const ids = new Set(steps.map((s) => s.id));
  for (const [pattern, id] of TITLES) {
    if (!pattern.test(title)) continue;
    const found = id ?? (ids.has("migrations") ? "migrations" : "schema");
    return ids.has(found) ? found : null;
  }
  return null;
}
