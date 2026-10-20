/**
 * `npm run seed:staff` (issue #33): argument parsing and the decide-then-write
 * logic, against a fake admin client. Nothing here touches a real project.
 */
import { describe, expect, it } from "vitest";

import { UsageError } from "../lib/admin-client.mjs";
import {
  generatePassword,
  parseSeedArgs,
  runSeed,
} from "../lib/seed-staff.mjs";

describe("parseSeedArgs", () => {
  it("parses the documented form", () => {
    expect(
      parseSeedArgs([
        "--email=Asha@Cafe.com ",
        "--role=staff",
        "--name=Asha",
        "--dry-run",
      ]),
    ).toEqual({
      help: false,
      email: "asha@cafe.com",
      role: "staff",
      name: "Asha",
      password: undefined,
      project: undefined,
      dryRun: true,
    });
  });

  it("accepts space-separated values and a project", () => {
    const opts = parseSeedArgs([
      "--email",
      "o@cafe.com",
      "--role",
      "OWNER",
      "--project",
      "toi-cafe",
    ]);
    expect(opts).toMatchObject({
      email: "o@cafe.com",
      role: "owner",
      project: "toi-cafe",
      dryRun: false,
    });
  });

  it("returns help without demanding anything else", () => {
    expect(parseSeedArgs(["--help"])).toEqual({ help: true });
  });

  it.each([
    [[], /--email is required/],
    [["--email=not-an-email", "--role=staff"], /Not an email/],
    [["--email=a@b.co"], /--role must be staff or owner/],
    [["--email=a@b.co", "--role=admin"], /--role must be staff or owner/],
    [["--email=a@b.co", "--role=staff", "--name="], /--name must be/],
    [["--email=a@b.co", "--role=staff", "--password=short"], /at least 8/],
    [["--email=a@b.co", "--role=staff", "--rol=owner"], /Unknown option/],
    [["--email=a@b.co", "--role=staff", "stray"], /positional/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseSeedArgs(argv)).toThrow(UsageError);
    expect(() => parseSeedArgs(argv)).toThrow(message);
  });
});

describe("generatePassword", () => {
  it("is three groups of four unambiguous characters", () => {
    const pw = generatePassword();
    expect(pw).toMatch(
      /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){2}$/,
    );
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
});

function fakeClient({ user = null, doc = null } = {}) {
  const calls = [];
  return {
    calls,
    target: "a fake project",
    async lookupUserByEmail(email) {
      calls.push(["lookup", email]);
      return user;
    },
    async createUser(input) {
      calls.push(["createUser", input]);
      return { uid: "new-uid" };
    },
    async getStaffDoc(uid) {
      calls.push(["getStaffDoc", uid]);
      return doc;
    },
    async setStaffDoc(uid, fields) {
      calls.push(["setStaffDoc", uid, fields]);
    },
  };
}

const base = parseSeedArgs(["--email=asha@cafe.com", "--role=staff"]);
const writes = (client) =>
  client.calls.filter(([op]) => op === "createUser" || op === "setStaffDoc");

describe("runSeed", () => {
  it("creates a missing account, prints its password once, and writes the role", async () => {
    const client = fakeClient();
    const lines = [];
    const result = await runSeed(base, client, (l) => lines.push(l));

    expect(result.createdUser).toBe(true);
    expect(result.wroteDoc).toBe(true);
    const created = client.calls.find(([op]) => op === "createUser")[1];
    expect(created.email).toBe("asha@cafe.com");
    expect(created.password).toBe(result.generatedPassword);
    expect(client.calls).toContainEqual([
      "setStaffDoc",
      "new-uid",
      { name: "asha", role: "staff" },
    ]);
    expect(
      lines.filter((l) => l.includes(result.generatedPassword)),
    ).toHaveLength(1);
  });

  it("uses a given password instead of generating one", async () => {
    const client = fakeClient();
    const result = await runSeed(
      { ...base, password: "correct-horse" },
      client,
      () => {},
    );
    expect(result.generatedPassword).toBeNull();
    expect(client.calls.find(([op]) => op === "createUser")[1].password).toBe(
      "correct-horse",
    );
  });

  it("never touches an existing account's password", async () => {
    const client = fakeClient({
      user: { uid: "u1", email: "asha@cafe.com", displayName: "Asha P" },
    });
    const lines = [];
    const result = await runSeed(
      { ...base, password: "new-password-please" },
      client,
      (l) => lines.push(l),
    );
    expect(client.calls.some(([op]) => op === "createUser")).toBe(false);
    expect(result.generatedPassword).toBeNull();
    expect(lines.join("\n")).toMatch(/--password was ignored/);
    // The name comes from the account when neither the doc nor --name has one.
    expect(client.calls).toContainEqual([
      "setStaffDoc",
      "u1",
      { name: "Asha P", role: "staff" },
    ]);
  });

  it("promotes an existing barista and keeps their name", async () => {
    const client = fakeClient({
      user: { uid: "u1", email: "asha@cafe.com" },
      doc: { name: "Asha", role: "staff" },
    });
    await runSeed({ ...base, role: "owner" }, client, () => {});
    expect(client.calls).toContainEqual([
      "setStaffDoc",
      "u1",
      { name: "Asha", role: "owner" },
    ]);
  });

  it("is a no-op when everything is already right", async () => {
    const client = fakeClient({
      user: { uid: "u1", email: "asha@cafe.com" },
      doc: { name: "asha", role: "staff" },
    });
    const result = await runSeed(base, client, () => {});
    expect(result.wroteDoc).toBe(false);
    expect(writes(client)).toEqual([]);
  });

  it("--dry-run reads but writes nothing, for a new or an existing account", async () => {
    for (const client of [
      fakeClient(),
      fakeClient({ user: { uid: "u1", email: "asha@cafe.com" } }),
    ]) {
      const lines = [];
      const result = await runSeed({ ...base, dryRun: true }, client, (l) =>
        lines.push(l),
      );
      expect(writes(client)).toEqual([]);
      expect(result.wroteDoc).toBe(false);
      expect(lines.join("\n")).toMatch(/nothing was written/);
    }
  });
});
