/**
 * `deployer owner`: the cafe owner's first account. What TOE's
 * `npm run seed:staff -- --role=owner` does from a terminal
 * (scripts/lib/seed-staff.mjs), plus the "set your password" email, so no
 * password is ever generated, printed or sent by the platform:
 *
 *   1. Create the Email/Password account if there isn't one (no password).
 *   2. Write /staff/{uid} = { name, role: "owner" }, touching only those two
 *      fields, as seed-staff does.
 *   3. Send the project's own password-reset email, unless the owner has
 *      already set a password.
 *
 * Re-running is safe: an existing account and an up-to-date staff document
 * are left alone, and the email is only re-sent while no password is set.
 */
import {
  decodeFields,
  encodeFields,
  getDocument,
  patchDocument,
} from "../apis/firestore.mjs";
import {
  createUser,
  lookupUserByEmail,
  sendPasswordResetEmail,
} from "../apis/identitytoolkit.mjs";
import { ApiError } from "../errors.mjs";
import { act } from "./act.mjs";

export async function owner(
  ctx,
  { email, name, sendEmail = true, continueUrl },
) {
  const { api, log, project } = ctx;
  log.title(`Setting up the owner account for ${email} in ${project}`);

  log.step("Account");
  let user = await lookupUserByEmail(api, project, email);
  if (user) {
    log.same(`exists (uid ${user.localId})`);
  } else {
    user = await act(
      ctx,
      {
        would: `would create an Email/Password account for ${email}`,
        done: (created) =>
          `created an account for ${email} (uid ${created.localId})`,
      },
      async () => {
        try {
          const res = await createUser(api, project, {
            email,
            displayName: name,
          });
          return { localId: res.localId, email };
        } catch (error) {
          // Created by someone else since we looked: use that account.
          if (error instanceof ApiError && /EMAIL_EXISTS/.test(error.reason)) {
            const again = await lookupUserByEmail(api, project, email);
            if (again) return again;
          }
          throw error;
        }
      },
    );
  }
  const uid = user?.localId ?? null;

  log.step("Staff record");
  const path = uid ? `staff/${uid}` : "staff/<new uid>";
  const current = uid ? await getDocument(api, project, path) : null;
  const fields = current ? decodeFields(current.fields) : null;
  if (fields && fields.name === name && fields.role === "owner") {
    log.same(`/${path} already says owner "${name}"`);
  } else {
    const change = fields
      ? `/${path}: role ${fields.role ?? "(none)"} → owner, name "${name}"`
      : `/${path} { name: "${name}", role: "owner" }`;
    await act(
      ctx,
      {
        would: `would ${fields ? "update" : "create"} ${change}`,
        done: `${fields ? "updated" : "created"} ${change}`,
      },
      () =>
        patchDocument(
          api,
          project,
          path,
          encodeFields({ name, role: "owner" }),
          ["name", "role"],
        ),
    );
  }

  log.step("Set-password email");
  let emailed = false;
  if (!sendEmail) {
    log.same("not sent (--no-email)");
  } else if (user?.passwordUpdatedAt) {
    log.same(`${email} has already set a password; no email sent`);
  } else {
    await act(
      ctx,
      {
        would: `would send a password-reset email to ${email}`,
        done: `sent a password-reset email to ${email}`,
      },
      () => sendPasswordResetEmail(api, project, email, continueUrl),
    );
    emailed = !ctx.dryRun;
  }

  log.blank();
  log.say(
    log.changes.length === 0
      ? "Nothing to change: the owner account is already set up."
      : ctx.dryRun
        ? `Dry run: ${log.changes.length} change(s) would be made.`
        : `Done. ${email} signs in at /staff once they've chosen a password.`,
  );
  return { uid, emailed, changes: log.changes };
}
