/**
 * Staff invites (issue #15): how an owner adds a barista with no terminal.
 *
 * The owner makes an invite on /admin/staff and sends its link. Whoever opens
 * it signs up on /join and, in one batch, gets a /staff/{uid} record with the
 * invite's role while the invite is marked used. firestore.rules (/invites)
 * is what makes that safe; this file is the shared vocabulary for the two
 * backends and the two pages.
 *
 * The invite's document id is the secret the link carries, so it has to be
 * unguessable: 24 characters from 62 is over 140 bits. The rules refuse an id
 * shorter than 20, so a hand-made "abc" invite cannot exist.
 */

import { generateTableKey } from "./table-keys";
import { t } from "./i18n";

export type InviteRole = "staff" | "owner";

export interface Invite {
  id: string;
  role: InviteRole;
  /** Server time, in ms. The invite stops working INVITE_TTL_MS after it. */
  createdAt: number;
  /** The uid that joined with it, or null while it is unused. */
  usedBy: string | null;
}

/** A /staff/{uid} record, as the owner's staff list shows it. */
export interface StaffMember {
  uid: string;
  name: string;
  /** Known for people who joined by invite; seed:staff records have none. */
  email: string | null;
  role: InviteRole;
}

export const INVITE_DAYS = 7;
export const INVITE_TTL_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;
export const INVITE_ID_LENGTH = 24;
/** As firestore.rules accepts it. */
const INVITE_ID = /^[A-Za-z0-9]{20,64}$/;
export const MAX_STAFF_NAME = 60;

export function generateInviteId(): string {
  // The table codes' generator: unbiased letters and digits from
  // crypto.getRandomValues.
  return generateTableKey(INVITE_ID_LENGTH);
}

export function isInviteId(value: unknown): value is string {
  return typeof value === "string" && INVITE_ID.test(value);
}

/**
 * The link to send. The id rides in the fragment, which browsers never send
 * to a server or put in a Referer header, so it stays out of hosting logs.
 */
export function inviteLink(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}/join#${id}`;
}

/** The invite id in a /join page's `location.hash`, or null. */
export function inviteIdFromHash(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  return isInviteId(id) ? id : null;
}

export function inviteExpiresAt(invite: Pick<Invite, "createdAt">): number {
  return invite.createdAt + INVITE_TTL_MS;
}

export type InviteState = "open" | "used" | "expired";

export function inviteState(
  invite: Pick<Invite, "createdAt" | "usedBy">,
  now: number,
): InviteState {
  if (invite.usedBy !== null) return "used";
  return now < inviteExpiresAt(invite) ? "open" : "expired";
}

export function cleanStaffName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_STAFF_NAME);
}

function millis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // A Firestore Timestamp, without importing the SDK here.
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis;
  return typeof toMillis === "function"
    ? (toMillis.call(value) as number)
    : null;
}

/**
 * An /invites document, or null for one the app should not offer: a bad id,
 * an unknown role, or no createdAt yet (a pending server timestamp).
 */
export function parseInvite(id: string, data: unknown): Invite | null {
  if (!isInviteId(id) || typeof data !== "object" || data === null) {
    return null;
  }
  const d = data as Record<string, unknown>;
  const createdAt = millis(d.createdAt);
  if (d.role !== "staff" && d.role !== "owner") return null;
  if (createdAt === null) return null;
  return {
    id,
    role: d.role,
    createdAt,
    usedBy: typeof d.usedBy === "string" ? d.usedBy : null,
  };
}

/** Same reading of `role` as roleFromStaffDoc: anything but "owner" is staff. */
export function parseStaffMember(uid: string, data: unknown): StaffMember {
  const d =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const email = typeof d.email === "string" && d.email ? d.email : null;
  const name =
    typeof d.name === "string" && d.name.trim()
      ? d.name.trim()
      : (email?.split("@")[0] ?? t("invites.noName"));
  return { uid, name, email, role: d.role === "owner" ? "owner" : "staff" };
}

/**
 * The owner may not remove or demote themselves while nobody else is an
 * owner: that would leave the cafe with no one who can reach this page, and
 * getting back in would take a terminal again.
 */
export function isLastOwner(members: StaffMember[], uid: string): boolean {
  const owners = members.filter((m) => m.role === "owner");
  return owners.length === 1 && owners[0].uid === uid;
}
