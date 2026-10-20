import assert from "node:assert/strict";
import {
  createPublicKey,
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import {
  CLOUD_PLATFORM_SCOPE,
  TOKEN_URL,
  createTokenProvider,
  loadServiceAccountKey,
  signAssertion,
} from "../src/auth.mjs";
import { UsageError } from "../src/errors.mjs";
import { createFakeGoogle } from "./helpers/fake-google.mjs";
import {
  CLIENT_EMAIL,
  PRIVATE_KEY_PEM,
  PUBLIC_KEY_PEM,
  cli,
  tempDir,
  writeKeyFile,
  writeTree,
} from "./helpers/setup.mjs";

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());

async function loadKey() {
  return loadServiceAccountKey({
    keyPath: await writeKeyFile(await tempDir()),
    env: {},
  });
}

describe("loadServiceAccountKey", () => {
  it("reads --key, else GOOGLE_APPLICATION_CREDENTIALS", async () => {
    const path = await writeKeyFile(await tempDir());
    const fromFlag = await loadServiceAccountKey({ keyPath: path, env: {} });
    const fromEnv = await loadServiceAccountKey({
      env: { GOOGLE_APPLICATION_CREDENTIALS: path },
    });
    assert.equal(fromFlag.clientEmail, CLIENT_EMAIL);
    assert.equal(fromEnv.clientEmail, CLIENT_EMAIL);
    assert.equal(fromFlag.privateKeyId, "key-id-1");
  });

  it("is a usage error when neither is given", async () => {
    await assert.rejects(loadServiceAccountKey({ env: {} }), UsageError);
  });

  it("never shows the private key when the key object is printed", async () => {
    const key = await loadKey();
    assert.equal(key.privateKey, PRIVATE_KEY_PEM);
    assert.doesNotMatch(JSON.stringify(key), /PRIVATE KEY/);
    assert.doesNotMatch(inspect(key), /PRIVATE KEY/);
  });

  it("rejects files that aren't service-account keys, without quoting them", async () => {
    const dir = await tempDir();
    await writeTree(dir, {
      "user.json": JSON.stringify({
        type: "authorized_user",
        refresh_token: "secret-refresh",
      }),
      "broken.json": `{"private_key": "half-a-secret-key oops`,
    });
    for (const name of ["user.json", "broken.json"]) {
      const error = await loadServiceAccountKey({
        keyPath: join(dir, name),
        env: {},
      }).catch((e) => e);
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret-refresh|half-a-secret-key/);
    }
  });
});

describe("signAssertion", () => {
  it("builds the JWT Google documents, signed with RS256", async () => {
    const key = await loadKey();
    const jwt = signAssertion(key, {
      scope: CLOUD_PLATFORM_SCOPE,
      nowSeconds: 1_700_000_000,
    });
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header), {
      alg: "RS256",
      typ: "JWT",
      kid: "key-id-1",
    });
    assert.deepEqual(decode(claims), {
      iss: CLIENT_EMAIL,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: TOKEN_URL,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    assert.doesNotMatch(jwt, /[=+/]/, "base64url, no padding");
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(
        createPublicKey(PUBLIC_KEY_PEM),
        Buffer.from(signature, "base64url"),
      );
    assert.ok(valid);
  });
});

describe("createTokenProvider", () => {
  it("exchanges a signed assertion for an access token", async () => {
    const google = createFakeGoogle({ publicKeyPem: PUBLIC_KEY_PEM });
    const getToken = createTokenProvider({
      key: await loadKey(),
      fetchImpl: google.fetchImpl,
    });
    assert.equal(await getToken(), "fake-token-1");

    const [call] = google.calls;
    assert.equal(call.method, "POST");
    assert.equal(call.url, "https://oauth2.googleapis.com/token");
    assert.equal(
      call.headers["content-type"],
      "application/x-www-form-urlencoded",
    );
    assert.equal(
      call.body.grant_type,
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    assert.equal(
      decode(call.body.assertion.split(".")[1]).scope,
      CLOUD_PLATFORM_SCOPE,
    );
  });

  it("caches the token until five minutes before it expires", async () => {
    const google = createFakeGoogle({ publicKeyPem: PUBLIC_KEY_PEM });
    let now = 1_000_000;
    const getToken = createTokenProvider({
      key: await loadKey(),
      fetchImpl: google.fetchImpl,
      now: () => now,
    });
    assert.equal(await getToken(), "fake-token-1");
    now += 50 * 60_000; // expires_in is 3599 s, so 9m59s left
    assert.equal(await getToken(), "fake-token-1");
    now += 5 * 60_000; // 4m59s left
    assert.equal(await getToken(), "fake-token-2");
    assert.equal(google.calls.length, 2);
  });

  it("shares one request between concurrent callers", async () => {
    const google = createFakeGoogle({ publicKeyPem: PUBLIC_KEY_PEM });
    const getToken = createTokenProvider({
      key: await loadKey(),
      fetchImpl: google.fetchImpl,
    });
    const tokens = await Promise.all([getToken(), getToken(), getToken()]);
    assert.deepEqual(tokens, ["fake-token-1", "fake-token-1", "fake-token-1"]);
    assert.equal(google.calls.length, 1);
  });

  it("reports Google's refusal without the key or the assertion", async () => {
    // Signed with a different key than the fake expects.
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const other = createFakeGoogle({
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    });
    const key = await loadKey();
    const getToken = createTokenProvider({ key, fetchImpl: other.fetchImpl });
    const error = await getToken().catch((e) => e);
    assert.match(error.message, /Google refused the key for deploy@/);
    assert.match(error.message, /invalid_grant: Invalid JWT Signature/);
    assert.ok(!error.message.includes(other.calls[0].body.assertion));
    assert.doesNotMatch(error.message, /PRIVATE KEY/);
  });

  it("is used by the CLI, and the token never reaches the output", async () => {
    const { google, run } = await cli();
    const result = await run("check");
    assert.equal(result.code, 0);
    const apiCall = google.apiCalls()[0];
    assert.equal(apiCall.headers.authorization, "Bearer fake-token-1");
    assert.doesNotMatch(result.out + result.err, /fake-token|PRIVATE KEY/);
  });
});
