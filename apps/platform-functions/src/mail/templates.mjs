/**
 * The emails, as plain text and simple HTML (no images, no scripts, inline
 * styles only, so any mail client shows them). Each takes plain data and
 * returns {subject, text, html}; nothing here reads a database or sends.
 *
 *   release-available   a new version is out, for a cafe that stays on one
 *                       version (optional: the owner can unsubscribe)
 *   upgrade-required    the cafe's version stops being supported: upgrade by
 *                       a date, or be moved (essential)
 *   deploy-failed       an update, roll back, branding sync or setup didn't go
 *                       through, and was rolled back where it could be
 *                       (essential)
 *
 * "Essential" ones are about the cafe's service and are sent whatever the
 * owner has switched off; the others carry an unsubscribe link in the body
 * and in the List-Unsubscribe header (see notify.mjs).
 */

export const EMAIL_KINDS = {
  "release-available": { essential: false },
  "upgrade-required": { essential: true },
  "deploy-failed": { essential: true },
};

const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => escapes[c]);

/** "9 November 2026", in UTC: the date the support window works in. */
export const dateText = (ms) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(ms);

const days = (n) => `${n} day${n === 1 ? "" : "s"}`;

/** One line of an email: `text` for the plain version, `html` for the other. */
const p = (text, html = escapeHtml(text)) => ({ text, html });
/** A paragraph with a link on its own line below it; without a link, just the words. */
const link = (label, url) =>
  url
    ? {
        text: `${label}\n${url}`,
        html: `${escapeHtml(label)}<br><a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
      }
    : p(label);

const SERVICE_NOTE = p(
  "This email is about your cafe's service, so it is sent whatever your email settings are.",
);

function assemble({ subject, paragraphs, footer }) {
  const all = [...paragraphs, footer];
  const text = `${all.map((x) => x.text).join("\n\n")}\n\n-- \nCafeMenu\n`;
  const body = paragraphs
    .map((x) => `<p style="margin:0 0 16px">${x.html}</p>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#f6f4ef;color:#1f2933;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
${body}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e0d6;color:#5f6b76;font-size:14px">${footer.html}</p>
</div>
</body>
</html>
`;
  return { subject, text, html };
}

/** What is at the end of an email an owner may switch off. */
const optionalFooter = ({ cafeName, unsubscribeUrl }) =>
  link(
    `You get this because ${cafeName} stays on one version of CafeMenu. To stop emails like it:`,
    unsubscribeUrl,
  );

const templates = {
  "release-available": ({
    cafeName,
    version,
    line,
    pinnedLine,
    updatesUrl,
    unsubscribeUrl,
  }) =>
    assemble({
      subject: `CafeMenu ${version} is out, and ${cafeName} hasn't been updated to it`,
      paragraphs: [
        p(`CafeMenu ${version} is out.`),
        p(
          `${cafeName} is set to stay on ${pinnedLine}, so it keeps ${pinnedLine} until you decide. Fixes to ${pinnedLine}, security fixes included, still arrive by themselves. ${version} is on a newer line (${line}), so it waits for you.`,
        ),
        link(
          `To move up, open Updates for ${cafeName} and press "Upgrade to ${version}". The notes for ${version} are there too.`,
          updatesUrl,
        ),
      ],
      footer: optionalFooter({ cafeName, unsubscribeUrl }),
    }),

  "upgrade-required": ({
    cafeName,
    line,
    supported,
    newestVersion,
    upgradeBy,
    daysLeft,
    updatesUrl,
  }) => {
    const date = dateText(upgradeBy);
    const lines = supported.join(" and ");
    return assemble({
      subject: `Please upgrade ${cafeName} by ${date}`,
      paragraphs: [
        p(
          `${cafeName} stays on CafeMenu ${line}, which CafeMenu no longer supports. Only the latest two versions are (${lines}), so ${line} no longer gets fixes, security fixes included.`,
        ),
        p(
          `Please upgrade by ${date}${daysLeft > 0 ? ` (${days(daysLeft)} from today)` : ""}. After that day CafeMenu moves cafes still on ${line} to ${newestVersion ?? "the newest version"} itself. Your menu, orders and staff stay as they are: they live in your own project.`,
        ),
        link(
          `To upgrade now, open Updates for ${cafeName} and press "Upgrade to ${newestVersion ?? "…"}". You can go back one version afterwards if you need to.`,
          updatesUrl,
        ),
      ],
      footer: SERVICE_NOTE,
    });
  },

  "deploy-failed": ({
    cafeName,
    kind,
    version,
    fromVersion,
    status,
    error,
    updatesUrl,
  }) => {
    const rolledBack = status === "rolled-back";
    const what =
      {
        deploy: version ? `the update to ${version}` : "the update",
        rollback: version ? `going back to ${version}` : "going back a version",
        branding: "putting your branding on your site",
        provision: "setting up your cafe",
      }[kind] ?? "the update";
    const subject = rolledBack
      ? `${cafeName}: ${what} didn't pass its check and was rolled back`
      : `${cafeName}: ${what} didn't go through`;
    const outcome = rolledBack
      ? `It didn't pass its checks on your live site, so CafeMenu put your site back${fromVersion ? ` on ${fromVersion}` : " as it was"}. Your cafe is working as before.`
      : "It stopped before it finished.";
    return assemble({
      subject,
      paragraphs: [
        p(`CafeMenu tried ${what} for ${cafeName}. ${outcome}`),
        ...(error ? [p(`What went wrong: ${error}`)] : []),
        p(
          "Nothing in your menu, orders or staff list was lost: they live in your own project.",
        ),
        link(`The details are in Updates for ${cafeName}:`, updatesUrl),
      ],
      footer: SERVICE_NOTE,
    });
  },
};

/**
 * The email of `kind` for `data`. Throws on a kind it doesn't know, or when
 * an email that may be switched off is rendered with no unsubscribe link.
 */
export function renderEmail(kind, data) {
  if (!templates[kind]) throw new Error(`No email called "${kind}".`);
  if (!EMAIL_KINDS[kind].essential && !data.unsubscribeUrl) {
    throw new Error(`The "${kind}" email needs an unsubscribe link.`);
  }
  return templates[kind](data);
}
