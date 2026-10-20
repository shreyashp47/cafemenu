# Security policy

CafeMenu will hold deploy access to every connected cafe's Firebase project, so
a security problem here can affect many cafes at once. Reports are very welcome.

## Supported versions

Nothing is released yet. From v1.0, the latest two minor release lines receive
security fixes, and fixes are pushed to every connected cafe, including cafes
that have chosen to stay on an older minor line.

## Reporting a vulnerability

Please **do not open a public issue, pull request or discussion** with the
details of a security problem.

Report it privately to the maintainer,
[@shreyashp47](https://github.com/shreyashp47):

- Use **Security → Report a vulnerability** on this repository. It keeps the
  report private until a fix ships.
- If that isn't available to you, open an issue titled "Security contact
  request" with **no details**, and the maintainer will reply with a private
  channel.

Include what you found, how to reproduce it, and the impact you believe it has.
You can expect an acknowledgement within a few days. There is no bug bounty.

Test only against your own Firebase project or the local emulators, never
against a real cafe's site.

## Scope

**In scope**, roughly in order of how much it matters:

- Anything that exposes or misuses the **deploy service account**: leaking its
  credentials, getting a pull request or workflow to use it, or making the
  deployer act on a project its owner didn't connect.
- **Console tenancy:** one owner reading or changing another owner's cafe,
  release choice, or settings, or anyone other than the platform admin
  publishing a release.
- **Provisioning and onboarding:** connecting someone else's Firebase project,
  or tricking setup into creating an owner account for the wrong person.
- **Cafe app rules** (`firestore.rules`): reading another customer's order,
  reading the order book without a staff role, changing a price or status
  outside the rules, staff becoming owner, or reusing a staff invite.
- **Release integrity:** getting a modified release package deployed to cafes.
- Script injection (XSS) through anything an owner, staff member or customer
  can type.

**Out of scope:**

- **The Firebase web config** of a cafe. It ships in every page by design and
  grants nothing; the rules protect the data.
- Known limits of Firebase's free plan inherited from TOE, such as order totals
  that can only be checked at the counter, not on the server (see TOE's
  `SECURITY.md`).
- Volumetric denial of service, spam, social engineering, and vulnerabilities
  in Firebase or Google Cloud themselves (report those to Google).
- Best-practice findings with no working exploit.
