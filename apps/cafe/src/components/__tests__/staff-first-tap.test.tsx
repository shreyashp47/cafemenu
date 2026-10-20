/**
 * The staff board's first tap. Browsers only allow the order chime after a
 * gesture, so the first tap anywhere switches it on. That used to remove the
 * "Tap anywhere to switch the order sound on" line from the header (and, once
 * kept, swap it for a shorter line that wrapped less at large text sizes),
 * which moved the whole board up between pointerdown and pointerup: the
 * release landed on a different element, no click fired, and the first Accept
 * or Mark ready after opening the board did nothing.
 *
 * jsdom does no layout, so these check the structure that keeps the height
 * fixed (both wordings always rendered, in one grid cell); scripts/flow.mjs
 * step 10a measures the real thing in a browser at 200% text size.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StaffPage from "@/app/staff/page";
import { demoAuthRepo, demoOrderRepo } from "@/lib/data/demo";
import { loadDemoState, resetDemoStore } from "@/lib/data/demo-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const ASK = "Tap anywhere to switch the order sound on.";
const ON = "Order sound on.";

// jsdom has no WebAudio. `resumes` decides whether resume() takes effect: in
// Chrome it does not from a touch pointerdown, only from pointerup or click.
let resumes: (event: string | undefined) => boolean = () => true;
class FakeAudioContext extends EventTarget {
  state: AudioContextState = "suspended";
  resume = vi.fn(async () => {
    if (resumes(window.event?.type)) this.state = "running";
  });
}

beforeEach(async () => {
  resetDemoStore();
  localStorage.clear();
  await demoAuthRepo.signOut();
  resumes = () => true;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const openBoardWithGuest = async () => {
  await demoOrderRepo.create({
    tableNumber: 2,
    items: [{ menuItemId: "m1", name: "Latte", qty: 2, price: 200 }],
    total: 400,
  });
  await demoAuthRepo.signInWithPin("1122");
  render(<StaffPage />);
  return screen.findByRole("button", { name: "Accept" });
};

/** The hint line, and which wording is the one being shown. */
const hintLine = () => screen.getByText(ASK).parentElement!;
const shown = (line: HTMLElement) =>
  [...line.children]
    .filter((el) => !el.hasAttribute("aria-hidden"))
    .map((el) => el.textContent);

describe("staff board: the first tap", () => {
  it("switches the sound on without moving the board, and still presses Accept", async () => {
    const accept = await openBoardWithGuest();
    const line = hintLine();
    expect(shown(line)).toEqual([ASK]);
    // Both wordings are always there, stacked in one cell, so the line is as
    // tall as the longer one whichever is showing.
    expect(line).toHaveClass("grid");
    expect(line.children).toHaveLength(2);
    for (const el of line.children)
      expect(el.className).toContain("[grid-area:1/1]");

    // Press, and let React re-render before the release — as a real finger does.
    await act(async () => {
      fireEvent.pointerDown(accept);
    });

    // Same line, same two children, now showing the other wording.
    expect(line).toBeInTheDocument();
    expect(hintLine()).toBe(line);
    expect(line.children).toHaveLength(2);
    expect(shown(line)).toEqual([ON]);
    expect(screen.getByText(ASK)).toHaveClass("invisible");
    expect(accept).toBeInTheDocument();

    fireEvent.pointerUp(accept);
    fireEvent.click(accept);
    await waitFor(() =>
      expect(loadDemoState().orders[0].status).toBe("preparing"),
    );
  });

  it("keeps asking while the browser has not let the sound start", async () => {
    resumes = () => false; // e.g. a touch pointerdown in Chrome
    const accept = await openBoardWithGuest();
    const line = hintLine();

    await act(async () => {
      fireEvent.pointerDown(accept);
      fireEvent.pointerUp(accept);
      fireEvent.click(accept);
    });

    // Not "Order sound on." while it is still blocked...
    expect(shown(line)).toEqual([ASK]);
    expect(screen.getByText(ON)).toHaveClass("invisible");
    // ...but the tap itself still worked.
    await waitFor(() =>
      expect(loadDemoState().orders[0].status).toBe("preparing"),
    );
  });

  it("switches the sound on from the release when the press was not enough", async () => {
    // Chrome on a phone: pointerdown does not count, pointerup does.
    resumes = (type) => type !== "pointerdown";
    const accept = await openBoardWithGuest();
    const line = hintLine();

    await act(async () => {
      fireEvent.pointerDown(accept);
    });
    expect(shown(line)).toEqual([ASK]);

    await act(async () => {
      fireEvent.pointerUp(accept);
    });
    expect(shown(line)).toEqual([ON]);
  });
});
