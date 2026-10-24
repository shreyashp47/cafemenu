import { ApiError, OperationError } from "@cafemenu/deployer";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// google.rpc.Code: ABORTED, DEADLINE_EXCEEDED, UNAVAILABLE.
const RETRYABLE_CODES = new Set([4, 10, 14]);

/**
 * Whether trying the same thing again may well work: Google was busy or
 * didn't answer, or an operation timed out on our side. Every deployer
 * command is safe to run again, so this is only about whether it's worth it.
 */
export function isTransient(error) {
  if (error instanceof ApiError) return RETRYABLE_STATUS.has(error.status);
  if (error instanceof OperationError)
    return RETRYABLE_CODES.has(error.error?.code);
  return /did not get an answer|Timed out waiting/.test(error?.message ?? "");
}

export const BACKOFF_MS = [2_000, 10_000];

/**
 * Runs `fn`, and again after each wait in `delaysMs` while it fails with a
 * transient error. Any other error, and the last transient one, is thrown.
 */
export async function withRetry(
  fn,
  { delaysMs = BACKOFF_MS, sleep, onRetry } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransient(error) || attempt >= delaysMs.length) throw error;
      await onRetry?.(error, attempt + 1);
      await sleep(delaysMs[attempt]);
    }
  }
}
