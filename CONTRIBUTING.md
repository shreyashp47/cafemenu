# Contributing

Thanks for helping. The design is in [PLAN.md](./PLAN.md) and every piece of
work is an [issue](https://github.com/shreyashp47/cafemenu/issues) in a phase
[milestone](https://github.com/shreyashp47/cafemenu/milestones).

## Getting set up

```bash
git clone https://github.com/shreyashp47/cafemenu.git
cd cafemenu
npm ci
npm run dev        # the cafe app, in demo mode, on http://localhost:3000
```

Node 20.9+ (`.nvmrc` pins 20). This is an npm workspace:

| Folder         | What it is                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cafe`    | The cafe website: TOE v0.3.0, being generalised. Its own [README](./apps/cafe/README.md) and [CONTRIBUTING](./apps/cafe/CONTRIBUTING.md) cover its scripts, rules tests and Playwright checks. |
| `apps/console` | The CafeMenu website (Phase 3, not started).                                                                                                                                                   |
| `packages/*`   | Shared code and the deployer.                                                                                                                                                                  |

Install once at the root. Run a workspace's scripts from its folder, or from
the root with `-w`, e.g. `npm run verify -w @cafemenu/cafe`. From the root,
`npm run verify` runs every workspace's checks.

**Never delete `package-lock.json` to start fresh.** Resolving this workspace
from nothing crashes npm (10.2 and 10.8 alike) with
`Cannot read properties of null (reading 'edgesOut')`, on the peer dependencies
around `vitest` 4. With the lockfile, `npm ci` and `npm install` work normally.
The lockfile started as TOE's, so the cafe app runs on exactly TOE's versions.

### Bringing a fix across from TOE

Until TOE moves onto CafeMenu
([#23](https://github.com/shreyashp47/cafemenu/issues/23)), a fix made in the
TOE repository can be applied here with its history:

```bash
git -C ../TOE format-patch -1 <commit> --stdout | git am --directory=apps/cafe
```

## Picking something up

- Work on issues in the **current milestone**, in dependency order. Each issue
  says what it depends on, what to do, and when it's done.
- Comment on the issue before you start, so two people don't build the same
  thing.
- An issue labelled `decision` needs the choice written down (in the issue or
  in `docs/`) before or as the work is done.
- If you find work that isn't covered, open an issue for it rather than folding
  it into an unrelated pull request.

## How a change lands

1. Branch off `main`: `feat/<short-name>`, `fix/<short-name>` or
   `docs/<short-name>`.
2. Commit in small, logical steps.
3. Open a pull request that closes its issue (`Closes #12`). CI has to be green.
4. Squash or rebase merge; no merge commits on `main`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), as in TOE:

```
feat(cafe): read the Firebase config from /__/firebase/init.json
fix(deployer): retry the Hosting release when the version is still finalising
docs(plan): record the IAM roles the spike found
test(rules): staff invites cannot be reused
```

Scopes: `cafe`, `console`, `deployer`, `shared`, `rules`, `release`, `plan`,
`ci`.

## House rules

These carry over from TOE, plus a few that matter more once one codebase serves
many cafes.

1. **Never test against a real cafe.** Use demo mode, the emulators, or your
   own throwaway Firebase project. A live cafe's order board is a real counter
   during service. No fake orders, no scripted requests.
2. **Never commit a credential.** Service-account keys, tokens and `.env.local`
   files stay out of the repository. The deploy service account can rewrite the
   rules of every connected cafe, so it is the most sensitive thing in this
   project.
3. **Rules and app change together.** A new Firestore path or field needs a
   rule, a rules test, and a note in the pull request about deploy order.
4. **Migrations expand, then contract.** Add new fields first and remove old
   ones in a later release, so the previous release keeps working against
   migrated data and a rollback is always safe.
5. **The deployer must be safe to re-run.** Every step either completes or can
   be retried from where it stopped, without duplicating anything.
6. **Never hardcode a colour or a string.** Colours are theme tokens; user-facing
   text goes in `messages/en.json`; money and dates go through the cafe's
   currency, locale and time zone.
7. **Keep the cafe app light.** It loads on cafe wifi and mobile data. Say what
   a new runtime dependency replaces and what it costs in bundle size.
8. **Keep the staff board functional.** It is for speed during a rush. No
   decoration a barista would have to look past.
9. **No licensed characters or brand art** in themes or templates. Everything
   is original or properly licensed.

## Pull requests

- Say what you verified. "Ran the rules tests against the emulators" is useful;
  "should work" is not.
- Include a phone-width screenshot for any UI change.
- Keep them small. A pull request that mixes a refactor with a feature will
  wait.

## Reporting a bug or asking for a feature

Use the issue templates. Security problems go through
[SECURITY.md](./SECURITY.md), not a public issue.

By contributing you agree that your work is released under the
[MIT License](./LICENSE) and that you follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).
