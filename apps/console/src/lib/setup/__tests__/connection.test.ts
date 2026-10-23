import { describe, expect, it } from "vitest";
import {
  fromDeployerCheck,
  pendingConnectionChecker,
  simulatedConnectionChecker,
} from "../connection";

describe("the deployer's answer", () => {
  it("is connected when nothing is missing", () => {
    expect(fromDeployerCheck({ ok: true, missing: {} })).toEqual({
      status: "connected",
    });
  });

  it("names each missing permission once, with every command that needs it", () => {
    expect(
      fromDeployerCheck({
        ok: false,
        missing: {
          provision: [
            {
              permission: "firebasehosting.sites.get",
              why: "see whether the Hosting site exists",
            },
            {
              permission: "datastore.databases.create",
              why: "create the Firestore database",
            },
          ],
          deploy: [
            {
              permission: "firebasehosting.sites.get",
              why: "read the live Hosting version",
            },
          ],
        },
      }),
    ).toEqual({
      status: "missing",
      missing: [
        {
          permission: "firebasehosting.sites.get",
          why: "see whether the Hosting site exists",
          neededBy: ["provision", "deploy"],
        },
        {
          permission: "datastore.databases.create",
          why: "create the Firestore database",
          neededBy: ["provision"],
        },
      ],
    });
  });
});

describe("the stand-in check", () => {
  const check = (projectId: string) =>
    simulatedConnectionChecker().check({ id: "c1", projectId });

  it("connects any project, except the two that show a failure", async () => {
    expect(await check("lantern-cafe-1a2b")).toEqual({ status: "connected" });
    expect(await check("lantern-noaccess")).toEqual({ status: "no-access" });
    const missing = await check("lantern-missing");
    expect(missing.status).toBe("missing");
    expect(
      missing.status === "missing" && missing.missing.length,
    ).toBeGreaterThan(0);
  });
});

it("against the real platform, says it is not there yet", async () => {
  await expect(
    pendingConnectionChecker.check({ id: "c1", projectId: "lantern-cafe" }),
  ).rejects.toMatchObject({ code: "unimplemented" });
});
