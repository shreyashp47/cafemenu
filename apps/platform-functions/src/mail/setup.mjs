import { mailConfig } from "./config.mjs";
import { MailError, createMailSender } from "./sender.mjs";

/**
 * The `env.mail` the notifications use: {sender, consoleUrl, unsubscribeUrl}.
 * A setting that doesn't add up (Resend chosen with no key) must not break
 * the deploys and callables that share the runtime, so it is logged once and
 * every email then fails with the same words, which `notify` logs too.
 */
export function createMail(settings, { log, fetchImpl } = {}) {
  try {
    const config = mailConfig(settings);
    return {
      sender: createMailSender(config, { log, fetchImpl }),
      consoleUrl: config.consoleUrl,
      unsubscribeUrl: config.unsubscribeUrl,
    };
  } catch (error) {
    log("error", `Email is not set up: ${error.message}`);
    return {
      sender: {
        name: "unconfigured",
        send: async () => {
          throw new MailError(error.message);
        },
      },
      consoleUrl: null,
      unsubscribeUrl: null,
    };
  }
}
