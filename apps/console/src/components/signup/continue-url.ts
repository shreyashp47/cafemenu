/**
 * Where the link in the verification email lands afterwards: back on the
 * sign-up page, which carries on from the draft. Must be on a domain the
 * platform project authorises (Authentication → Settings).
 */
export function continueUrl(): string | undefined {
  return typeof window === "undefined"
    ? undefined
    : `${window.location.origin}/signup`;
}
