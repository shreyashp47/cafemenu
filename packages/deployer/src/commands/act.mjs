import { ApiError } from "../errors.mjs";

/**
 * Runs `fn` unless this is a dry run, and logs the change either way:
 * `would` in a dry run, `done` (a string, or a function of fn's result)
 * otherwise. Returns fn's result, or undefined in a dry run.
 */
export async function act(ctx, { would, done }, fn) {
  if (ctx.dryRun) {
    ctx.log.change(would);
    return undefined;
  }
  const result = await fn();
  ctx.log.change(typeof done === "function" ? done(result) : done);
  return result;
}

export const isAlreadyExists = (error) =>
  error instanceof ApiError &&
  (error.status === 409 || error.code === "ALREADY_EXISTS");

/** The last segment of a resource name: "sites/x/versions/abc" → "abc". */
export const shortName = (name) => String(name).split("/").pop();
