/**
 * Step-by-step output. Every line under a step starts with a marker, so a
 * log reads at a glance and greps well:
 *
 *   > Firestore database           a step
 *     = already exists (eur3)      nothing to do
 *     + created in eur3            changed something
 *     ~ would create in eur3       dry run: would change this
 *     ! exists in nam5, not eur3   needs a look, but not an error
 *       app id 1:23:web:45         detail
 *
 * The logger also counts what changed (or would), which commands return so
 * tests and, later, the console can tell a no-op run from a real one.
 */
export function createLogger({
  write = (line) => console.log(line),
  dryRun = false,
} = {}) {
  const changes = [];
  const line = (marker, text) => write(`  ${marker} ${text}`);
  return {
    dryRun,
    changes,
    title(text) {
      write(dryRun ? `${text} (dry run: nothing will be changed)` : text);
    },
    step(text) {
      write(`> ${text}`);
    },
    same(text) {
      line("=", text);
    },
    /** Something changed or, in a dry run, would have. */
    change(text) {
      changes.push(text);
      line(dryRun ? "~" : "+", text);
    },
    warn(text) {
      line("!", text);
    },
    info(text) {
      line(" ", text);
    },
    /** A line of its own, e.g. the closing summary. */
    say(text) {
      write(text);
    },
    blank() {
      write("");
    },
  };
}
