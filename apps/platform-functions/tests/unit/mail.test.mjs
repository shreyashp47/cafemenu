/**
 * Owner emails (#34, #35): the sender and its settings, the templates, who is
 * emailed when a release or a deployment is written, and the unsubscribe
 * link. Everything runs on the in-memory store and a recording sender.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mailConfig } from "../../src/mail/config.mjs";
import { notifyDeployment, notifyRelease } from "../../src/mail/notify.mjs";
import {
  MailError,
  RESEND_URL,
  createLogMailSender,
  createMailSender,
  createResendMailSender,
} from "../../src/mail/sender.mjs";
import { createMail } from "../../src/mail/setup.mjs";
import { renderEmail } from "../../src/mail/templates.mjs";
import {
  UNSUBSCRIBE_HEADERS,
  handleUnsubscribe,
} from "../../src/mail/unsubscribe.mjs";
import { SETTINGS, draftCafe, testEnv } from "../helpers/env.mjs";

const DAY = 86_400_000;
const at = (iso) => Date.parse(iso);

describe("the settings", () => {
  it("send nothing by default, and need no secret to do so", () => {
    const config = mailConfig({});
    assert.equal(config.provider, "log");
    assert.equal(config.unsubscribeUrl, null);
    assert.equal(config.consoleUrl, null);
  });

  it("choose Resend only with a sender and a key", () => {
    assert.throws(
      () => mailConfig({ MAIL_PROVIDER: "resend" }),
      /needs MAIL_FROM and the RESEND_API_KEY secret/,
    );
    const config = mailConfig({
      MAIL_PROVIDER: "Resend",
      MAIL_FROM: "CafeMenu <hello@cafemenu.example>",
      RESEND_API_KEY: "re_test",
      CONSOLE_URL: "https://console.cafemenu.example/",
      UNSUBSCRIBE_URL: "https://platform.example/unsubscribe",
    });
    assert.equal(config.provider, "resend");
    assert.equal(config.consoleUrl, "https://console.cafemenu.example");
  });

  it("refuse a provider they don't know and addresses that aren't https", () => {
    assert.throws(() => mailConfig({ MAIL_PROVIDER: "smtp" }), /MAIL_PROVIDER/);
    assert.throws(
      () => mailConfig({ CONSOLE_URL: "http://console.example" }),
      /must be an https address/,
    );
    assert.throws(
      () => mailConfig({ UNSUBSCRIBE_URL: "not a url" }),
      /isn't a web address/,
    );
    assert.equal(
      mailConfig({ CONSOLE_URL: "http://localhost:3100" }).consoleUrl,
      "http://localhost:3100",
    );
  });

  it("point at the local functions and console under the emulator", () => {
    const config = mailConfig({
      FUNCTIONS_EMULATOR: "true",
      GCLOUD_PROJECT: "demo-cafemenu",
    });
    assert.equal(
      config.unsubscribeUrl,
      "http://127.0.0.1:5101/demo-cafemenu/us-central1/unsubscribe",
    );
    assert.equal(config.consoleUrl, "http://localhost:3100");
  });

  it("don't break the runtime when they're wrong: every email fails, saying why", async () => {
    const logs = [];
    const mail = createMail(
      { MAIL_PROVIDER: "resend" },
      { log: (level, message) => logs.push([level, message]) },
    );
    assert.match(logs[0][1], /Email is not set up: MAIL_PROVIDER=resend needs/);
    await assert.rejects(mail.sender.send({ to: "a@b.example" }), MailError);
    assert.equal(mail.unsubscribeUrl, null);
  });
});

describe("the senders", () => {
  const email = {
    to: "owner@example.com",
    subject: "Hello",
    text: "Plain",
    html: "<p>Rich</p>",
    headers: { "List-Unsubscribe": "<https://x.example/u>" },
  };

  it("log the email and send it to nobody, by default", async () => {
    const logs = [];
    const sender = createMailSender(mailConfig({}), {
      log: (level, message, fields) => logs.push({ level, message, fields }),
    });
    assert.equal(sender.name, "log");
    assert.deepEqual(await sender.send(email), { id: null });
    assert.match(logs[0].message, /Email to owner@example\.com: Hello/);
    assert.equal(logs[0].fields.mail.text, "Plain");
  });

  it("hand Resend the email, with the key in the header only", async () => {
    const calls = [];
    const sender = createResendMailSender({
      apiKey: "re_secret",
      from: "CafeMenu <hello@cafemenu.example>",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, json: async () => ({ id: "abc-123" }) };
      },
    });
    assert.deepEqual(await sender.send(email), { id: "abc-123" });
    const [{ url, init }] = calls;
    assert.equal(url, RESEND_URL);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer re_secret");
    assert.deepEqual(JSON.parse(init.body), {
      from: "CafeMenu <hello@cafemenu.example>",
      to: ["owner@example.com"],
      subject: "Hello",
      text: "Plain",
      html: "<p>Rich</p>",
      headers: { "List-Unsubscribe": "<https://x.example/u>" },
    });
    assert.ok(!init.body.includes("re_secret"));
  });

  it("report a refusal or an unreachable Resend as a MailError, without the key", async () => {
    const refused = createResendMailSender({
      apiKey: "re_secret",
      from: "x@y.example",
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        text: async () => '{"message":"domain not verified"}',
      }),
    });
    await assert.rejects(refused.send(email), (error) => {
      assert.ok(error instanceof MailError);
      assert.equal(error.status, 422);
      assert.match(
        error.message,
        /refused the email \(422\).*domain not verified/,
      );
      assert.ok(!error.message.includes("re_secret"));
      return true;
    });
    const down = createResendMailSender({
      apiKey: "k",
      from: "x@y.example",
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    await assert.rejects(down.send(email), /could not be reached/);
  });

  it("are chosen by the settings", () => {
    const resend = createMailSender(
      mailConfig({
        MAIL_PROVIDER: "resend",
        MAIL_FROM: "a@b.example",
        RESEND_API_KEY: "k",
      }),
    );
    assert.equal(resend.name, "resend");
    assert.equal(createLogMailSender({ log() {} }).name, "log");
  });
});

describe("the emails", () => {
  const links = {
    updatesUrl: "https://console.example/cafe/#updates",
    unsubscribeUrl: "https://platform.example/unsubscribe?c=cafe1&t=tok",
  };

  it("announce a release, plainly, with the way to stop them", () => {
    const mail = renderEmail("release-available", {
      cafeName: "Lantern Café",
      version: "1.5.0",
      line: "1.5",
      pinnedLine: "1.4",
      ...links,
    });
    assert.match(mail.subject, /CafeMenu 1\.5\.0 is out/);
    assert.match(mail.text, /stay on 1\.4.*Fixes to 1\.4.*still arrive/s);
    assert.match(mail.text, /Upgrade to 1\.5\.0/);
    assert.ok(mail.text.includes(links.updatesUrl));
    assert.ok(mail.text.includes(links.unsubscribeUrl));
    assert.ok(mail.html.includes(`href="${links.updatesUrl}"`));
    assert.ok(
      mail.html.includes(
        `href="${links.unsubscribeUrl.replace(/&/g, "&amp;")}"`,
      ),
    );
  });

  it("say what is required, by when, and that it can't be switched off", () => {
    const mail = renderEmail("upgrade-required", {
      cafeName: "Lantern Café",
      line: "1.3",
      supported: ["1.5", "1.4"],
      newestVersion: "1.5.1",
      upgradeBy: at("2026-11-09"),
      daysLeft: 17,
      ...links,
    });
    assert.equal(
      mail.subject,
      "Please upgrade Lantern Café by 9 November 2026",
    );
    assert.match(mail.text, /no longer supports.*1\.5 and 1\.4/s);
    assert.match(mail.text, /by 9 November 2026 \(17 days from today\)/);
    assert.match(mail.text, /moves cafes still on 1\.3 to 1\.5\.1/);
    assert.match(mail.text, /sent whatever your email settings are/);
    assert.ok(!mail.text.includes("unsubscribe"));
    assert.ok(!mail.html.includes("unsubscribe"));
  });

  it("say it is one day, not 1 days", () => {
    const mail = renderEmail("upgrade-required", {
      cafeName: "C",
      line: "1.3",
      supported: ["1.5", "1.4"],
      newestVersion: "1.5.1",
      upgradeBy: at("2026-11-09"),
      daysLeft: 1,
      ...links,
    });
    assert.match(mail.text, /\(1 day from today\)/);
  });

  it("tell a rolled-back deploy from one that failed", () => {
    const rolledBack = renderEmail("deploy-failed", {
      cafeName: "Lantern Café",
      kind: "deploy",
      version: "1.5.0",
      fromVersion: "1.4.2",
      status: "rolled-back",
      error: "The new version didn't pass its checks.",
      ...links,
    });
    assert.match(
      rolledBack.subject,
      /the update to 1\.5\.0 didn't pass its check and was rolled back/,
    );
    assert.match(rolledBack.text, /put your site back on 1\.4\.2/);
    assert.match(
      rolledBack.text,
      /What went wrong: The new version didn't pass/,
    );

    const failed = renderEmail("deploy-failed", {
      cafeName: "Lantern Café",
      kind: "branding",
      version: null,
      status: "failed",
      error: null,
      updatesUrl: null,
    });
    assert.match(
      failed.subject,
      /putting your branding on your site didn't go through/,
    );
    assert.match(failed.text, /stopped before it finished/);
    assert.doesNotMatch(failed.text, /What went wrong/);
    assert.doesNotMatch(
      failed.text,
      /https?:/,
      "no link when none is configured",
    );
  });

  it("escape what an owner typed into the HTML", () => {
    const mail = renderEmail("deploy-failed", {
      cafeName: `<script>alert("x")</script> & Co`,
      kind: "deploy",
      version: "1.5.0",
      status: "failed",
      error: `<img src=x onerror=alert(1)>`,
      updatesUrl: `https://console.example/"><script>`,
    });
    assert.ok(!mail.html.includes("<script>"));
    assert.ok(!mail.html.includes("<img"));
    assert.ok(mail.html.includes("&lt;script&gt;alert(&quot;x&quot;)"));
    // The plain text is not HTML: it says what was typed.
    assert.ok(mail.text.includes(`<script>alert("x")</script> & Co`));
  });

  it("won't make an email that can be switched off without a way to switch it off", () => {
    assert.throws(
      () =>
        renderEmail("release-available", {
          cafeName: "C",
          version: "1.5.0",
          line: "1.5",
          pinnedLine: "1.4",
          updatesUrl: null,
        }),
      /needs an unsubscribe link/,
    );
    assert.throws(() => renderEmail("newsletter", {}), /No email called/);
  });

  it("are plain text plus HTML with a title, a viewport and no scripts", () => {
    const mail = renderEmail("deploy-failed", {
      cafeName: "C",
      kind: "deploy",
      version: "1.5.0",
      status: "failed",
      error: "x",
      updatesUrl: links.updatesUrl,
    });
    assert.match(mail.html, /^<!doctype html>/);
    assert.match(mail.html, /<title>.*<\/title>/);
    assert.match(mail.html, /name="viewport"/);
    assert.doesNotMatch(mail.html, /<script|javascript:/i);
    assert.doesNotMatch(mail.html, /<img/);
  });
});

// -- who is emailed -------------------------------------------------------------

/** 1.3 fell out of the window on 10 Oct (1.5.0), so its cafes have until 9 Nov. */
const HISTORY = [
  ["1.3.0", "2026-06-01"],
  ["1.3.1", "2026-06-20"],
  ["1.4.0", "2026-08-01"],
  ["1.4.1", "2026-08-15"],
  ["1.5.0", "2026-10-10"],
];

