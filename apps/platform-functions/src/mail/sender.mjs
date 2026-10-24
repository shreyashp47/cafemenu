/**
 * Sending an email, behind one small interface so the rest of the backend
 * doesn't know which provider is behind it:
 *
 *   MailSender {
 *     name,                      "log" | "resend"
 *     send({to, subject, text, html, headers?}) → Promise<{id}>
 *   }
 *
 * `to` is one address; `headers` is an object of extra headers (the
 * List-Unsubscribe pair). `send` throws a MailError when the email was not
 * accepted. `id` is the provider's reference, or null.
 *
 * The log sender, the default, writes the email to the function's log and
 * sends it to nobody: what the emulators and a platform with no provider
 * set up use. The Resend sender is the one real provider (resend.com's free
 * tier covers a few thousand emails a month, far more than this sends); the
 * interface is small enough that SendGrid would be another thirty lines.
 */

export class MailError extends Error {
  name = "MailError";

  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

export function createLogMailSender({ log }) {
  return {
    name: "log",
    async send({ to, subject, text, headers }) {
      log("info", `Email to ${to}: ${subject}`, {
        mail: { to, subject, headers: headers ?? null, text },
      });
      return { id: null };
    },
  };
}

export const RESEND_URL = "https://api.resend.com/emails";

export function createResendMailSender({
  apiKey,
  from,
  fetchImpl = fetch,
  url = RESEND_URL,
}) {
  return {
    name: "resend",
    async send({ to, subject, text, html, headers }) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject,
            text,
            html,
            ...(headers && { headers }),
          }),
        });
      } catch (error) {
        throw new MailError(`Resend could not be reached: ${error.message}`);
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new MailError(
          `Resend refused the email (${res.status}): ${detail}`,
          { status: res.status },
        );
      }
      const body = await res.json().catch(() => ({}));
      return { id: typeof body.id === "string" ? body.id : null };
    },
  };
}

/** The sender `config` (mail/config.mjs) asks for. */
export function createMailSender(config, { log, fetchImpl } = {}) {
  return config.provider === "resend"
    ? createResendMailSender({
        apiKey: config.apiKey,
        from: config.from,
        fetchImpl,
      })
    : createLogMailSender({ log });
}
