/**
 * The platform admin as the maintainer uses it, in demo mode: who may see
 * it, the cafes and how they are doing, publishing a release, the rollout
 * buttons, and the audit log. And what is not there to use.
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
import { demoBundle, demoVerifyEmail } from "@/lib/data/demo";
import { load, mutate, resetDemo } from "@/lib/data/demo-store";
import { AdminArea } from "../AdminArea";

const SLOW = { timeout: 3000 };

const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

async function signInAdmin() {
  await demoBundle.auth.signIn(DEMO_ADMIN.email, DEMO_ADMIN.password);
}

/** The card of the sample cafe called `name`. */
const card = async (name: string) =>
  (
    await screen.findByRole("heading", { name: `${name} (sample)`, level: 3 })
  ).closest("article") as HTMLElement;

beforeEach(() => resetDemo());

describe("who sees it", () => {
  it("asks a signed-out visitor to sign in, and lets the admin in", async () => {
    render(<AdminArea />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: DEMO_ADMIN.email },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: DEMO_ADMIN.password },
    });
    press("Sign in");
    expect(
      await screen.findByRole("heading", {
        name: "Owners and cafes",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sample admin/)).toBeInTheDocument();
  });

  it("turns an owner away, without any cafe's data", async () => {
    await demoBundle.auth.signUp("owner@lantern.test", "correct-horse");
    demoVerifyEmail();
    await demoBundle.cafes.create({
      site: "lantern-cafe",
      region: "asia-south1",
      settings: newCafeSettings({ name: "Lantern Café" }),
    });
    render(<AdminArea />);
    expect(
      await screen.findByRole("heading", {
        name: "This page is for CafeMenu's maintainer",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Lantern Café/)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Owners and cafes" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Admin log" })).toBeNull();
  });
});

