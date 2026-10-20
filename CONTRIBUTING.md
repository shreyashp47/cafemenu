# Contributing

Thanks for helping. CafeMenu is at the planning stage: the design is in
[PLAN.md](./PLAN.md) and every piece of work is an
[issue](https://github.com/shreyashp47/cafemenu/issues) in a phase
[milestone](https://github.com/shreyashp47/cafemenu/milestones). Setup
instructions arrive with the first code
([#1](https://github.com/shreyashp47/cafemenu/issues/1)).

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
