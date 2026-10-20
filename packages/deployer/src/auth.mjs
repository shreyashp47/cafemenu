/**
 * Service-account sign-in, without google-auth-library: read the JSON key,
 * sign a JWT with its private key, and swap the JWT for an OAuth access token.
 *
 * The key and the token are the most sensitive things this package touches
 * (the platform's service account can rewrite the rules of every connected
 * cafe), so neither is ever logged, put in an error message, or written
 * anywhere. Errors name the key file's path and the service account's email,
 * nothing more.
 */
import { createSign } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";

import { UsageError } from "./errors.mjs";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CLOUD_PLATFORM_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";
const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** The longest a self-signed assertion may live: exp is at most iat + 1 hour. */
const ASSERTION_SECONDS = 3600;
/** Fetch a new token when the cached one has less than this left. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * Reads the key from `--key <path>`, else GOOGLE_APPLICATION_CREDENTIALS.
 * The private key is kept as a non-enumerable property, so logging or
 * JSON.stringify-ing the returned object can't print it by accident.
 */
export async function loadServiceAccountKey({
  keyPath,
  env = process.env,
  readFile = fsReadFile,
} = {}) {
  const path = keyPath || env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    throw new UsageError(
      "No service-account key. Pass --key <path> or set GOOGLE_APPLICATION_CREDENTIALS.",
    );
  }
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read the key file ${path} (${error.code ?? error.message}).`,
    );
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Not echoing the parser's message: it can quote part of the file.
    throw new Error(`The key file ${path} is not valid JSON.`);
  }
  if (
    json?.type !== "service_account" ||
    typeof json.client_email !== "string" ||
    typeof json.private_key !== "string"
  ) {
    throw new Error(
      `${path} is not a service-account key (expected "type": "service_account" with client_email and private_key).`,
    );
  }
  const key = {
    clientEmail: json.client_email,
    privateKeyId: json.private_key_id,
    projectId: json.project_id,
  };
  Object.defineProperty(key, "privateKey", {
    value: json.private_key,
    enumerable: false,
  });
  return key;
}

const base64url = (text) => Buffer.from(text).toString("base64url");

/**
 * The signed assertion for the token request.
 *
 * https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 * Header {alg: RS256, typ: JWT, kid}; claims {iss, scope, aud, iat, exp};
 * base64url without padding, joined with dots.
 */
export function signAssertion(key, { scope, nowSeconds }) {
  const header = { alg: "RS256", typ: "JWT" };
  if (key.privateKeyId) header.kid = key.privateKeyId;
  const claims = {
    iss: key.clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_SECONDS,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(key.privateKey)
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

/**
 * Returns `getToken()`, which hands out a cached access token and fetches a
 * new one shortly before it expires. Concurrent callers share one request.
 */
export function createTokenProvider({
  key,
  fetchImpl = fetch,
  now = Date.now,
  scope = CLOUD_PLATFORM_SCOPE,
}) {
  let cached = null;
  let pending = null;

  async function exchange() {
    const assertion = signAssertion(key, {
      scope,
      nowSeconds: Math.floor(now() / 1000),
    });
    // https://developers.google.com/identity/protocols/oauth2/service-account#httprest
    // POST form-encoded {grant_type, assertion} → {access_token, expires_in, token_type}
    // UNVERIFIED: run in spike #2
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: JWT_BEARER,
        assertion,
      }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.access_token !== "string") {
      // `error` and `error_description` are Google's words for what is wrong
      // (e.g. invalid_grant: the key was deleted). They never echo the key.
      const why = [body.error, body.error_description]
        .filter((part) => typeof part === "string")
        .join(": ");
      throw new Error(
        `Google refused the key for ${key.clientEmail} (${res.status}${why ? `, ${why}` : ""}).`,
      );
    }
    const seconds =
      Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    cached = { token: body.access_token, expiresAt: now() + seconds * 1000 };
    return cached.token;
  }

  return async function getToken() {
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) {
      return cached.token;
    }
    pending ??= exchange().finally(() => {
      pending = null;
    });
    return pending;
  };
}
