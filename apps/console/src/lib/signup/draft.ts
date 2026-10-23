/**
 * The sign-up form kept in this browser between pressing "Create account"
 * and the cafe being saved: the rules refuse every write until the email is
 * verified, so the cafe cannot be written the moment the account exists.
 * Also where it is if the owner reloads, or closes the tab and comes back.
 *
 * Never the password. Removed once the cafe and its setup documents are
 * saved. Like the demo store, it falls back to memory when storage is off.
 */

import { THEMES, type ThemeId } from "@cafemenu/shared";
import { isPlainObject } from "../platform/validate";
import { emptyForm, type FormLogo, type SignupForm } from "./form";
import { isStarterId, type MenuChoice } from "./menu";

export const DRAFT_STORAGE_KEY = "cafemenu-console.signup.v1";

export interface SignupDraft {
  /** The form as it was sent, password left out. */
  form: Omit<SignupForm, "password">;
  /** The account it was sent for, so another account does not pick it up. */
  email: string;
  /** Set once the cafe exists, so a retry only saves what is left. */
  cafeId: string | null;
}

let memory: string | null = null;

function storage(): Storage | null {
  try {
    const store = globalThis.localStorage;
    const probe = "__cafemenu_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

const str = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

function parseLogo(value: unknown): FormLogo | null {
  if (!isPlainObject(value) || typeof value.png !== "string") return null;
  const { width, height, original } = value;
  if (typeof width !== "number" || typeof height !== "number") return null;
  const o = isPlainObject(original) ? original : {};
  return {
    png: value.png,
    width,
    height,
    original: {
      width: typeof o.width === "number" ? o.width : width,
      height: typeof o.height === "number" ? o.height : height,
    },
  };
}

function parseMenu(value: unknown): MenuChoice {
  if (isPlainObject(value)) {
    if (value.kind === "template" && isStarterId(value.id)) {
      return { kind: "template", id: value.id };
    }
    if (value.kind === "blank") return { kind: "blank" };
    if (value.kind === "import") return { kind: "import" };
  }
  return emptyForm().menu;
}

/** A stored draft, field by field; anything odd reads as the blank form's. */
export function parseDraft(raw: string | null): SignupDraft | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isPlainObject(data) || !isPlainObject(data.form)) return null;
    if (typeof data.email !== "string") return null;
    const f = data.form;
    const blank = emptyForm();
    const theme = (THEMES as readonly unknown[]).includes(f.theme)
      ? (f.theme as ThemeId)
      : blank.theme;
    return {
      email: data.email,
      cafeId: typeof data.cafeId === "string" ? data.cafeId : null,
      form: {
        name: str(f.name, ""),
        site: str(f.site, ""),
        siteEdited: f.siteEdited === true,
        email: str(f.email, data.email),
        country: str(f.country, ""),
        currency: str(f.currency, blank.currency),
        timeZone: str(f.timeZone, blank.timeZone),
        locale: str(f.locale, blank.locale),
        region: str(f.region, blank.region),
        tables: str(f.tables, blank.tables),
        theme,
        accent: typeof f.accent === "string" ? f.accent : null,
        logo: parseLogo(f.logo),
        menu: parseMenu(f.menu),
        menuText: str(f.menuText, ""),
      },
    };
  } catch {
    return null;
  }
}

export function loadDraft(): SignupDraft | null {
  const store = storage();
  return parseDraft(store ? store.getItem(DRAFT_STORAGE_KEY) : memory);
}

/** The form with no password in it, whatever was passed. */
function withoutPassword(
  form: SignupForm | Omit<SignupForm, "password">,
): Omit<SignupForm, "password"> {
  const copy: Partial<SignupForm> = { ...form };
  delete copy.password;
  return copy as Omit<SignupForm, "password">;
}

export function saveDraft(draft: SignupDraft) {
  const raw = JSON.stringify({ ...draft, form: withoutPassword(draft.form) });
  const store = storage();
  try {
    if (store) {
      store.setItem(DRAFT_STORAGE_KEY, raw);
      return;
    }
  } catch {
    // Full (a large logo): keep it for this tab.
  }
  memory = raw;
}

export function clearDraft() {
  memory = null;
  storage()?.removeItem(DRAFT_STORAGE_KEY);
}

/** A draft from the form as sent. */
export function draftOf(form: SignupForm, email: string): SignupDraft {
  return { form: withoutPassword(form), email, cafeId: null };
}
