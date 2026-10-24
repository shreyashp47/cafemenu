/**
 * Which mail provider the platform sends through, and where the links in an
 * email point. All of it comes from the function's environment, so nothing in
 * the repository is secret:
 *
 *   MAIL_PROVIDER     "log" (the default: emails are written to the function's
 *                     log and sent to nobody) or "resend"
 *   MAIL_FROM         with resend: the sender, such as
 *                     "CafeMenu <hello@your-domain>" (a domain Resend verified)
 *   RESEND_API_KEY    with resend: the API key. A secret: `firebase
 *                     functions:secrets:set RESEND_API_KEY`, never a file.
 *   CONSOLE_URL       the console's address, for "open your cafe" links
 *   UNSUBSCRIBE_URL   the `unsubscribe` function's address; without it the
 *                     emails an owner may switch off are not sent at all
 *
 * Under the Functions emulator the last two default to local addresses.
 */

const PROVIDERS = ["log", "resend"];

/** A URL setting: https (or http on this machine), with no trailing slash. */
function urlSetting(name, value) {
  const text = value?.trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} isn't a web address: ${text}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`${name} must be an https address: ${text}`);
  }
  return text.replace(/\/+$/, "");
}

/** The settings from `env` (process.env), checked. Throws an Error that says what to set. */
export function mailConfig(env = process.env) {
  const provider = (env.MAIL_PROVIDER?.trim() || "log").toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new Error(
      `MAIL_PROVIDER is one of ${PROVIDERS.join(", ")}, not "${provider}".`,
    );
  }
  const from = env.MAIL_FROM?.trim() || null;
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  if (provider === "resend" && !(from && apiKey)) {
    throw new Error(
      "MAIL_PROVIDER=resend needs MAIL_FROM and the RESEND_API_KEY secret.",
    );
  }
  const emulator = env.FUNCTIONS_EMULATOR === "true";
  const region = env.CAFEMENU_REGION || "us-central1";
  return {
    provider,
    from,
    apiKey,
    consoleUrl:
      urlSetting("CONSOLE_URL", env.CONSOLE_URL) ??
      (emulator ? "http://localhost:3100" : null),
    unsubscribeUrl:
      urlSetting("UNSUBSCRIBE_URL", env.UNSUBSCRIBE_URL) ??
      (emulator && env.GCLOUD_PROJECT
        ? `http://127.0.0.1:5101/${env.GCLOUD_PROJECT}/${region}/unsubscribe`
        : null),
  };
}
