/**
 * The words for a deployment in the admin's lists, from messages/en.json:
 * what it did, and who asked.
 */

import { fill, messages } from "../messages";
import type { Deployment } from "../platform/model";
import type { AuditRow } from "./overview";

const { what, who } = messages.admin.audit;

/** "Deploy 1.1.1, from 1.1.0", "Roll back to 1.1.0", "Setup"… */
export function deploymentWhat(d: Deployment): string {
  const version = d.version ?? "";
  switch (d.kind) {
    case "deploy":
      return d.fromVersion
        ? fill(what.deployFrom, { version, from: d.fromVersion })
        : fill(what.deploy, { version });
    case "rollback":
      return fill(what.rollback, { version });
    default:
      return what[d.kind];
  }
}

export function whoText(row: AuditRow["who"]): string {
  return row.kind === "owner"
    ? fill(who.owner, { email: row.email })
    : who[row.kind];
}
