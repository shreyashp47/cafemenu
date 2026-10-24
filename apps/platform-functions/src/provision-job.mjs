/**
 * Setting a cafe up for the first time: what the onboarding wizard waits for
 * after "Check connection" passes (PLAN.md, the owner's step 5). The deployer
 * does the work, one command per step:
 *
 *   check      `deployer check`: may the deploy account do everything below?
 *   provision  `deployer provision`: APIs, database, sign-in, web app, site
 *   deploy     `deployer deploy --version <current release>` with the cafe's
 *              settings and logo
 *   menu       the starting menu (seed.mjs)
 *   owner      `deployer owner`: the owner's account and set-password email
 *
 * Every step reads before it writes, so running the job again finishes what
 * a failed run left. Steps a run already finished are skipped when the same
 * deployment is picked up again, and re-checked (cheaply) in a new one.
 */
import {
  UsageError,
  check,
  deployRelease,
  owner,
  provision,
} from "@cafemenu/deployer";

import { MissingAccessError, RetryLater } from "./errors.mjs";
import { withRetry } from "./retry.mjs";
import { seedStartingMenu } from "./seed.mjs";

/** How long one invocation works before handing over (Cloud Functions stops events at 9 minutes). */
export const BUDGET_MS = 7.5 * 60_000;

/** The owner's name on the staff board: their account's name, else their email's first part. */
export function ownerName(displayName, email) {
  const name = (displayName ?? "").trim() || email.split("@")[0].trim();
  return (name || "Owner").slice(0, 80);
}

export async function provisionCafe({
  env,
  cafe,
  deployment,
  progress,
  ctx,
  inputs,
  startedAt,
}) {
  const { settings } = cafe;
  const result = {};

  async function step(id, fn) {
    if (progress.status(id) === "done") return;
    if (env.now().getTime() - startedAt > BUDGET_MS) {
      throw new RetryLater("Out of time for one invocation: carry on later.");
    }
    // A step that throws stays `running`: the worker decides whether that
    // makes it failed (the run ends) or pending again (the run is retried).
    progress.begin(id);
    await withRetry(fn, {
      sleep: env.sleep,
      onRetry: (error, attempt) =>
        progress.say(`Google was slow; trying again (${attempt})`),
    });
    progress.done(id);
  }

  await step("check", async () => {
    const answer = await check(ctx, {
      commands: ["provision", "deploy", "owner"],
    });
    if (!answer.ok) throw new MissingAccessError(answer.missing);
  });

  await step("provision", async () => {
    if (!cafe.region) {
      throw new UsageError(
        "No place was chosen for the cafe's database (its region).",
      );
    }
    const done = await provision(ctx, { region: cafe.region, site: cafe.site });
    result.siteUrl = done.siteUrl;
  });

  await step("deploy", () =>
    deployRelease(ctx, {
      release: true,
      site: cafe.site,
      version: deployment.version,
      settings: inputs.settingsPath,
      logo: inputs.logoPath,
    }),
  );

  await step("menu", async () => {
    const shared = await env.loadShared();
    await seedStartingMenu(ctx, {
      menu: await env.store.getStartingMenu(cafe.id),
      settings,
      shared,
    });
  });

  await step("owner", async () => {
    const name = await env.store.getOwnerName(cafe.ownerUid);
    const done = await owner(ctx, {
      email: cafe.ownerEmail,
      name: ownerName(name, cafe.ownerEmail),
    });
    result.ownerEmailSent = done.emailed;
  });

  return {
    ...result,
    siteUrl: result.siteUrl ?? `https://${cafe.site}.web.app`,
  };
}
