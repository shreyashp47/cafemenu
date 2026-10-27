/**
 * The super admin (#78, docs/super-admin-requirements.md section 7), in demo
 * mode, where the backend answers at once: one cafe's history; suspend and
 * reactivate (the owner's sign-in refused, then back); a reason with notice;
 * delete with the typed address, keeping the log; maintenance on one cafe
 * and on several, resumable and revertable; the admin log; the admins; and
 * what an owner can't reach. The worker does the same against the real
 * rules in apps/platform-functions/tests/emulator/admin.emulator.mjs.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { newCafeSettings } from "@cafemenu/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_ADMIN } from "@/lib/config";
import { savePlan } from "@/lib/admin/bulk";
import { EMPTY_MAINTENANCE } from "@/lib/admin/actions";
import { demoBundle, demoGoLive, demoVerifyEmail } from "@/lib/data/demo";
import { load, mutate, resetDemo } from "@/lib/data/demo-store";
import { CafeArea } from "@/components/owner/CafeArea";
import { AdminActions } from "../AdminActions";
import { AdminArea } from "../AdminArea";

const SLOW = { timeout: 3000 };
const OWNER = { email: "owen@lantern.test", password: "correct-horse" };

const press = (name: string | RegExp, scope = screen) =>
  fireEvent.click(scope.getByRole("button", { name }));
const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const type = pick;

/** The owner, signed in again as a session that outlived a change would be. */
const asOwner = () =>
  mutate((state) => {
    state.session =
      state.accounts.find((a) => a.email === OWNER.email)?.uid ?? null;
  });

/** An owner with a live cafe, signed out. */
async function ownerWithCafe() {
  await demoBundle.auth.signUp(OWNER.email, OWNER.password);
  demoVerifyEmail();
  const cafe = await demoBundle.cafes.create({
    site: "lantern-cafe",
    region: "asia-south1",
    settings: newCafeSettings({
      name: "Lantern Café",
      timeZone: "Asia/Kolkata",
    }),
  });
  await demoBundle.cafes.connectProject(cafe.id, "lantern-cafe-1a2b");
  demoGoLive(cafe.id);
  await demoBundle.auth.signOut();
  return cafe;
}

const signInAdmin = () =>
  demoBundle.auth.signIn(DEMO_ADMIN.email, DEMO_ADMIN.password);

async function openCafe(name: string) {
  render(<AdminArea />);
  fireEvent.click(await screen.findByRole("button", { name: `Open ${name}` }));
  return screen.findByRole("heading", { name, level: 2 });
}

const lantern = () => load().cafes.find((c) => c.site === "lantern-cafe");

beforeEach(() => resetDemo());

