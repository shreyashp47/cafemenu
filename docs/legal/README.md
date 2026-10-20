# Legal documents

> **Draft, not legal advice, not in force.** None of these documents applies to
> anyone yet. They must be reviewed by a qualified lawyer before the first
> outside cafe signs up.

These are the documents a cafe owner agrees to, or reads, when they connect
their cafe to CafeMenu. They are tracked in
[issue #31](https://github.com/shreyashp47/cafemenu/issues/31).

| Document                                      | What it's for                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Privacy policy](privacy-policy.md)           | What the CafeMenu console keeps about owners, what CafeMenu can reach inside a cafe's Firebase project and what it promises, who is responsible for customers' data, and how to leave.                  |
| [Terms of service](terms-of-service.md)       | The agreement between an owner and CafeMenu: the service, pricing, the owner's responsibilities, updates and the support window, deploy access, availability, liability and ending it.                  |
| [Your access, explained](access-explained.md) | A one-page, friendly explainer shown in the onboarding wizard ([#27](https://github.com/shreyashp47/cafemenu/issues/27)) and the owner area ([#29](https://github.com/shreyashp47/cafemenu/issues/29)). |

## Status

**Draft.** Written from [PLAN.md](../../PLAN.md) and [SECURITY.md](../../SECURITY.md)
as they stand. Not reviewed by a lawyer, not published, and not linked from the
console.

Before these can be published:

1. The Phase 0 spike settles the exact IAM roles the owner grants
   ([#1](https://github.com/shreyashp47/cafemenu/issues/1)–[#7](https://github.com/shreyashp47/cafemenu/issues/7)).
2. The maintainer settles every business decision marked below.
3. A qualified lawyer reviews all three documents, including whether India's
   Digital Personal Data Protection Act 2023, the EU and UK GDPR, or any other
   country's law needs more than they say.
4. They are published on the console, with a version date, and the signup form
   asks owners to accept the terms.

Issue #31 closes at step 4.

## Placeholders

Anything not yet known is written as `[[TO DECIDE: …]]` instead of being made
up. Search for `[[TO DECIDE` to find them all. They are of two kinds:

- **Facts the Phase 0 spike must settle:** the exact IAM roles, the deploy
  service account's address, and which steps can be automated.
- **Business decisions for the maintainer:** who "CafeMenu" is legally (a
  person or a company), its address, governing law and courts, the contact and
  grievance address, pricing and notice periods, retention periods, which
  outside services the console uses, and minimum age.

## Changing these documents

Treat a change to a published version like a release: a pull request with the
reason, a new "last updated" date, and notice to owners as the terms describe.
Keep earlier published versions in git history.