/** Picks `value` in the directory's filter called `label`. */
const filterBy = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the owners and cafes", () => {
  it("shows each with how it is doing, those that need a look first", async () => {
    await signInAdmin();
    render(<AdminArea />);
    const cards = await screen.findAllByRole("article");
    // The seven sample cafes, then the admin's own account, which has none.
    expect(cards.length).toBe(8);
    // Orchard's latest deployment failed its smoke test and was rolled back;
    // Tide's owner removed access.
    const names = cards.map(
      (c) => within(c).getByRole("heading", { level: 3 }).textContent,
    );
    expect(names.slice(0, 2).sort()).toEqual([
      "Orchard Tea House (sample)",
      "Tide & Toast (sample)",
    ]);
    expect(names.at(-1)).toBe(DEMO_ADMIN.email);
    expect(
      screen.getByText(
        "8 owners · 7 cafes · 4 live · 0 suspended · 0 in maintenance · 2 need a look",
      ),
    ).toBeInTheDocument();

    const orchard = within(await card("Orchard Tea House"));
    expect(orchard.getByText("Needs a look")).toBeInTheDocument();
    expect(
      orchard.getByText(/failed its check and was rolled back/),
    ).toBeInTheDocument();
    expect(orchard.getByText(/Failed, /)).toBeInTheDocument();
    expect(orchard.getByText("Version").nextElementSibling).toHaveTextContent(
      "1.1.0",
    );
    // The owner: name and email, sign-up, last sign-in; the cafe's project.
    expect(
      orchard.getByText("Ravi Menon, owner4@sample.test"),
    ).toBeInTheDocument();
    expect(orchard.getByText("orchard-tea-1a23")).toBeInTheDocument();
    expect(orchard.getByText("Signed up")).toBeInTheDocument();
    expect(orchard.getByText("Last console sign-in")).toBeInTheDocument();
    expect(orchard.getByText("Free")).toBeInTheDocument();

    const harbour = within(await card("Harbour Beans"));
    expect(harbour.getByText("Healthy")).toBeInTheDocument();
    expect(harbour.getByText(/Passed, /)).toBeInTheDocument();
    const lamp = within(await card("The Lamp Room"));
    expect(lamp.getByText("Beta")).toBeInTheDocument();
    const corner = within(await card("Corner Pantry"));
    expect(corner.getByText("Stays on 1.0")).toBeInTheDocument();
    const juniper = within(await card("Juniper Kitchen"));
    expect(juniper.getByText("In progress")).toBeInTheDocument();
    expect(juniper.getByText("Not deployed yet")).toBeInTheDocument();
    const moss = within(await card("Moss & Mortar"));
    expect(moss.getByText("Not set up")).toBeInTheDocument();
  });

  it("filters by status, maintenance, plan, channel and health", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");

    filterBy("Health", "attention");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    filterBy("Release channel", "beta");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    filterBy("Health", "all");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    filterBy("Release channel", "pinned");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    press("Clear filters");
    expect(screen.getAllByRole("article")).toHaveLength(8);
    filterBy("Account", "suspended");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    filterBy("Account", "active");
    filterBy("Maintenance", "on");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    filterBy("Maintenance", "off");
    filterBy("Plan", "free");
    // Every cafe is on the free plan; the admin's account has no cafe.
    expect(screen.getAllByRole("article")).toHaveLength(7);
  });

  it("searches by email, name, web address and project ID", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    const search = (value: string) =>
      fireEvent.change(screen.getByLabelText("Find an owner or cafe"), {
        target: { value },
      });
    const headings = () =>
      screen
        .getAllByRole("article")
        .map((a) => within(a).getByRole("heading", { level: 3 }).textContent);

    search("juniper");
    expect(headings()).toEqual(["Juniper Kitchen (sample)"]);
    search("owner3@");
    expect(headings()).toEqual(["Corner Pantry (sample)"]);
    search("Mei Lin");
    expect(headings()).toEqual(["Corner Pantry (sample)"]);
    search("https://lamp-room.web.app/");
    expect(headings()).toEqual(["The Lamp Room (sample)"]);
    search("tide-and-toast-1a24");
    expect(headings()).toEqual(["Tide & Toast (sample)"]);
    search("zzz");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  });

  it("downloads what it shows as CSV", async () => {
    const created: Blob[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return "blob:csv";
    };
    URL.revokeObjectURL = () => {};
    try {
      await signInAdmin();
      render(<AdminArea />);
      await card("Harbour Beans");
      filterBy("Health", "attention");
      press("Download the list as CSV (2)");
      expect(created).toHaveLength(1);
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(created[0]);
      });
      const lines = text.replace(/^\uFEFF/, "").split("\r\n");
      expect(lines[0]).toMatch(/^owner_name,owner_email,/);
      expect(lines).toHaveLength(3);
      expect(text).toContain("owner4@sample.test");
    } finally {
      URL.createObjectURL = original;
    }
  });

  it("changes as the data does", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    mutate((state) => {
      for (const d of state.deployments.filter(
        (x) => x.cafeId === "sample-harbour",
      )) {
        d.status = "failed";
        d.error = "Hosting refused the release.";
      }
    });
    const harbour = within(await card("Harbour Beans"));
    await waitFor(
      () => expect(harbour.getByText("Needs a look")).toBeInTheDocument(),
      SLOW,
    );
  });
});

