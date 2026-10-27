/**
 * The owner area as an owner uses it, in demo mode: the updates (choosing,
 * Upgrade, Roll back), the branding form, and the access page.
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
import { DEMO_DEPLOY_ACCOUNT } from "@/lib/config";
import { demoBundle, demoGoLive, demoVerifyEmail } from "@/lib/data/demo";
import { demoRun } from "@/lib/data/demo-deploys";
import { load, mutate, resetDemo } from "@/lib/data/demo-store";
import { CafeArea } from "../CafeArea";

const SLOW = { timeout: 3000 };

async function owner() {
  await demoBundle.auth.signUp("owner@lantern.test", "correct-horse");
  demoVerifyEmail();
}

async function draftCafe() {
  await owner();
  return demoBundle.cafes.create({
    site: "lantern-cafe",
    region: "asia-south1",
    settings: newCafeSettings({
      name: "Lantern Café",
      currency: "INR",
      locale: "en-IN",
      timeZone: "Asia/Kolkata",
    }),
  });
}

async function liveCafe() {
  const cafe = await draftCafe();
  await demoBundle.cafes.connectProject(cafe.id, "lantern-cafe-1a2b");
  demoGoLive(cafe.id);
  return cafe;
}

const stored = () => load().cafes[0];
const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const running = (version: string) =>
  waitFor(
    () =>
      expect(
        within(screen.getByRole("region", { name: "Updates" })).getByText(
          version,
          { selector: "p.font-display" },
        ),
      ).toBeInTheDocument(),
    SLOW,
  );

beforeEach(() => {
  resetDemo();
  demoRun.stepMs = 0;
});

describe("getting in", () => {
  it("asks a signed-out owner to sign in, and shows the cafe", async () => {
    await liveCafe();
    await demoBundle.auth.signOut();
    render(<CafeArea />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "owner@lantern.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse" },
    });
    press("Sign in");
    expect(
      await screen.findByRole("heading", { name: "Lantern Café", level: 1 }),
    ).toBeInTheDocument();
  });

  it("says when the email is not confirmed, and when there is no cafe", async () => {
    await demoBundle.auth.signUp("owner@lantern.test", "correct-horse");
    const { unmount } = render(<CafeArea />);
    expect(
      await screen.findByRole("heading", { name: "Confirm your email first" }),
    ).toBeInTheDocument();
    unmount();
    demoVerifyEmail();
    render(<CafeArea />);
    expect(
      await screen.findByRole("heading", { name: "No cafe yet" }),
    ).toBeInTheDocument();
  });

  it("sends a cafe that isn't set up back to setup, and lets the demo skip it", async () => {
    await draftCafe();
    render(<CafeArea />);
    expect(
      await screen.findByRole("heading", {
        name: "Lantern Café isn't set up yet",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Carry on with setup" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/setup\?cafe=/));
    press("Pretend setup finished");
    expect(
      await screen.findByRole("heading", { name: "Updates" }),
    ).toBeInTheDocument();
    expect(stored().status).toBe("live");
  });
});

describe("the cafe", () => {
  it("shows the cafe, where its dashboard is, and each section", async () => {
    await liveCafe();
    render(<CafeArea />);
    expect(
      await screen.findByRole("heading", { name: "Lantern Café", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    // Demo mode has no real site to send anyone to.
    expect(
      screen.getByText("https://lantern-cafe.web.app/admin"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open your dashboard/ }),
    ).toBeNull();
    for (const name of ["Updates", "Branding and locale", "Access"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("tells a cafe whose access was removed what that means", async () => {
    await liveCafe();
    mutate((state) => {
      state.cafes[0].status = "disconnected";
    });
    render(<CafeArea />);
    expect(
      await screen.findByText(/access to your project was removed/),
    ).toBeInTheDocument();
    // Nothing can be deployed to it.
    expect(
      screen.getByText("You can change these once your cafe is live."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /^Upgrade to/ }),
    ).toBeDisabled();
  });
});

describe("updates", () => {
  it("offers the newer stable release with its notes, and upgrades", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");
    expect(
      await screen.findByRole("heading", { name: "1.1.1 is available" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("What's new in 1.1.1"));
    expect(
      screen.getByText(/Sample release for demo mode\. A patch/),
    ).toBeVisible();

    press("Upgrade to 1.1.1");
    expect(await screen.findByText(/^Asked\./)).toBeInTheDocument();
    await running("1.1.1");
    expect(stored().release).toMatchObject({
      current: "1.1.1",
      previous: "1.1.0",
    });
    expect(screen.getByRole("status", { name: "Latest" })).toHaveTextContent(
      "Upgrade from 1.1.0 to 1.1.1",
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole("status", { name: "Latest" }),
        ).toHaveTextContent("Done"),
      SLOW,
    );
    expect(screen.getByText("You're up to date.")).toBeInTheDocument();
  });

  it("rolls back one version, after asking", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");
    // Nothing to roll back to on the first version.
    expect(
      screen.getByText("There is no earlier version to go back to yet."),
    ).toBeInTheDocument();
    press("Upgrade to 1.1.1");
    await running("1.1.1");
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Roll back to 1.1.0" }),
        ).toBeEnabled(),
      SLOW,
    );

    press("Roll back to 1.1.0");
    const confirm = screen.getByRole("group", { name: "Roll back to 1.1.0?" });
    // Cancelling does nothing.
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(stored().release.current).toBe("1.1.1");

    press("Roll back to 1.1.0");
    fireEvent.click(screen.getByRole("button", { name: "Yes, roll back" }));
    await running("1.1.0");
    expect(stored().release).toMatchObject({
      current: "1.1.0",
      previous: null,
    });
    expect(
      await screen.findByText("There is no earlier version to go back to yet."),
    ).toBeInTheDocument();
  });

  it("moves the line a cafe that stays on one is on when it upgrades past it", async () => {
    await liveCafe();
    await demoBundle.cafes.chooseRelease(stored().id, {
      channel: "stable",
      pinned: "1.1",
    });
    render(<CafeArea />);
    await running("1.1.0");
    // The newer patch of its own line comes first, and keeps it there.
    press("Upgrade to 1.1.1");
    await running("1.1.1");
    expect(stored().release.pinned).toBe("1.1");
  });

  it("saves the way the cafe follows releases", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");
    const save = screen.getByRole("button", { name: "Save choice" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Update automatically \(beta\)/));
    fireEvent.click(save);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(stored().release).toMatchObject({ channel: "beta", pinned: null });

    fireEvent.click(screen.getByLabelText(/Stay on 1\.1/));
    fireEvent.click(screen.getByRole("button", { name: "Save choice" }));
    await waitFor(() => expect(stored().release.pinned).toBe("1.1"), SLOW);
    // The channel it was on is kept.
    expect(stored().release.channel).toBe("beta");
  });

  it("cannot stay on a line before anything is running", async () => {
    const cafe = await draftCafe();
    await demoBundle.cafes.connectProject(cafe.id, "lantern-cafe-1a2b");
    mutate((state) => {
      state.cafes[0].status = "live";
    });
    render(<CafeArea />);
    await screen.findByRole("heading", { name: "Updates" });
    expect(screen.getByLabelText(/Stay on/)).toBeDisabled();
    expect(
      screen.getByText(/The first version goes on when setup finishes/),
    ).toBeInTheDocument();
  });
});

describe("branding and locale", () => {
  it("saves the settings, and asks for them to go on the site", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");

    fireEvent.change(screen.getByLabelText("Cafe name"), {
      target: { value: "Lantern House" },
    });
    fireEvent.change(screen.getByLabelText("Tagline"), {
      target: { value: "Slow coffee" },
    });
    fireEvent.click(screen.getByLabelText(/Bistro/));
    fireEvent.change(screen.getByLabelText("Time zone"), {
      target: { value: "Asia/Dubai" },
    });
    press("Save and update my site");
    expect(
      await screen.findByText(/Saved\. Your site is being updated/),
    ).toBeInTheDocument();

    expect(stored().settings).toMatchObject({
      name: "Lantern House",
      tagline: "Slow coffee",
      theme: "bistro",
      timeZone: "Asia/Dubai",
      utcOffsets: { standard: 240, daylight: 240 },
    });
    // The heading follows, and the request is in the list.
    expect(
      await screen.findByRole("heading", { name: "Lantern House", level: 1 }),
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(
          screen.getByRole("status", { name: "Latest" }),
        ).toHaveTextContent("Branding and locale put on your site"),
      SLOW,
    );
    // Nothing else is touched: not the version, nor the plan.
    expect(stored().release.current).toBe("1.1.0");
    expect(stored().settings.plan).toBe("free");
  });

  it("names what is wrong, and does not save", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");
    fireEvent.change(screen.getByLabelText("Cafe name"), {
      target: { value: "  " },
    });
    press("Save and update my site");
    expect(
      await screen.findByText("Give your cafe's name."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Cafe name")).toHaveFocus();
    expect(stored().settings.name).toBe("Lantern Café");
    expect(load().deployments).toHaveLength(0);
  });

  it("holds an accent that is too light, as sign-up does", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");
    fireEvent.click(screen.getByLabelText("My own colour"));
    fireEvent.change(screen.getByLabelText("Colour code"), {
      target: { value: "#F5B041" },
    });
    expect(await screen.findByText(/Too light to read/)).toBeInTheDocument();
    press("Save and update my site");
    expect(
      await screen.findByText(
        "Pick a colour that passes, or use the suggested one.",
      ),
    ).toBeInTheDocument();
    expect(stored().settings.accent).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Use #/ }));
    press("Save and update my site");
    await waitFor(() => expect(stored().settings.accent).not.toBeNull(), SLOW);
  });

  it("makes a change of currency be acknowledged first", async () => {
    await liveCafe();
    render(<CafeArea />);
    await running("1.1.0");
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "USD" },
    });
    expect(
      screen.getByText("Changing the currency doesn't convert your prices."),
    ).toBeInTheDocument();
    press("Save and update my site");
    expect(
      await screen.findByText("Tick the box to confirm."),
    ).toBeInTheDocument();
    expect(stored().settings.currency).toBe("INR");

    fireEvent.click(screen.getByLabelText("I'll update my menu prices myself"));
    press("Save and update my site");
    await waitFor(() => expect(stored().settings.currency).toBe("USD"), SLOW);
  });

  it("replaces the logo and removes it", async () => {
    await liveCafe();
    const png = new Uint8Array(64);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    mutate((state) => {
      state.cafes[0].settings.logo = "/logo.png";
    });
    await demoBundle.setup.saveLogo(stored().id, png);
    render(<CafeArea />);
    await running("1.1.0");
    expect(
      screen.getByText(
        "Your site has a logo now. Choose a file to replace it.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText("Remove my logo and use the theme's artwork"),
    );
    press("Save and update my site");
    await waitFor(() => expect(stored().settings.logo).toBeNull(), SLOW);
    expect(await demoBundle.setup.getLogo(stored().id)).toBeNull();
  });

  it("holds Save while an update is on its way", async () => {
    await liveCafe();
    demoRun.stepMs = 60_000;
    render(<CafeArea />);
    await running("1.1.0");
    press("Upgrade to 1.1.1");
    expect(
      await screen.findByRole("button", { name: "Save and update my site" }),
    ).toBeDisabled();
    expect(
      screen.getAllByText(/An update is already on its way/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Upgrade to 1.1.1" }),
    ).toBeDisabled();
  });
});

describe("access", () => {
  it("says what CafeMenu can do, how to check it and how to leave", async () => {
    await liveCafe();
    render(<CafeArea />);
    const access = await screen.findByRole("region", { name: "Access" });
    expect(within(access).getByText(DEMO_DEPLOY_ACCOUNT)).toBeInTheDocument();
    expect(access).toHaveTextContent("can technically read your orders");
    expect(
      within(access).getByRole("link", { name: /Google Cloud IAM page/ }),
    ).toHaveAttribute(
      "href",
      "https://console.cloud.google.com/iam-admin/iam?project=lantern-cafe-1a2b",
    );
    expect(access).toHaveTextContent("Press Remove access, then confirm.");
    expect(access).toHaveTextContent(
      "Your site keeps running on its last release",
    );
    expect(access).toHaveTextContent("Updates and security fixes stop.");
  });
});