describe("one cafe's history", () => {
  it("shows its deployments, maintenance windows and emails, filtered", async () => {
    await signInAdmin();
    await openCafe("Orchard Tea House (sample)");
    const history = await screen.findByRole("region", { name: "History" });
    await within(history).findByText(/Roll back to 1.0.0: /);
    expect(history).toHaveTextContent("Maintenance on, by admin@cafemenu.demo");
    expect(history).toHaveTextContent(
      "Reason: A platform migration: Moving prices to paise (#21).",
    );
    expect(history).toHaveTextContent(
      "Email to the owner: A deployment failed",
    );

    press("Maintenance", within(history) as typeof screen);
    expect(within(history).getByText("Maintenance windows")).toBeVisible();
    expect(within(history).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(history).not.toHaveTextContent("Roll back to 1.0.0");

    press("Emails", within(history) as typeof screen);
    expect(history).toHaveTextContent("Email to the owner: Maintenance off");
    expect(history).not.toHaveTextContent("by admin@cafemenu.demo");

    press("Back to every owner and cafe");
    expect(
      await screen.findByRole("heading", {
        name: "Owners and cafes",
        level: 2,
      }),
    ).toBeInTheDocument();
  });
});

describe("suspend and reactivate", () => {
  it("refuses the owner's sign-in with the reason, then lets them back", async () => {
    await ownerWithCafe();
    await signInAdmin();
    await openCafe("Lantern Café");
    pick("What to do", "suspend");
    press("Suspend");
    expect(await screen.findByText("Pick a reason.")).toBeVisible();
    pick("Reason", "abuse");
    type("Note", "Spam orders from many tables.");
    press("Suspend");
    expect(await screen.findByText(/^Asked\./)).toBeVisible();

    expect(lantern()?.status).toBe("suspended");
    const history = screen.getByRole("region", { name: "History" });
    await waitFor(
      () =>
        expect(history).toHaveTextContent("Suspended, by admin@cafemenu.demo"),
      SLOW,
    );
    expect(history).toHaveTextContent("Email to the owner: Account suspended");
    // On the cafe, on its entry in the history, and in the admin log.
    expect(
      screen.getAllByText(
        "Reason: Abuse of the service: Spam orders from many tables.",
      ),
    ).toHaveLength(3);
    expect(load().adminLog[0]).toMatchObject({
      action: "suspend",
      cafeId: lantern()?.id,
      reason: { code: "abuse", note: "Spam orders from many tables." },
    });

    // The owner can't sign in, and the words say why.
    await expect(
      demoBundle.auth.signIn(OWNER.email, OWNER.password),
    ).rejects.toMatchObject({ code: "auth/user-disabled" });

    // Reactivate undoes it.
    await signInAdmin();
    pick("What to do", "reactivate");
    pick("Reason", "resolved");
    press("Reactivate");
    await screen.findByText(/^Asked\./);
    expect(lantern()?.status).toBe("live");
    await demoBundle.auth.signIn(OWNER.email, OWNER.password);
  });

  it("tells a suspended owner at sign-in why they can't", async () => {
    await ownerWithCafe();
    await signInAdmin();
    await demoBundle.directory.ask({
      cafeId: lantern()?.id ?? "",
      kind: "suspend",
      params: { reason: "abuse", note: "", effectiveAt: null },
    });
    await demoBundle.auth.signOut();
    render(<CafeArea />);
    type("Email", OWNER.email);
    type("Password", OWNER.password);
    press("Sign in");
    expect(
      await screen.findByText(/This CafeMenu account is suspended/),
    ).toBeVisible();
  });

  it("tells a suspended owner who is still signed in, with the reason", async () => {
    await ownerWithCafe();
    await signInAdmin();
    const cafe = lantern();
    await demoBundle.directory.ask({
      cafeId: cafe?.id ?? "",
      kind: "suspend",
      params: { reason: "security", note: "", effectiveAt: null },
    });
    // As an owner whose session outlives the suspension would see it.
    asOwner();
    render(<CafeArea />);
    expect(
      await screen.findByText(/CafeMenu's maintainer has paused your cafe/),
    ).toBeVisible();
    expect(screen.getByText("Why: A security problem.")).toBeVisible();
  });

  it("holds a reason with notice to its date, and reactivating calls it off", async () => {
    await ownerWithCafe();
    await signInAdmin();
    await openCafe("Lantern Café");
    pick("What to do", "suspend");
    pick("Reason", "non-payment");
    expect(screen.getByText(/Non-payment needs 7 days' notice/)).toBeVisible();
    // The date starts at the earliest it may be.
    expect(
      (screen.getByLabelText("Takes effect") as HTMLInputElement).value,
    ).not.toBe("");
    press("Suspend");
    await screen.findByText(/^Asked\./);
    expect(lantern()?.status).toBe("live");
    const waiting = load().requests[0];
    expect(waiting).toMatchObject({ kind: "suspend", status: "queued" });
    expect(waiting.notBefore).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const history = screen.getByRole("region", { name: "History" });
    await waitFor(
      () =>
        expect(history).toHaveTextContent(
          /Request: Suspend, waiting for the backend\s*Waiting until/,
        ),
      SLOW,
    );
    expect(history).toHaveTextContent(
      "Email to the owner: Notice of suspension",
    );

    pick("What to do", "reactivate");
    pick("Reason", "payment-received");
    press("Reactivate");
    await screen.findByText(/^Asked\./);
    expect(load().requests.find((r) => r.id === waiting.id)).toMatchObject({
      status: "failed",
      errorCode: "cancelled",
    });
  });
});

describe("delete", () => {
  it("asks for the web address, reminds about access, and keeps the log", async () => {
    await ownerWithCafe();
    await signInAdmin();
    await openCafe("Lantern Café");
    pick("What to do", "delete-owner");
    expect(
      screen.getByText(/remove CafeMenu's deploy account from the project/),
    ).toHaveTextContent("lantern-cafe-1a2b");
    pick("Reason", "owner-request");
    type("Type the cafe's web address to confirm", "lantern");
    press("Delete for good");
    expect(
      await screen.findByText("That isn't this cafe's web address."),
    ).toBeVisible();
    expect(lantern()).toBeDefined();

    type("Type the cafe's web address to confirm", "lantern-cafe.web.app");
    press("Delete for good");
    await waitFor(() => expect(lantern()).toBeUndefined(), SLOW);
    expect(load().accounts.some((a) => a.email === OWNER.email)).toBe(false);
    expect(load().adminLog[0]).toMatchObject({
      action: "delete-owner",
      details: { site: "lantern-cafe", projectId: "lantern-cafe-1a2b" },
    });
    await expect(
      demoBundle.auth.signIn(OWNER.email, OWNER.password),
    ).rejects.toMatchObject({ code: "auth/invalid-credential" });

    press("Back to every owner and cafe");
    const log = await screen.findByRole("region", { name: "Admin log" });
    expect(log).toHaveTextContent("Deleted the owner: lantern-cafe.web.app");
  });
});

describe("maintenance", () => {
  it("turns it on for one cafe, which the owner sees, and off again", async () => {
    await ownerWithCafe();
    await signInAdmin();
    await openCafe("Lantern Café");
    pick("What to do", "maintenance-on");
    pick("Reason", "migration");
    type("Message for customers", "Back after a short update.");
    press("Turn maintenance on");
    await screen.findByText(/^Asked\./);
    expect(lantern()?.maintenance).toMatchObject({
      on: true,
      by: "admin",
      message: "Back after a short update.",
      reason: { code: "migration" },
    });
    expect(
      await screen.findByText(/CafeMenu's maintenance is on, since/),
    ).toBeVisible();
    expect(load().emails[0]).toMatchObject({ kind: "maintenance-on" });

    // The owner's console says so, and why.
    asOwner();
    const owner = render(<CafeArea />);
    expect(
      await screen.findByText(
        /CafeMenu has put your site into maintenance \(A platform migration\)/,
      ),
    ).toBeVisible();
    owner.unmount();

    await signInAdmin();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Lantern Café" }),
    );
    pick("What to do", "maintenance-off");
    press("Turn maintenance off");
    await screen.findByText(/^Asked\./);
    expect(lantern()?.maintenance).toBeNull();
  });

  it("schedules it on the cafe's clock", async () => {
    await ownerWithCafe();
    await signInAdmin();
    await openCafe("Lantern Café");
    pick("What to do", "maintenance-on");
    pick("Reason", "security");
    type("Starts", "2099-01-01T22:00");
    type("Ends by itself", "2099-01-02T02:00");
    press("Turn maintenance on");
    await screen.findByText(/^Asked\./);
    expect(lantern()?.maintenance).toMatchObject({
      startsAt: Date.UTC(2099, 0, 1, 16, 30),
      endsAt: Date.UTC(2099, 0, 1, 20, 30),
    });
    expect(
      await screen.findByText(/CafeMenu's maintenance starts/),
    ).toBeVisible();
  });

  it("does several cafes in one batch, and reverts it", async () => {
    await signInAdmin();
    render(<AdminArea />);
    fireEvent.click(
      await screen.findByLabelText(
        "Select Harbour Beans (sample) for maintenance",
      ),
    );
    fireEvent.click(
      screen.getByLabelText("Select The Lamp Room (sample) for maintenance"),
    );
    // A draft has no site to put into maintenance.
    expect(
      screen.queryByLabelText("Select Moss & Mortar (sample) for maintenance"),
    ).toBeNull();
    expect(screen.getByText("2 cafes selected")).toBeVisible();
    press("Maintenance for the selected…");
    const bulk = await screen.findByRole("region", {
      name: "Maintenance on several cafes",
    });
    expect(bulk).toHaveTextContent(
      "For: Harbour Beans (sample), The Lamp Room (sample)",
    );
    fireEvent.change(within(bulk).getByLabelText("Reason"), {
      target: { value: "migration" },
    });
    press("Ask for 2 cafes", within(bulk) as typeof screen);

    await waitFor(() => {
      const on = load().cafes.filter((c) => c.maintenance?.on);
      expect(on.map((c) => c.id).sort()).toEqual([
        "sample-harbour",
        "sample-lamp",
      ]);
    }, SLOW);
    const batch = load().cafes.find((c) => c.id === "sample-harbour")
      ?.maintenance?.batch;
    expect(batch).toMatch(/^batch-/);
    const batches = await screen.findByRole("region", {
      name: "Maintenance on several cafes",
    });
    await waitFor(
      () =>
        expect(batches).toHaveTextContent(
          "2 done · 0 waiting · 0 failed · 0 not asked",
        ),
      SLOW,
    );

    press("Revert", within(batches) as typeof screen);
    await waitFor(
      () => expect(load().cafes.filter((c) => c.maintenance?.on)).toEqual([]),
      SLOW,
    );
  });

  it("resumes a batch the page stopped partway through", async () => {
    await signInAdmin();
    const startedAt = Date.now();
    const plan = {
      batch: "batch-cut-off",
      kind: "maintenance-on" as const,
      cafeIds: ["sample-harbour", "sample-lamp", "sample-corner"],
      form: { ...EMPTY_MAINTENANCE, reason: "migration" },
      startedAt,
    };
    savePlan(plan, startedAt);
    // Only the first was asked before the page closed.
    await demoBundle.directory.ask({
      cafeId: "sample-harbour",
      kind: "maintenance-on",
      params: {
        reason: "migration",
        note: "",
        message: "",
        until: null,
        startsAt: null,
        endsAt: null,
        batch: "batch-cut-off",
      },
    });
    render(<AdminArea />);
    const bulk = await screen.findByRole("region", {
      name: "Maintenance on several cafes",
    });
    await waitFor(
      () =>
        expect(bulk).toHaveTextContent(
          "1 done · 0 waiting · 0 failed · 2 not asked",
        ),
      SLOW,
    );
    press("Resume", within(bulk) as typeof screen);
    await waitFor(
      () =>
        expect(bulk).toHaveTextContent(
          "3 done · 0 waiting · 0 failed · 0 not asked",
        ),
      SLOW,
    );
    expect(
      load()
        .cafes.filter((c) => c.maintenance?.batch === "batch-cut-off")
        .map((c) => c.id)
        .sort(),
    ).toEqual(["sample-corner", "sample-harbour", "sample-lamp"]);
  });
});

describe("the admin log and the admins", () => {
  it("lists every action, filters it, and offers no way to change it", async () => {
    await ownerWithCafe();
    await signInAdmin();
    const cafeId = lantern()?.id ?? "";
    await demoBundle.directory.ask({
      cafeId,
      kind: "suspend",
      params: { reason: "abuse", note: "", effectiveAt: null },
    });
    await demoBundle.directory.ask({
      cafeId,
      kind: "reactivate",
      params: { reason: "made-in-error", note: "Wrong cafe." },
    });
    render(<AdminArea />);
    const log = await screen.findByRole("region", { name: "Admin log" });
    await within(log).findByText("Reactivated: Lantern Café");
    expect(log).toHaveTextContent("Suspended: Lantern Café");
    expect(log).toHaveTextContent("Owner: owen@lantern.test");
    expect(log).toHaveTextContent("Reason: Made in error: Wrong cafe.");
    expect(log).toHaveTextContent("Maintenance on: Orchard Tea House (sample)");

    fireEvent.change(within(log).getByLabelText("Action"), {
      target: { value: "suspend" },
    });
    expect(within(log).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(within(log).getByLabelText("Action"), {
      target: { value: "all" },
    });
    fireEvent.change(within(log).getByLabelText("Find in the log"), {
      target: { value: "wrong cafe" },
    });
    expect(within(log).getAllByRole("listitem")).toHaveLength(1);
    // Read-only: the only button is the export.
    expect(
      within(log)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Download the log as CSV (1)"]);
  });

  it("lists the admins, keeps the last one, and has appointing off", async () => {
    await signInAdmin();
    render(<AdminArea />);
    const admins = await screen.findByRole("region", { name: "Admins" });
    expect(admins).toHaveTextContent(`${DEMO_ADMIN.email} (you)`);
    expect(admins).toHaveTextContent("The only admin can't be removed.");
    expect(within(admins).queryByRole("button")).toBeNull();
    expect(admins).toHaveTextContent(/Appointing more admins is off for now/);
    // And the backend refuses it too.
    await demoBundle.directory.ask({
      cafeId: null,
      kind: "appoint-admin",
      params: { email: "ada@platform.test", note: "" },
    });
    expect(load().requests[0]).toMatchObject({
      status: "failed",
      errorCode: "failed-precondition",
    });
  });
});

describe("what an owner can't reach", () => {
  it("refuses an owner the directory, the log and every admin action", async () => {
    await ownerWithCafe();
    await demoBundle.auth.signIn(OWNER.email, OWNER.password);
    const cafeId = lantern()?.id ?? "";
    await expect(
      demoBundle.directory.ask({
        cafeId,
        kind: "maintenance-off",
        params: { note: "", batch: null },
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const refused = await new Promise<string>((resolve) => {
      const stop = demoBundle.directory.subscribeLog(
        10,
        () => resolve("read"),
        (error) => resolve((error as { code?: string }).code ?? "error"),
      );
      setTimeout(stop, 0);
    });
    expect(refused).toBe("permission-denied");
    const owners = await new Promise<string>((resolve) => {
      const stop = demoBundle.directory.subscribeOwners(
        () => resolve("read"),
        (error) => resolve((error as { code?: string }).code ?? "error"),
      );
      setTimeout(stop, 0);
    });
    expect(owners).toBe("permission-denied");
  });

  it("offers no actions where the backend can't take them", () => {
    const row = {
      key: "c1",
      cafe: {
        id: "c1",
        ownerUid: "u1",
        ownerEmail: "o@x.test",
        projectId: "p-1",
        site: "c1",
        region: null,
        settings: newCafeSettings({ name: "C1" }),
        release: {
          channel: "stable" as const,
          pinned: null,
          current: null,
          previous: null,
        },
        status: "live" as const,
        createdAt: 1,
        updatedAt: 1,
      },
      owner: null,
      ownerUid: "u1",
      email: "o@x.test",
      status: "active" as const,
      health: null,
      last: null,
      smoke: null,
      maintenance: "off" as const,
    };
    render(
      <AdminActions
        data={{
          ...demoBundle,
          directory: { ...demoBundle.directory, canAct: false },
        }}
        row={row}
        ownerIsAdmin={false}
      />,
    );
    expect(screen.getByText(/only reads/)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