describe("publishing a release", () => {
  it("says what is wrong, and does not publish", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "1.1.1" },
    });
    press("Publish release");
    expect(
      await screen.findByText("That version is already published."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Write what changed, for the owners who read it."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Version")).toHaveFocus();
    expect(load().releases.some((r) => r.notes.includes("Orders"))).toBe(false);
  });

  it("keeps a pre-release out of stable", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "1.3.0-beta.1" },
    });
    fireEvent.click(screen.getByLabelText(/^Stable/));
    fireEvent.change(screen.getByLabelText("Release notes"), {
      target: { value: "Something." },
    });
    press("Publish release");
    expect(
      await screen.findByText("A pre-release can only go to beta."),
    ).toBeInTheDocument();
  });

  it("publishes, and lists it with a rollout not yet started", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    // The schema starts at the newest release's.
    await waitFor(
      () => expect(screen.getByLabelText("Database schema")).toHaveValue("3"),
      SLOW,
    );
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "1.3.0" },
    });
    fireEvent.change(screen.getByLabelText("Release notes"), {
      target: { value: "## What's new\n\n- Orders show who asked." },
    });
    press("Publish release");
    expect(await screen.findByText(/Published 1\.3\.0/)).toBeInTheDocument();
    expect(load().releases.find((r) => r.version === "1.3.0")).toMatchObject({
      channel: "beta",
      schemaVersion: 3,
      notes: "## What's new\n\n- Orders show who asked.",
      withdrawn: false,
    });
    expect(
      await screen.findByRole("button", { name: "Start the rollout of 1.3.0" }),
    ).toBeInTheDocument();
    // The form is ready for the next one.
    expect(screen.getByLabelText("Version")).toHaveValue("");
  });
});

describe("rollouts, a stub", () => {
  it("starts, pauses and resumes by hand", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    // 1.1.1 completed: nothing to press. The beta is running.
    expect(
      screen.queryByRole("button", { name: /rollout of 1\.1\.1/ }),
    ).toBeNull();
    press("Pause the rollout of 1.2.0-beta.1");
    await waitFor(
      () => expect(load().rollouts["1.2.0-beta.1"]).toBe("paused"),
      SLOW,
    );
    press("Resume the rollout of 1.2.0-beta.1");
    await waitFor(
      () => expect(load().rollouts["1.2.0-beta.1"]).toBe("running"),
      SLOW,
    );
    press("Start the rollout of 1.1.0");
    await waitFor(() => expect(load().rollouts["1.1.0"]).toBe("running"), SLOW);
    expect(screen.getByText(/stub for the rollout waves/)).toBeInTheDocument();
  });
});

describe("the audit log", () => {
  it("lists who asked what, when and how it went", async () => {
    await signInAdmin();
    render(<AdminArea />);
    const log = await screen.findByRole("region", { name: "Deployments" });
    const items = within(log).getAllByRole("listitem");
    expect(items.length).toBe(12);
    expect(log).toHaveTextContent("Asked by owner1@sample.test");
    expect(log).toHaveTextContent("A rollout");
    expect(log).toHaveTextContent("The admin");
    expect(log).toHaveTextContent("Deploy 1.1.1, from 1.1.0");
    expect(log).toHaveTextContent("Roll back to 1.0.0");
    expect(log).toHaveTextContent("Branding sync");
    expect(log).toHaveTextContent(
      /The smoke test failed on https:\/\/orchard-tea/,
    );
    expect(log).toHaveTextContent("Smoke test: Failed");
  });

  it("narrows to a cafe, or to what didn't go through", async () => {
    await signInAdmin();
    render(<AdminArea />);
    const log = await screen.findByRole("region", { name: "Deployments" });
    await within(log).findAllByRole("listitem");
    fireEvent.click(
      within(log).getByLabelText("Only those that didn't go through"),
    );
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      within(log).getByLabelText("Only those that didn't go through"),
    );
    fireEvent.change(within(log).getByLabelText("Cafe"), {
      target: { value: "sample-harbour" },
    });
    expect(within(log).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("what is not there", () => {
  it("has no way to sign in as an owner or open an order", async () => {
    await signInAdmin();
    render(<AdminArea />);
    await card("Harbour Beans");
    const controls = [
      ...screen.queryAllByRole("button"),
      ...screen.queryAllByRole("link"),
    ].map((el) => el.textContent ?? "");
    for (const label of controls) {
      expect(label).not.toMatch(
        /sign in as|impersonate|log in as|orders|view as/i,
      );
    }
    expect(
      screen.getByText(
        /no way to sign in as an owner or to see a cafe's orders/,
      ),
    ).toBeInTheDocument();
  });
});
