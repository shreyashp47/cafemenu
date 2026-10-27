# CafeMenu

[![License: MIT](https://img.shields.io/github/license/shreyashp47/cafemenu)](./LICENSE)
[![Status: early development](https://img.shields.io/badge/status-early%20development-orange)](./PLAN.md)
[![CI](https://github.com/shreyashp47/cafemenu/actions/workflows/ci.yml/badge.svg)](https://github.com/shreyashp47/cafemenu/actions/workflows/ci.yml)
[![Open issues](https://img.shields.io/github/issues/shreyashp47/cafemenu)](https://github.com/shreyashp47/cafemenu/issues)

QR-code table ordering for small cafes. Customers scan the code on their table
and order from their own phone, staff see orders arrive live on the counter
phone, and the owner runs the menu and reads the numbers. It all runs on the
cafe's own free Firebase project.

CafeMenu turns [TOE](https://github.com/shreyashp47/TOE), a QR ordering app
already running at a real cafe, into something any cafe can set up for itself in
a few minutes. It then keeps every cafe updated with releases the owner chooses.

> **Status: early development.** The cafe app runs locally in demo mode, but
> signing a cafe up doesn't work yet. The design is in [PLAN.md](./PLAN.md), and
> the work is tracked as
> [issues](https://github.com/shreyashp47/cafemenu/issues) grouped into
> [milestones](https://github.com/shreyashp47/cafemenu/milestones), one per phase.

## Live now

- **CafeMenu website:** <https://getcafemenu.web.app> (demo mode until the backend is on)
- **Demo cafe:** <https://getcafemenu-demo.web.app>. Order at `/order?table=3`; staff board at `/staff`, PIN `1122`.

Docs: [requirements](./docs/requirements.md) · [your guide](./docs/user-guide.md) ·
[super admin and maintenance mode](./docs/super-admin-requirements.md) · [plan](./PLAN.md)

## Try the cafe app locally

```bash
git clone https://github.com/shreyashp47/cafemenu.git
cd cafemenu
npm ci
npm run dev
```

Open <http://localhost:3000>. No Firebase account is needed: the app starts in
demo mode, with a sample menu stored in your browser. Open
<http://localhost:3000/order?table=3> as the customer and
<http://localhost:3000/staff> as the staff phone (PIN `1122`) side by side, and
place an order. More in the [cafe app's README](./apps/cafe/README.md).

## How it will work

For a cafe owner:

1. **Fill in a short form:** cafe name, web address, country, number of tables,
   theme, logo and a starting menu.
2. **Create a free Firebase project** in your own Google account, following
   step-by-step screenshots.
3. **Give CafeMenu access** to that project, so it can set it up and send you
   updates.
4. **Wait about a minute** while CafeMenu sets everything up, then choose your
   password from the email you receive.
5. **Print your table QR cards** and take orders.

Your menu, orders and staff accounts live in **your** Firebase project, not
ours. You choose when to take new releases, and you can leave at any time: your
site keeps running on its last release.

## What each cafe gets

Everything TOE does today, made to work for any cafe:

- **Customer menu from a QR code:** no app to install, no login, a cart, and
  the order's status updating live on the customer's phone.
- **Staff order board:** new orders appear on their own with a chime and
  vibration, daily order numbers, and an optional check on new tables before
  their first order goes to the kitchen.
- **Owner dashboard:** menu editing and one-tap sold-out, today's special,
  tables and printable QR cards, monthly reports with CSV export, order
  history, and staff accounts by invite link.
- **The cafe's own look and locale:** a choice of themes, its own logo and
  accent colour, its currency, time zone and date formats.
- **Free to run** for a typical small cafe, on Firebase's no-cost Spark plan.

## How it is built

- **Cafe app:** TOE, generalised. Next.js (static export), TypeScript, Tailwind
  CSS and Firebase (Firestore + Auth), hosted on Firebase Hosting in the cafe's
  own project. One build per release serves every cafe; each cafe's settings
  are read at runtime.
- **Console:** the CafeMenu website, where owners sign up, connect their
  project, and pick which release their cafe runs.
- **Deployer:** sets up new cafe projects and deploys releases into them, with
  automatic rollback if a check fails.

The full design, including how releases and versions work, is in
[PLAN.md](./PLAN.md#how-it-fits-together).

## Roadmap

| Phase                                                                           | What it delivers                                                             | Estimate (working days) |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| [0 · Spike](https://github.com/shreyashp47/cafemenu/milestone/1)                | Proof that CafeMenu can set up and deploy to an owner's own Firebase project | 8–13                    |
| [1 · Config-free cafe app](https://github.com/shreyashp47/cafemenu/milestone/2) | One build for every cafe: themes, any currency and time zone, staff invites  | 27–41                   |
| [2 · Release pipeline](https://github.com/shreyashp47/cafemenu/milestone/3)     | Versioned releases, deploy and rollback, data migrations; TOE moves onto it  | 11–17                   |
| [3 · Console](https://github.com/shreyashp47/cafemenu/milestone/4)              | Signup, onboarding, automatic setup, owner updates page                      | 22–31                   |
| [4 · Automatic rollouts](https://github.com/shreyashp47/cafemenu/milestone/5)   | Releases roll out in waves, with auto-rollback and owner emails              | 8–12                    |
| [v1.0 · Release testing](https://github.com/shreyashp47/cafemenu/milestone/7)   | Every feature tested end to end before v1.0                                  | 10–17                   |

**Scope update:** v1.0 is now lean (generic sites set up and updated with the
deployer); Phases 3–4's self-serve signup and automatic rollouts move to
[v1.1](https://github.com/shreyashp47/cafemenu/milestone/8). See
[PLAN.md](./PLAN.md#lean-v10).

The original full plan was about **86–131 working days** in total for one developer: roughly 4–6 months
full-time. How the estimate was made is in
[PLAN.md](./PLAN.md#timeline).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first, and
pick an issue from the current milestone.

Security problems go through [SECURITY.md](./SECURITY.md), never a public
issue. Everyone taking part follows the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE). CafeMenu builds on [TOE](https://github.com/shreyashp47/TOE),
which is also MIT-licensed.
