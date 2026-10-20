/**
 * Plans and their features (issue #17). The only plan, "free", has every
 * feature, so nothing changes for any cafe; the CSV download on
 * /admin/reports is the one feature asked for through `features()` so far.
 */

import * as shared from "@cafemenu/shared";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReportsPage from "@/app/admin/reports/page";
import { DataProvider } from "@/components/providers/DataProvider";
import { demoAuthRepo } from "@/lib/data/demo";
import { demoSeedOrders, resetDemoStore } from "@/lib/data/demo-store";
import { buildSampleOrders } from "@/lib/data/sample-orders";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

// A real module with one function swappable, so a test can stand in a plan
// without the feature. Every other export is the real one.
vi.mock("@cafemenu/shared", async (original) => {
  const real = await original<typeof import("@cafemenu/shared")>();
  return { ...real, features: vi.fn(real.features) };
});

const { features: realFeatures } =
  await vi.importActual<typeof import("@cafemenu/shared")>("@cafemenu/shared");

beforeEach(async () => {
  vi.mocked(shared.features).mockReset().mockImplementation(realFeatures);
  resetDemoStore();
  demoSeedOrders(buildSampleOrders(40));
  await demoAuthRepo.signIn(
    DEMO_CREDENTIALS.owner.email,
    DEMO_CREDENTIALS.owner.password,
  );
});

function openReports() {
  render(
    <DataProvider>
      <ReportsPage />
    </DataProvider>,
  );
  return screen.findByRole("heading", { name: "Best sellers" });
}

describe("the CSV download, through the plan's features", () => {
  it("is there on the free plan, as it always was", async () => {
    await openReports();
    expect(screen.getByRole("button", { name: "CSV" })).toBeVisible();
    expect(shared.features).toHaveBeenCalledWith({ plan: "free" });
  });

  it("goes, with every mention of it, for a plan without it", async () => {
    vi.mocked(shared.features).mockReturnValue({ csvExport: false });
    await openReports();
    expect(screen.queryByRole("button", { name: "CSV" })).toBeNull();
    expect(screen.queryByText(/in the CSV/)).toBeNull();
  });
});