/** A platform with that history, the clock on 24 October 2026, and a recording sender. */
async function platform(history = HISTORY) {
  const t = await testEnv({ releases: [] });
  t.advance(at("2026-10-24T09:00:00Z") - t.env.now().getTime());
  for (const [version, date] of history) {
    t.store.addRelease({
      version,
      channel: "stable",
      withdrawn: false,
      publishedAt: at(date),
    });
  }
  let n = 0;
  const addCafe = (extra = {}) => {
    n += 1;
    const cafe = draftCafe({
      id: `cafe${n}`,
      ownerUid: `owner${n}`,
      ownerEmail: `owner${n}@example.com`,
      status: "live",
      settings: { ...SETTINGS, name: `Cafe ${n}` },
      ...extra,
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
        ...extra.release,
      },
    });
    t.store.addCafe(cafe);
    return cafe;
  };
  const release = (version) => t.store.data.releases.get(version);
  return {
    ...t,
    addCafe,
    release,
    /** The release write the trigger sees: it has just been created. */
    created: (version) =>
      notifyRelease(t.env, { before: null, after: release(version) }),
    sentTo: () => t.outbox.map((m) => m.to),
  };
}

describe("a new release", () => {
  it("is announced to the cafes that stay on an older line, once", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.addCafe({ release: { pinned: null, current: "1.4.1" } }); // follows the channel
    p.addCafe({ release: { pinned: "1.5", current: "1.5.0" } }); // on that line already

    const first = await p.created("1.5.0");
    assert.equal(first.sent.length, 2);
    assert.deepEqual(p.sentTo(), ["owner1@example.com", "owner2@example.com"]);
    const mail = p.outbox[0];
    assert.match(mail.subject, /CafeMenu 1\.5\.0 is out/);
    assert.match(mail.text, /Cafe 1 is set to stay on 1\.4/);
    assert.match(
      mail.headers["List-Unsubscribe"],
      /^<https:\/\/platform\.example\/unsubscribe\?c=cafe1&t=[\w-]+>$/,
    );
    assert.equal(
      mail.headers["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click",
    );
    assert.ok(mail.text.includes("https://console.example/cafe/#updates"));

    // The same write again, as Cloud Functions may deliver it: nothing more.
    const again = await p.created("1.5.0");
    assert.deepEqual(again.sent, []);
    assert.equal(p.outbox.length, 2);
    assert.match(again.skipped[0].why, /already sent/);
  });

  it("is not announced for a patch of the cafe's own line, a beta, or a withdrawn release", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.0" } });
    p.store.addRelease({
      version: "1.6.0-beta.1",
      channel: "beta",
      withdrawn: false,
      publishedAt: at("2026-10-20"),
    });
    p.store.addRelease({
      version: "1.6.0",
      channel: "beta",
      withdrawn: false,
      publishedAt: at("2026-10-21"),
    });
    p.store.addRelease({
      version: "1.7.0",
      channel: "stable",
      withdrawn: true,
      publishedAt: at("2026-10-22"),
    });
    await p.created("1.4.1");
    await p.created("1.6.0-beta.1");
    await p.created("1.6.0");
    await p.created("1.7.0");
    assert.deepEqual(p.outbox, []);
  });

  it("is announced when a beta is promoted to stable, and not on a later edit", async () => {
    const p = await platform();
    p.store.addRelease({
      version: "1.6.0",
      channel: "beta",
      withdrawn: false,
      publishedAt: at("2026-10-22"),
    });
    p.addCafe({ release: { pinned: "1.5", current: "1.5.0" } });
    const beta = { ...p.release("1.6.0") };
    p.store.addRelease({ ...beta, channel: "stable" });
    const promoted = await notifyRelease(p.env, {
      before: beta,
      after: p.release("1.6.0"),
    });
    assert.equal(promoted.sent.length, 1);
    const edited = await notifyRelease(p.env, {
      before: p.release("1.6.0"),
      after: { ...p.release("1.6.0"), notes: "typo" },
    });
    assert.deepEqual(edited.sent, []);
    assert.equal(edited.skipped.length, 0, "not even looked at");
  });

  it("does nothing when a release is deleted", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    const result = await notifyRelease(p.env, {
      before: p.release("1.5.0"),
      after: null,
    });
    assert.deepEqual(result, { sent: [], skipped: [], failed: [] });
  });

  it("is not sent to an owner who unsubscribed, nor without a link to do it with", async () => {
    const p = await platform();
    p.addCafe({
      release: { pinned: "1.4", current: "1.4.1" },
      emails: { releaseNotices: false },
    });
    const quiet = await p.created("1.5.0");
    assert.match(quiet.skipped[0].why, /unsubscribed/);

    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.mail.unsubscribeUrl = null;
    const noLink = await p.created("1.5.0");
    assert.match(noLink.skipped.at(-1).why, /UNSUBSCRIBE_URL isn't set/);
    assert.deepEqual(p.outbox, []);
  });

  it("goes to the address on the owner's account, else the one the cafe was made with", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.store.data.emails.set("owner1", "new-address@example.com");
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    await p.created("1.5.0");
    assert.deepEqual(p.sentTo(), [
      "new-address@example.com",
      "owner2@example.com",
    ]);
  });

  it("tries again later when the provider refuses, and doesn't stop the other cafes", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.mail.failWith = "provider down";
    const down = await p.created("1.5.0");
    assert.equal(down.failed.length, 2, "each cafe was tried");
    assert.equal(down.failed[0].error, "provider down");
    assert.ok(
      p.logs.some((l) => l.level === "error" && /Email failed/.test(l.message)),
    );

    p.mail.failWith = null;
    const later = await p.created("1.5.0");
    assert.equal(later.sent.length, 2, "the claims were given back");
  });
});

