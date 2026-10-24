# CafeMenu terms of service

> **Draft, not legal advice, not in force.** These terms do not apply to anyone
> yet. They must be reviewed by a qualified lawyer before the first outside cafe
> signs up. Anything marked `[[TO DECIDE: …]]` is not settled.

_Last updated: [[TO DECIDE: date of publishing]]_

These terms are the agreement between you, the cafe owner, and CafeMenu. Please
read them with the [privacy policy](privacy-policy.md) and
[Your access, explained](access-explained.md). By signing up on the console and
connecting your Firebase project, you agree to them.

"CafeMenu", "we" and "us" mean [[TO DECIDE: the legal person who runs CafeMenu:
the maintainer as an individual, or a company, with its registered name and
address]]. "You" means the person who signs up and, if you sign up for a
business, that business. You confirm that you can agree to these terms for it.

## 1. The service

CafeMenu gives your cafe its own QR table-ordering website. Through the CafeMenu
console you can:

- set up your cafe's site in **your own Firebase project**, in your own Google
  account;
- choose its name, look, currency, time zone and language;
- choose which **release** (version) of the cafe app it runs, upgrade, and roll
  back;
- get updates, including security fixes, deployed to it.

The code is open source under the MIT licence at
[github.com/shreyashp47/cafemenu](https://github.com/shreyashp47/cafemenu).
These terms cover the **hosted service**: the console and the deploys we run
for you. They don't limit what the MIT licence lets you do with the code
itself.

## 2. Price

CafeMenu is **free for now**.

We may introduce paid plans later. If we do:

- we'll announce them on the console and by email at least
  [[TO DECIDE: notice period, for example 30 days]] before any charge could
  apply to you;
- nothing will be charged unless you choose a paid plan and agree to its price;
- [[TO DECIDE: what happens to cafes that don't choose a paid plan, for example
a free plan that stays, or updates stopping after the notice period]].

**Your Firebase bill is separate.** Your project is yours, so Google bills you
directly for it, under Google's terms. Most small cafes stay within Firebase's
free Spark plan, but that is up to Google and your usage, not us. CafeMenu never
pays or receives anything for your project.

## 3. Your responsibilities

You are responsible for:

- **Your Google account and Firebase project:** keeping them secure, accepting
  and following Google's terms, and paying any bill from Google. If you upgrade
  your project to a paid Firebase plan, the charges are yours.
- **Your cafe's content:** your menu, prices, descriptions, photos, logo, name
  and web address, and that you have the right to use them. Prices and
  descriptions must be accurate and lawful where you trade, including any tax
  and allergen information your local rules require.
- **Your customers and staff:** serving and charging your customers, handling
  their complaints and refunds, telling them how their information is used, and
  answering their requests about it. See section 3 of the
  [privacy policy](privacy-policy.md#3-your-customers-data-is-yours).
- **Who has access:** who you invite as staff, and keeping your owner and staff
  sign-ins safe.
- **Your local laws:** food safety, consumer protection, tax, payments and data
  protection where your cafe is.
- **Using CafeMenu fairly:** not using it for anything unlawful, not trying to
  reach another cafe's project or data, and not interfering with the console or
  the deployer. Please report security problems as our
  [security policy](../../SECURITY.md) asks.

You must be [[TO DECIDE: minimum age, for example 18]] or older to sign up.

## 4. Updates and the support window

- **Releases.** You choose how your cafe gets new releases: auto-update
  (stable), auto-update (beta, which gets new versions first and may be less
  tested), or stay on a version until you press **Upgrade**.
- **Security fixes.** Security fixes (patch releases, such as 1.4.x) are
  deployed to **every** connected cafe, including cafes that chose to stay on
  an older version. You agree to this as part of the service.
- **Support window.** Only the latest two minor release lines (for example 1.4
  and 1.5) are supported, and only they get fixes, security fixes included. If
  your cafe stays on an older line, we'll tell you by email and with a notice
  in the console, with a date to upgrade by that is at least
  [[TO DECIDE: notice period, for example 30 days]] after that line stopped
  being supported. The date is the last day you have to upgrade yourself. From
  the day after it, we may move your cafe to the newest supported release
  without asking, and from then on it stays on that line. Until you upgrade or
  we move your cafe, it keeps running, but we make no fixes for its line. The
  details are in [releases.md](../releases.md#the-support-window).
- **Data changes.** Some releases change how your data is stored. We migrate it
  for you, in a way designed to keep the previous release working so a rollback
  is safe.
- **Rollbacks.** If a deploy fails our automated checks, we may roll it back
  without asking. You can roll back to the previous release yourself from the
  console.
- **Support.** [[TO DECIDE: how owners get help (email, GitHub issues, or
both), and whether any response time is promised]]. Support is best effort
  while CafeMenu is free.

## 5. Deploy access, and taking it back

To use CafeMenu you add CafeMenu's deploy service account as a member of your
Firebase project with [[TO DECIDE: the exact IAM roles, settled by the Phase 0
spike]]. That access is near-admin: it lets us deploy your rules and site, run
data migrations, and create your owner account, and it technically lets us read
your project's data.

We use it only as the [privacy policy](privacy-policy.md#2-what-cafemenu-can-reach-in-your-firebase-project)
describes: to set up, deploy, migrate, check and support your cafe. We never
read your order data for our own purposes, sell it or analyse it.

You can **remove that access at any time** on the Google Cloud IAM page. When
you do:

- we can no longer reach your project, so updates (including security fixes)
  stop;
- your site keeps running on its last release, and your data stays in your
  project;
- the console shows your cafe as disconnected. You can reconnect it later by
  adding the member again.

Running a release we no longer support, or no longer update, is at your own
risk.

## 6. Availability

We try to keep the console and the deployer running, but we don't promise they
will always be available or error-free. Your cafe's site runs in your own
Firebase project, so it doesn't depend on the console being up. It does depend
on Google's Firebase services, which we don't control.

We may change, add or remove features of the console. If we plan to **stop
the service** altogether, we'll tell you at least [[TO DECIDE: notice period,
for example 60 days]] ahead. Your site and data stay in your project and keep
working on their last release.

## 7. No warranty

CafeMenu is provided **"as is"** and **"as available"**. To the extent the law
allows, we give no warranties, written or implied, including that it is fit for
a particular purpose, that it will work without interruption or errors, or that
it will keep your data safe from every risk. The same applies to the open source
code under the MIT licence.

Some countries don't allow some of these exclusions, so parts of this section
may not apply to you.

## 8. Limitation of liability

To the extent the law allows:

- we are not liable for indirect or consequential losses, such as lost profits,
  lost sales, lost orders, lost data or harm to your reputation;
- we are not liable for problems caused by Google, your Firebase project or its
  billing, your internet connection, your staff or customers, or a release you
  chose to stay on after its support ended;
- our total liability to you for everything connected with CafeMenu is limited
  to [[TO DECIDE: a cap, for example the amount you paid us in the 12 months
before the claim, or a fixed small amount while the service is free]].

Nothing in these terms limits liability that the law doesn't allow to be
limited, such as for fraud or, where it applies, death or personal injury
caused by negligence.

## 9. Ending the agreement

**You** can stop at any time: remove the deploy access and, if you want,
delete your console account, as section 7 of the
[privacy policy](privacy-policy.md#7-leaving-and-deleting-your-console-data)
explains.

**We** may suspend or close your console account if you seriously or
repeatedly break these terms, if your use puts other cafes or the service at
risk, or if the law requires it. Where it's safe and lawful, we'll tell you
first and give you a chance to fix it. If we close your account, we stop
deploying to your project, and you should remove the deploy access yourself;
your site and data stay in your project.

Sections 3, 7, 8, 10 and 11 still apply after the agreement ends.

## 10. Changes to these terms

We may update these terms. We'll change the date at the top and publish every
version in our repository. For a significant change, we'll email you at least
[[TO DECIDE: notice period, for example 30 days]] before it takes effect. If you
keep using CafeMenu after that, the new terms apply. If you don't agree, you can
leave as section 9 explains.

## 11. Law and disputes

These terms are governed by the laws of [[TO DECIDE: governing law, for example
India]], and disputes go to the courts of [[TO DECIDE: place]]. If you are a
consumer, or your local law gives you rights that can't be taken away by a
contract, those rights still apply.

Before going to court, please contact us so we can try to sort it out.

## 12. Contact

[[TO DECIDE: support contact email address]].

Security problems: please follow our [security policy](../../SECURITY.md).
