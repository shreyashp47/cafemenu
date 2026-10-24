/** The cafe's unsubscribe token: random, kept in `cafes/{id}/private/mail`, compared in constant time. */
import { createHash, randomBytes } from "node:crypto";

export const newToken = () => randomBytes(24).toString("base64url");

/** Whether two secrets are equal, in time that doesn't depend on where they differ. */
export function sameSecret(a, b) {
  const hash = (x) => createHash("sha256").update(String(x)).digest();
  const [x, y] = [hash(a), hash(b)];
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}
