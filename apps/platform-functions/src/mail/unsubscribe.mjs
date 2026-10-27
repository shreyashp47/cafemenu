/**
 * The unsubscribe link in the emails an owner may switch off.
 *
 *   GET  ?c=<cafe>&t=<token>   a page that says what the link does, with a button
 *   POST ?c=<cafe>&t=<token>   does it: `emails.releaseNotices` on the cafe
 *                              becomes false. A body of `action=subscribe`
 *                              turns them back on. A mail client's one-click
 *                              unsubscribe (RFC 8058) is a POST with
 *                              `List-Unsubscribe=One-Click`.
 *
 * A GET never changes anything, because mail scanners and link previews fetch
 * every link in an email. The token is the cafe's own, kept where no browser
 * can read it (`cafes/{id}/private/mail`), so the link works without signing
 * in and for that cafe only. Only the release emails can be switched off;
 * failures and required upgrades always go.
 */
const CAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => escapes[c]);

function page(status, { title, text, button }) {
  const form = button
    ? `<form method="post"><input type="hidden" name="action" value="${button.action}"><button type="submit" style="font:inherit;padding:10px 18px;border:0;border-radius:6px;background:#1f6f5c;color:#fff;cursor:pointer">${escapeHtml(button.label)}</button></form>`
    : "";
  return {
    status,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f6f4ef;color:#1f2933;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<main style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px">${escapeHtml(text)}</p>
${form}
</main></body></html>
`,
  };
}

const INVALID = {
  title: "This link doesn't work",
  text: "It may be incomplete or out of date. You can switch these emails off from any email of this kind.",
};

/**
 * `{method, query, body}` of the request → `{status, html}`. `env.store` needs
 * checkMailToken, getCafe and setEmailPreference.
 */
export async function handleUnsubscribe(env, { method, query = {}, body }) {
  if (method !== "GET" && method !== "POST") {
    return page(405, INVALID);
  }
  const cafeId = typeof query.c === "string" ? query.c : "";
  const token = typeof query.t === "string" ? query.t : "";
  if (
    !CAFE_ID.test(cafeId) ||
    !token ||
    !(await env.store.checkMailToken(cafeId, token))
  ) {
    return page(404, INVALID);
  }
  const cafe = await env.store.getCafe(cafeId);
  if (!cafe) return page(404, INVALID);
  const name = cafe.settings?.name || cafe.site;

  if (method === "POST") {
    const resubscribe = body?.action === "subscribe";
    await env.store.setEmailPreference(cafeId, {
      releaseNotices: resubscribe,
    });
    return resubscribe
      ? page(200, {
          title: "Emails are back on",
          text: `${name} will get an email when a new version of CafeMenu is out.`,
          button: { action: "unsubscribe", label: "Stop them again" },
        })
      : page(200, {
          title: "You're unsubscribed",
          text: `${name} won't get emails about new versions any more. You'll still get the ones about problems with your site and about upgrades that are required.`,
          button: { action: "subscribe", label: "Turn them back on" },
        });
  }

  return cafe.emails?.releaseNotices === false
    ? page(200, {
        title: "These emails are off",
        text: `${name} doesn't get emails about new versions. You'll still get the ones about problems with your site and about upgrades that are required.`,
        button: { action: "subscribe", label: "Turn them back on" },
      })
    : page(200, {
        title: "Stop emails about new versions?",
        text: `${name} stays on one version of CafeMenu, so we email you when a newer one is out. You'll still get the ones about problems with your site and about upgrades that are required.`,
        button: { action: "unsubscribe", label: "Unsubscribe" },
      });
}

/** The headers every page of the function is sent with. */
export const UNSUBSCRIBE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