describe("one cafe's trouble", () => {
  it("never stops the emails to the others", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    const getOwnerEmail = p.store.getOwnerEmail;
    p.store.getOwnerEmail = async (uid, fallback) => {
      if (uid === "owner1") throw new Error("Auth is down");
      return getOwnerEmail(uid, fallback);
    };
    const result = await p.created("1.5.0");
    assert.deepEqual(result.failed, [
      { cafe: "cafe1", kind: "release-available", error: "Auth is down" },
    ]);
    assert.deepEqual(p.sentTo(), ["owner2@example.com"]);
  });
});

describe("a line that is no longer supported", () => {
  it("gets the upgrade-required email, with the date, whatever the owner's settings", async () => {
    const p = await platform();
    p.addCafe({
      release: { pinned: "1.3", current: "1.3.1" },
      emails: { releaseNotices: false },
    });
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.mail.unsubscribeUrl = null; // essential emails need no link

    const result = await p.created("1.5.0");
    const required = result.sent.filter((s) => s.kind === "upgrade-required");
    assert.deepEqual(
      required.map((s) => s.cafe),
      ["cafe1"],
    );
    const mail = p.outbox.find((m) => m.to === "owner1@example.com");
    assert.equal(mail.subject, "Please upgrade Cafe 1 by 9 November 2026");
    assert.match(mail.text, /no longer supports/);
    assert.match(mail.text, /1\.5 and 1\.4/);
    assert.match(mail.text, /17 days from today/);
    assert.match(mail.text, /moves cafes still on 1\.3 to 1\.5\.0/);
    assert.equal(mail.headers, undefined);
  });

  it("is asked of every release write, but sent once per line and date", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.3", current: "1.3.1" } });
    await p.created("1.5.0");
    await p.created("1.4.1");
    await p.created("1.5.0");
    assert.equal(p.outbox.filter((m) => /upgrade/i.test(m.subject)).length, 1);
  });

  it("isn't sent once the date has come, or to a cafe on a supported line", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.4", current: "1.4.1" } });
    p.addCafe({ release: { pinned: "1.3", current: "1.3.1" } });
    p.advance(17 * DAY); // 10 November: the 9th is over
    const result = await p.created("1.5.0");
    assert.equal(
      result.sent.filter((s) => s.kind === "upgrade-required").length,
      0,
    );
  });

  it("is sent again for a cafe that is later pinned to an older line, on the next release write", async () => {
    const p = await platform();
    const cafe = p.addCafe({ release: { pinned: null, current: "1.3.1" } });
    await p.created("1.5.0");
    assert.deepEqual(p.outbox, []);
    p.store.data.cafes.get(cafe.id).release.pinned = "1.3";
    await p.created("1.5.0");
    assert.equal(p.outbox.length, 1);
  });

  it("is judged without a date when releases carry none: no email, no guess", async () => {
    const p = await platform();
    // 1.4 has no dates at all, so there is no telling when 1.3 fell out.
    p.store.data.releases.delete("1.4.1");
    p.store.addRelease({
      version: "1.4.0",
      channel: "stable",
      withdrawn: false,
    });
    p.addCafe({ release: { pinned: "1.3", current: "1.3.1" } });
    const result = await p.created("1.5.0");
    assert.deepEqual(result.sent, []);
  });

  it("doesn't also announce the release to a cafe it is already telling to upgrade", async () => {
    const p = await platform();
    p.addCafe({ release: { pinned: "1.3", current: "1.3.1" } });
    await p.created("1.5.0");
    assert.equal(p.outbox.length, 1);
    assert.match(p.outbox[0].subject, /Please upgrade/);
  });
});

