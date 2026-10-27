/**
 * What the worker prints. The repository is public, and so are its GitHub
 * Actions logs: anyone can read them. So the worker's log names requests and
 * deployments by their ids and says how they went, and nothing else: no
 * email addresses, no cafe names, no project IDs, no deployer output, no
 * error messages beyond fixed words. What happened in detail is on the
 * request and deployment documents in Firestore, which only their owner and
 * the admin can read.
 *
 * `--verbose` prints everything, for running the worker on your own machine.
 */

const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

/** `text` with every email address in it replaced. */
export const redact = (text) => String(text).replace(EMAIL, "<email>");

/**
 * The `log(level, message, fields)` the backend's code is given. Info lines
 * (the deployer's output, the emails' subjects) are dropped unless `verbose`;
 * warnings and errors are printed as their fixed message, without fields,
 * with any address in it hidden.
 */
export function createPublicLog({ write = console.log, verbose = false } = {}) {
  const counts = { info: 0, warn: 0, error: 0 };
  const log = (level, message, fields) => {
    counts[level] = (counts[level] ?? 0) + 1;
    if (verbose) {
      write(
        `${level}: ${message}${fields ? ` ${JSON.stringify(fields)}` : ""}`,
      );
      return;
    }
    if (level === "info") return;
    write(`${level}: ${redact(message).slice(0, 160)}`);
  };
  return { log, counts };
}

const line = (what, id, kind, outcome, code) =>
  `${what} ${id}${kind ? ` (${kind})` : ""}: ${outcome}${code ? ` [${code}]` : ""}`;

/** The run's summary as lines for the public log: ids, kinds and outcomes only. */
export function summaryLines(summary) {
  const lines = [];
  for (const r of summary.requests) {
    lines.push(line("request", r.id, r.kind, r.outcome, r.code));
  }
  for (const d of summary.deployments) {
    lines.push(line("deployment", d.id, null, d.outcome, null));
  }
  const { jobs } = summary;
  if (jobs.ran) {
    lines.push(
      `jobs: ${jobs.announced.length} release change(s)` +
        `${jobs.support ? ", support window checked" : ""}` +
        `; emails ${jobs.sent} sent, ${jobs.skipped} not needed, ${jobs.failed} failed` +
        (jobs.directory
          ? `; directory ${jobs.directory.changed} of ${jobs.directory.accounts} updated`
          : ""),
    );
  }
  if (!lines.length) lines.push("nothing to do");
  return lines;
}
