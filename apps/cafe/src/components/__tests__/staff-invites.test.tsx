/**
 * Staff invites (issue #15), on the demo store: the helpers in
 * src/lib/invites.ts, the demo repository refusing what firestore.rules
 * refuses, the owner's Staff page and the /join page.
 * scripts/rules-test.mjs is the same story against the real rules.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StaffAdminPage from "@/app/admin/staff/page";
import JoinPage from "@/app/join/page";
import { DataProvider } from "@/components/providers/DataProvider";
import { demoAuthRepo, demoStaffRepo } from "@/lib/data/demo";
import {
  demoRemoveStaff,
  demoSaveInvite,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import type { StaffUser } from "@/lib/data/types";
import {
  INVITE_TTL_MS,
  generateInviteId,
  inviteIdFromHash,
  inviteLink,
  inviteState,
  isInviteId,
  isLastOwner,
  parseInvite,
  parseStaffMember,
} from "@/lib/invites";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/staff",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(async () => {
  resetDemoStore();
  localStorage.clear();
  window.location.hash = "";
  await demoAuthRepo.signOut();
});

const asOwner = () =>
  demoAuthRepo.signIn(
    DEMO_CREDENTIALS.owner.email,
    DEMO_CREDENTIALS.owner.password,
  );

function sessionNow(): StaffUser | null {
  let user: StaffUser | null = null;
  demoAuthRepo.subscribe((u) => (user = u))();
  return user;
}

describe("invite helpers", () => {
  it("makes unguessable ids the rules accept", () => {
    const a = generateInviteId();
    expect(a).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(isInviteId(a)).toBe(true);
    expect(generateInviteId()).not.toBe(a);
    expect(isInviteId("abc123")).toBe(false);
  });

  it("puts the id in the link's fragment and reads it back", () => {
    const id = generateInviteId();
    const link = inviteLink("https://toe.web.app/", id);
    expect(link).toBe(`https://toe.web.app/join#${id}`);
    expect(inviteIdFromHash(new URL(link).hash)).toBe(id);
    expect(inviteIdFromHash("")).toBeNull();
    expect(inviteIdFromHash("#short")).toBeNull();
  });

  it("works for seven days, once", () => {
    const invite = { createdAt: 1_000, usedBy: null };
    expect(inviteState(invite, 1_000 + INVITE_TTL_MS - 1)).toBe("open");
    expect(inviteState(invite, 1_000 + INVITE_TTL_MS)).toBe("expired");
    expect(inviteState({ ...invite, usedBy: "u1" }, 1_001)).toBe("used");
  });

  it("parses documents the way the rules read them", () => {
    const id = generateInviteId();
    const ts = { toMillis: () => 5_000 };
    expect(
      parseInvite(id, { role: "owner", createdAt: ts, usedBy: null }),
    ).toEqual({ id, role: "owner", createdAt: 5_000, usedBy: null });
    expect(parseInvite(id, { role: "admin", createdAt: 1 })).toBeNull();
    expect(parseInvite(id, { role: "staff", createdAt: null })).toBeNull();
    expect(parseInvite("abc", { role: "staff", createdAt: 1 })).toBeNull();
    // seed:staff records have no email; a typo'd role is still staff.
    expect(parseStaffMember("u1", { role: "Owner" })).toEqual({
      uid: "u1",
      name: "No name",
      email: null,
      role: "staff",
    });
  });

  it("knows the last owner", () => {
    const owner = { uid: "a", name: "A", email: null, role: "owner" as const };
    const barista = { ...owner, uid: "b", role: "staff" as const };
    expect(isLastOwner([owner, barista], "a")).toBe(true);
    expect(isLastOwner([owner, barista], "b")).toBe(false);
    expect(isLastOwner([owner, { ...owner, uid: "c" }], "a")).toBe(false);
  });
});

describe("demo store: invites as the rules allow them", () => {
  it("lets a new account join once, with exactly the invite's role", async () => {
    await asOwner();
    const invite = await demoStaffRepo.createInvite("staff");
    await demoAuthRepo.signOut();

    await demoAuthRepo.signUp("asha@cafe.test", "secret1");
    expect(sessionNow()?.role).toBe("unassigned");
    await expect(demoStaffRepo.join(invite.id, "  Asha  ")).resolves.toBe(
      "staff",
    );
    expect(sessionNow()).toMatchObject({ role: "staff", displayName: "Asha" });

    // The same link a second time, by someone else.
    await demoAuthRepo.signOut();
    await demoAuthRepo.signUp("ravi@cafe.test", "secret1");
    await expect(demoStaffRepo.join(invite.id, "Ravi")).rejects.toMatchObject({
      code: "permission-denied",
    });

    // The account works on its own afterwards.
    await demoAuthRepo.signOut();
    await demoAuthRepo.signIn("asha@cafe.test", "secret1");
    expect(sessionNow()?.role).toBe("staff");
  });

  it("refuses an expired or cancelled invite, and a second one", async () => {
    await asOwner();
    const old = generateInviteId();
    demoSaveInvite({
      id: old,
      role: "staff",
      createdAt: Date.now() - INVITE_TTL_MS - 1,
      usedBy: null,
    });
    const cancelled = await demoStaffRepo.createInvite("owner");
    await demoStaffRepo.deleteInvite(cancelled.id);
    const fresh = await demoStaffRepo.createInvite("owner");
    await demoAuthRepo.signOut();

    await demoAuthRepo.signUp("asha@cafe.test", "secret1");
    await expect(demoStaffRepo.join(old, "Asha")).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(demoStaffRepo.join(cancelled.id, "Asha")).rejects.toThrow();
    // Someone already on the team cannot use an invite to change role.
    await demoAuthRepo.signOut();
    await demoAuthRepo.signInWithPin("1122");
    await expect(demoStaffRepo.join(fresh.id, "Barista")).rejects.toThrow();
    expect(sessionNow()?.role).toBe("staff");
  });

  it("is owner-only to manage", async () => {
    await demoAuthRepo.signInWithPin("1122");
    await expect(demoStaffRepo.createInvite("owner")).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(demoStaffRepo.setRole("demo-staff", "owner")).rejects.toThrow(
      /permissions/,
    );
    const onError = vi.fn();
    demoStaffRepo.subscribeInvites(vi.fn(), onError);
    expect(onError).toHaveBeenCalled();
  });

  it("sends a removed person to 'not set up yet', live", async () => {
    await demoAuthRepo.signInWithPin("1122");
    const seen: Array<string | undefined> = [];
    const off = demoAuthRepo.subscribe((u) => seen.push(u?.role));
    // The owner removing them from another tab: the same store, written
    // straight (demoStaffRepo.remove would check this tab's session).
    demoRemoveStaff("demo-staff");
    off();
    expect(seen).toEqual(["staff", "unassigned"]);
    // They keep their login.
    await demoAuthRepo.signOut();
    await demoAuthRepo.signInWithPin("1122");
    expect(sessionNow()?.role).toBe("unassigned");
  });
});

describe("owner's Staff page and /join", () => {
  it("makes a link that a new barista joins with", async () => {
    const user = userEvent.setup();
    await asOwner();
    render(<StaffAdminPage />, { wrapper: DataProvider });

    const team = await screen.findByRole("heading", { name: "Team" });
    const teamCard = team.closest("div") as HTMLElement;
    expect(within(teamCard).getByText("Barista")).toBeVisible();
    expect(within(teamCard).getByText("Cafe Owner")).toBeVisible();
    // The only owner can't remove or demote themselves.
    expect(within(teamCard).getByText(/You're the only owner/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Make invite link" }));
    const field = await screen.findByLabelText("Staff invite link");
    const link = (field as HTMLInputElement).value;
    expect(link).toMatch(/\/join#[A-Za-z0-9]{24}$/);
    expect(await screen.findByText("Expires in 7 days")).toBeVisible();

    await demoAuthRepo.signOut();
    window.location.hash = new URL(link).hash;
    render(<JoinPage />);
    await user.type(await screen.findByLabelText("Your name"), "Asha");
    await user.type(screen.getByLabelText("Email"), "asha@cafe.test");
    await user.type(screen.getByLabelText(/^Password/), "secret1");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome, Asha!" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open the order board" }),
    ).toHaveAttribute("href", "/staff");
    const record = Object.values(loadDemoState().staff).find(
      (m) => m.email === "asha@cafe.test",
    );
    expect(record).toMatchObject({ name: "Asha", role: "staff" });
  });

  it("says when a link no longer works", async () => {
    window.location.hash = `#${generateInviteId()}`;
    render(<JoinPage />);
    expect(
      await screen.findByRole("heading", {
        name: "This invite doesn't work any more",
      }),
    ).toBeVisible();
  });

  it("removes someone after a confirmation", async () => {
    const user = userEvent.setup();
    await asOwner();
    render(<StaffAdminPage />, { wrapper: DataProvider });
    const row = (await screen.findByText("Barista")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    await user.click(
      within(row).getAllByRole("button", { name: "Remove" }).at(-1)!,
    );
    await waitFor(() =>
      expect(loadDemoState().staff["demo-staff"]).toBeUndefined(),
    );
  });
});
