import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, OperationError } from "../src/errors.mjs";
import { createGoogleClient, withQuery } from "../src/http.mjs";

/** fetch that answers from a list of responses, in order, and records requests. */
function scripted(...responses) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, ...init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(
      next.body === undefined ? "" : JSON.stringify(next.body),
      { status: next.status ?? 200 },
    );
  };
  return { fetchImpl, requests };
}

const client = (fetchImpl) =>
  createGoogleClient({
    fetchImpl,
    getToken: async () => "tok",
    sleep: async () => {},
  });

describe("withQuery", () => {
  it("repeats arrays, skips empty values, and appends to an existing query", () => {
    assert.equal(
      withQuery("https://x.googleapis.com/a", {
        names: ["p/1", "p/2"],
        skip: undefined,
        no: false,
      }),
      "https://x.googleapis.com/a?names=p%2F1&names=p%2F2",
    );
    assert.equal(
      withQuery("https://x.googleapis.com/a?b=1", { c: 2 }),
      "https://x.googleapis.com/a?b=1&c=2",
    );
  });
});

describe("createGoogleClient", () => {
  it("only sends the token to https://*.googleapis.com", async () => {
    const { fetchImpl, requests } = scripted({ body: {} });
    const api = client(fetchImpl);
    await assert.rejects(
      api.get("https://evil.example.com/steal"),
      /Refusing to send credentials/,
    );
    await assert.rejects(
      api.get("http://firestore.googleapis.com/v1/x"),
      /Refusing/,
    );
    assert.equal(requests.length, 0);
    await api.get("https://firestore.googleapis.com/v1/x");
    assert.equal(requests[0].headers.authorization, "Bearer tok");
  });

  it("turns Google's error body into an ApiError with status, code and reason", async () => {
    const { fetchImpl } = scripted({
      status: 409,
      body: {
        error: { code: 409, message: "Site exists", status: "ALREADY_EXISTS" },
      },
    });
    const error = await client(fetchImpl)
      .post("https://firebasehosting.googleapis.com/v1beta1/x", {})
      .catch((e) => e);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "ALREADY_EXISTS");
    assert.equal(error.reason, "Site exists");
    assert.doesNotMatch(error.message, /tok/);
  });

  it("returns the notFound value on 404 when asked to", async () => {
    const { fetchImpl } = scripted({
      status: 404,
      body: { error: { message: "nope" } },
    });
    assert.equal(
      await client(fetchImpl).get("https://firestore.googleapis.com/v1/x", {
        notFound: null,
      }),
      null,
    );
  });

  it("retries reads on 503 and network errors, but never writes", async () => {
    const read = scripted(
      { status: 503, body: {} },
      new TypeError("fetch failed"),
      { body: { ok: true } },
    );
    assert.deepEqual(
      await client(read.fetchImpl).get("https://firestore.googleapis.com/v1/x"),
      { ok: true },
    );
    assert.equal(read.requests.length, 3);

    const write = scripted({ status: 503, body: {} }, { body: { ok: true } });
    await assert.rejects(
      client(write.fetchImpl).post("https://firestore.googleapis.com/v1/x", {}),
      ApiError,
    );
    assert.equal(write.requests.length, 1);
  });

  it("polls an operation until it is done, and surfaces its error", async () => {
    const ok = scripted(
      { body: { name: "operations/1", done: false } },
      { body: { name: "operations/1", done: true, response: { appId: "a" } } },
    );
    const api = client(ok.fetchImpl);
    assert.deepEqual(
      await api.waitForOperation(
        "https://firebase.googleapis.com/v1beta1",
        { name: "operations/1", done: false },
        { what: "x" },
      ),
      { appId: "a" },
    );
    assert.equal(
      ok.requests[0].url,
      "https://firebase.googleapis.com/v1beta1/operations/1",
    );

    const failed = scripted({
      body: {
        name: "operations/2",
        done: true,
        error: { code: 9, message: "billing required" },
      },
    });
    await assert.rejects(
      client(failed.fetchImpl).waitForOperation(
        "https://firestore.googleapis.com/v1",
        { name: "operations/2" },
        { what: "Creating the database" },
      ),
      (error) =>
        error instanceof OperationError &&
        /Creating the database failed \(code 9\): billing required/.test(
          error.message,
        ),
    );
  });

  it("follows nextPageToken", async () => {
    const { fetchImpl, requests } = scripted(
      { body: { apps: [1, 2], nextPageToken: "p2" } },
      { body: { apps: [3] } },
    );
    assert.deepEqual(
      await client(fetchImpl).list(
        "https://firebase.googleapis.com/v1beta1/projects/x/webApps",
        "apps",
      ),
      [1, 2, 3],
    );
    assert.equal(
      requests[1].url,
      "https://firebase.googleapis.com/v1beta1/projects/x/webApps?pageToken=p2",
    );
  });
});
