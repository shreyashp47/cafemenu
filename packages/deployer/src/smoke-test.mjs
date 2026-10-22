/**
 * The check that a freshly deployed cafe works, run after Hosting and before
 * the deploy is recorded as current.
 *
 * TODO(#22): the real test (load the site, read config/site, place and cancel
 * a test order). Until then it only says it was skipped. A failure throws;
 * the site is live by then, so the deploy is still recorded as current (as
 * failed), and `deployer rollback` goes back to the release before it.
 */
export async function smokeTest(ctx, { site, version }) {
  ctx.log.step("Smoke test");
  ctx.log.info(`skipped for ${version} on ${site}.web.app: comes with #22`);
  return { skipped: true };
}