describe("a deployment that ends badly", () => {
  const deployment = (patch = {}) => ({
    cafeId: "cafe1",
    kind: "deploy",
    version: "1.5.0",
    fromVersion: "1.4.1",
    status: "rolled-back",
    error: "The new version didn't pass its checks, so it was rolled back.",
    ...patch,
  });

  it("emails the owner, once, even if they unsubscribed", async () => {
    const p = await platform();
    p.addCafe({
      release: { pinned: "1.4", current: "1.4.1" },
      emails: { releaseNotices: false },
    });
    p.mail.unsubscribeUrl = null;
    const result = await notifyDeployment(p.env, {
      id: "dep1",
      before: deployment({ status: "running", error: null }),
      after: deployment(),
    });
    assert.equal(result.sent.length, 1);
    assert.deepEqual(p.sentTo(), ["owner1@example.com"]);
    assert.match(
      p.outbox[0].subject,
      /Cafe 1: the update to 1\.5\.0 didn't pass its check and was rolled back/,
    );
    assert.match(p.outbox[0].text, /put your site back on 1\.4\.1/);
    assert.match(
      p.outbox[0].text,
      /didn't pass its checks, so it was rolled back/,
    );

    await notifyDeployment(p.env, {
      id: "dep1",
      before: deployment({ status: "running" }),
      after: deployment(),
    });
    assert.equal(p.outbox.length, 1, "the same deployment, twice");
  });

  it("emails for a failed deploy, rollback, branding sync or setup", async () => {
    const p = await platform();
    p.addCafe();
    for (const [i, kind] of [
      "deploy",
      "rollback",
      "branding",
      "provision",
    ].entries()) {
      await notifyDeployment(p.env, {
        id: `dep${i}`,
        before: deployment({ status: "running" }),
        after: deployment({ kind, status: "failed" }),
      });
    }
    assert.equal(p.outbox.length, 4);
    assert.match(p.outbox[3].subject, /setting up your cafe didn't go through/);
  });

  it("says nothing while it is queued or running, or on the writes after it ended", async () => {
    const p = await platform();
    p.addCafe();
    for (const status of ["queued", "running", "succeeded"]) {
      await notifyDeployment(p.env, {
        id: "dep1",
        before: deployment({ status: "queued" }),
        after: deployment({ status }),
      });
    }
    // A later write of a deployment that already ended is not a new ending.
    await notifyDeployment(p.env, {
      id: "dep2",
      before: deployment({ status: "failed" }),
      after: deployment({ status: "failed", detail: null }),
    });
    assert.deepEqual(p.outbox, []);
  });

  it("copes with a cafe that is gone, and with no address to send to", async () => {
    const p = await platform();
    const gone = await notifyDeployment(p.env, {
      id: "dep1",
      before: deployment({ status: "running", cafeId: "nobody" }),
      after: deployment({ cafeId: "nobody" }),
    });
    assert.deepEqual(gone, { sent: [], skipped: [], failed: [] });

    p.addCafe({ ownerEmail: "" });
    const none = await notifyDeployment(p.env, {
      id: "dep2",
      before: deployment({ status: "running" }),
      after: deployment(),
    });
    assert.match(none.skipped[0].why, /no email address/);
  });
});

describe("the unsubscribe link", () => {
  async function linked() {
    const p = await platform();
    const cafe = p.addCafe({
      settings: { ...SETTINGS, name: `Tom & "Jerry's" <b>` },
      release: { pinned: "1.4", current: "1.4.1" },
    });
    await p.created("1.5.0");
    const url = new URL(p.outbox[0].headers["List-Unsubscribe"].slice(1, -1));
    const query = Object.fromEntries(url.searchParams);
    const prefs = () => p.store.data.cafes.get(cafe.id).emails;
    return {
      ...p,
      cafe,
      query,
      prefs,
      hit: (method, extra = {}) =>
        handleUnsubscribe(p.env, { method, query, ...extra }),
    };
  }

  it("asks first on a GET, and changes nothing", async () => {
    const l = await linked();
    const page = await l.hit("GET");
    assert.equal(page.status, 200);
    assert.match(page.html, /Stop emails about new versions\?/);
    assert.match(page.html, /name="action" value="unsubscribe"/);
    assert.equal(l.prefs(), undefined);
  });

  it("unsubscribes on a POST, and the page can undo it", async () => {
    const l = await linked();
    const done = await l.hit("POST", { body: { action: "unsubscribe" } });
    assert.match(done.html, /You're unsubscribed/);
    assert.deepEqual(l.prefs(), { releaseNotices: false });
    assert.match((await l.hit("GET")).html, /These emails are off/);

    const back = await l.hit("POST", { body: { action: "subscribe" } });
    assert.match(back.html, /Emails are back on/);
    assert.deepEqual(l.prefs(), { releaseNotices: true });
  });

  it("takes a mail client's one-click POST", async () => {
    const l = await linked();
    await l.hit("POST", { body: { "List-Unsubscribe": "One-Click" } });
    assert.deepEqual(l.prefs(), { releaseNotices: false });
  });

  it("stops the release emails and leaves the essential ones", async () => {
    // 1.3 and 1.4 are the only lines, so a cafe on 1.3 is supported and 1.4.0 is news to it.
    const p = await platform(HISTORY.slice(0, 3));
    const cafe = p.addCafe({ release: { pinned: "1.3", current: "1.3.1" } });
    const query = { c: cafe.id, t: await p.store.ensureMailToken(cafe.id) };
    await handleUnsubscribe(p.env, { method: "POST", query, body: {} });

    const news = await p.created("1.4.0");
    assert.match(news.skipped[0].why, /unsubscribed/);
    assert.deepEqual(p.outbox, []);
    await notifyDeployment(p.env, {
      id: "depX",
      before: { status: "running" },
      after: { cafeId: cafe.id, kind: "deploy", status: "failed" },
    });
    assert.equal(p.outbox.length, 1);
    assert.match(p.outbox[0].subject, /didn't go through/);
  });

  it("refuses a wrong, missing or other cafe's token, and says nothing about which", async () => {
    const l = await linked();
    const other = l.addCafe();
    await l.store.ensureMailToken(other.id);
    const bad = [
      { c: l.query.c, t: "wrong" },
      { c: l.query.c },
      { t: l.query.t },
      { c: other.id, t: l.query.t },
      { c: "nobody", t: l.query.t },
      { c: "../x", t: l.query.t },
      { c: [l.query.c], t: [l.query.t] },
    ];
    for (const query of bad) {
      for (const method of ["GET", "POST"]) {
        const page = await handleUnsubscribe(l.env, {
          method,
          query,
          body: {},
        });
        assert.equal(page.status, 404, JSON.stringify(query));
        assert.match(page.html, /This link doesn't work/);
      }
    }
    assert.equal(l.prefs(), undefined);
    assert.equal(l.store.data.cafes.get(other.id).emails, undefined);
  });

  it("allows only GET and POST, and escapes the cafe's name", async () => {
    const l = await linked();
    assert.equal((await l.hit("DELETE")).status, 405);
    const page = await l.hit("GET");
    assert.ok(!page.html.includes("<b>"));
    assert.ok(page.html.includes("Tom &amp; &quot;Jerry's&quot; &lt;b&gt;"));
  });

  it("is served with headers that keep the page inert", () => {
    assert.match(
      UNSUBSCRIBE_HEADERS["Content-Security-Policy"],
      /default-src 'none'/,
    );
    assert.match(
      UNSUBSCRIBE_HEADERS["Content-Security-Policy"],
      /frame-ancestors 'none'/,
    );
    assert.equal(UNSUBSCRIBE_HEADERS["Cache-Control"], "no-store");
    assert.equal(UNSUBSCRIBE_HEADERS["X-Content-Type-Options"], "nosniff");
  });

  it("uses a token per cafe, made once", async () => {
    const l = await linked();
    const again = await l.store.ensureMailToken(l.cafe.id);
    assert.equal(again, l.query.t);
    assert.ok(again.length >= 32);
    const other = l.addCafe();
    assert.notEqual(await l.store.ensureMailToken(other.id), again);
  });
});
