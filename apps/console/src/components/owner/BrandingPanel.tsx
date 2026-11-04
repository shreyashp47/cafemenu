"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatMoney, starterPrice } from "@cafemenu/shared";
import { fromBase64, toBase64 } from "@/lib/bytes";
import type { DataBundle } from "@/lib/data/types";
import { errorText, fill, messages } from "@/lib/messages";
import type { BackendRequest, Cafe, Deployment } from "@/lib/platform/model";
import {
  brandingChange,
  brandingFormOf,
  brandingProblems,
  firstBrandingProblem,
  settingsFromBranding,
  type BrandingField,
  type BrandingForm,
} from "@/lib/owner/branding";
import { requestState } from "@/lib/owner/updates";
import { countryName, guessCountry } from "@/lib/signup/countries";
import {
  currencyOptions,
  formatSample,
  localeOptions,
  zoneOffsets,
  zoneOptions,
} from "@/lib/signup/places";
import { Button, TextButton } from "../Button";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";
import {
  AccentPicker,
  LogoPicker,
  ThemePicker,
  logoUrl,
} from "../form/LookControls";
import { ThemePreview } from "../signup/ThemePreview";

const { branding: text } = messages.cafe;
const { signup } = messages;
const problemText = signup.problems;

const selectClass = `${controlClass} min-h-tap`;

/** The control each field's problem takes the focus to. */
const FOCUS: Record<BrandingField, string> = {
  name: "brand-name",
  tagline: "brand-tagline",
  accent: "brand-accent-hex",
  currency: "brand-currency",
  timeZone: "brand-timezone",
  locale: "brand-locale",
};

type Result =
  | { kind: "saved" }
  | { kind: "queued" }
  | { kind: "pending" }
  | { kind: "nothing" }
  | { kind: "error"; text: string }
  | { kind: "unrequested"; text: string };

/**
 * Name, tagline, logo, theme, accent, currency, time zone and language. Save
 * writes the cafe's settings on the platform (the owner may, bar the plan),
 * and its new logo if there is one, then asks the backend to put them on the
 * site (DeployRequests.syncBranding). Only a live cafe has a site to change.
 */
export function BrandingPanel({
  data,
  cafe,
  deployments,
  requests = [],
}: {
  data: DataBundle;
  cafe: Cafe;
  deployments: readonly Deployment[];
  /** The owner's latest requests for the cafe (#77), newest first. */
  requests?: readonly BackendRequest[];
}) {
  const base = cafe.settings;
  const [form, setForm] = useState<BrandingForm>(() => brandingFormOf(base));
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [siteLogo, setSiteLogo] = useState<string | null>(null);

  // The logo CafeMenu still holds from sign-up, to preview with. Once the
  // backend has put it on the site there may be none, and the site's own is
  // not shown here.
  useEffect(() => {
    let live = true;
    data.setup.getLogo(cafe.id).then(
      (png) => {
        if (live) setSiteLogo(png ? toDataUrl(png) : null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data, cafe.id]);

  const live = cafe.status === "live";
  const state = requestState(cafe, deployments, requests);
  const problems = brandingProblems(form);
  const change = brandingChange(base, form);
  const needsConfirm = change.currencyChanged && !confirmed;

  const countries = guessCountry([], form.timeZone) ?? "";
  const currencies = useMemo(
    () => currencyOptions(form.currency),
    [form.currency],
  );
  const zones = useMemo(
    () => zoneOptions(countries, form.timeZone),
    [countries, form.timeZone],
  );
  const locales = useMemo(() => localeOptions(form.locale), [form.locale]);
  const offsets = zoneOffsets(form.timeZone);
  const sample = formatSample(form.locale, form.currency, form.timeZone);

  const money = {
    currency: form.currency,
    locale: form.locale,
    moneyUnit: base.moneyUnit,
    maxOrderTotal: base.maxOrderTotal,
  };
  const preview = useMemo(() => {
    try {
      const price = starterPrice(450, money);
      return {
        name: signup.preview.item,
        price: price === null ? null : formatMoney(price, money),
      };
    } catch {
      return { name: signup.preview.item, price: null };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.currency, form.locale, base.moneyUnit, base.maxOrderTotal]);

  if (!live) {
    return (
      <FormSection id="branding" title={text.title}>
        <p className="text-muted">{text.closed}</p>
      </FormSection>
    );
  }

  const set = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const error = (field: BrandingField): string | undefined => {
    if (!attempted) return undefined;
    const code = problems[field];
    if (!code) return undefined;
    if (field === "tagline") return text.problems.tagline["too-long"];
    if (field === "accent") return undefined; // AccentPicker says its own.
    return (problemText[field] as Record<string, string>)[code];
  };

  const zoneHint = offsets
    ? `${signup.timeZone.hint} ${
        offsets.daylight
          ? fill(signup.timeZone.daylight, {
              standard: offsets.standard,
              daylight: offsets.daylight,
            })
          : fill(signup.timeZone.same, { offset: offsets.standard })
      }`
    : signup.timeZone.hint;
  const localeHint = sample
    ? `${text.locale.hint} ${fill(signup.locale.sample, sample)}`
    : text.locale.hint;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setResult(null);
    const first = firstBrandingProblem(problems);
    if (first) {
      document.getElementById(FOCUS[first])?.focus();
      return;
    }
    if (needsConfirm) {
      document.getElementById("brand-currency-confirm")?.focus();
      return;
    }
    if (!change.changed) {
      setResult({ kind: "nothing" });
      return;
    }
    const next = settingsFromBranding(base, form);
    setBusy(true);
    try {
      if (form.logo.kind === "replace") {
        await data.setup.saveLogo(cafe.id, fromBase64(form.logo.logo.png));
      } else if (form.logo.kind === "remove") {
        await data.setup.removeLogo(cafe.id);
      }
      await data.cafes.updateSettings(cafe.id, next);
    } catch (e) {
      setResult({ kind: "error", text: errorText(e) });
      setBusy(false);
      return;
    }
    // Saved. The form now is the cafe's settings.
    setForm(brandingFormOf(next));
    setSiteLogo(
      form.logo.kind === "replace"
        ? logoDataUrl(form.logo.logo.png)
        : form.logo.kind === "remove"
          ? null
          : siteLogo,
    );
    setConfirmed(false);
    setAttempted(false);
    await ask();
    setBusy(false);
  };

  /** Asks the backend to put the saved settings on the site. */
  const ask = async () => {
    try {
      const receipt = await data.deploys.syncBranding(cafe);
      // A request the backend picks up on its next run takes minutes.
      setResult({ kind: "requestId" in receipt ? "queued" : "saved" });
    } catch (e) {
      const pending =
        typeof e === "object" &&
        e !== null &&
        (e as { code?: unknown }).code === "backend-pending";
      setResult(
        pending
          ? { kind: "pending" }
          : { kind: "unrequested", text: errorText(e) },
      );
    }
  };

  const retry = async () => {
    setBusy(true);
    await ask();
    setBusy(false);
  };

  const logo = form.logo;
  const message = result
    ? result.kind === "saved"
      ? text.saved
      : result.kind === "queued"
        ? text.savedQueued
        : result.kind === "pending"
          ? text.savedPending
          : result.kind === "nothing"
            ? text.nothing
            : result.kind === "unrequested"
              ? fill(text.unrequested, { error: result.text })
              : result.text
    : "";

  return (
    <FormSection id="branding" title={text.title}>
      <p className="text-text">{text.lead}</p>
      <form noValidate onSubmit={save} className="space-y-6">
        <Field
          id="brand-name"
          label={text.name.label}
          hint={signup.name.hint}
          error={error("name")}
        >
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            autoComplete="off"
            {...controlProps("brand-name", {
              hint: signup.name.hint,
              error: error("name"),
            })}
            className={`${controlClass} min-h-tap`}
          />
        </Field>

        <Field
          id="brand-tagline"
          label={text.tagline.label}
          hint={text.tagline.hint}
          error={error("tagline")}
        >
          <input
            type="text"
            value={form.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            autoComplete="off"
            {...controlProps("brand-tagline", {
              hint: text.tagline.hint,
              error: error("tagline"),
            })}
            className={`${controlClass} min-h-tap`}
          />
        </Field>

        <ThemePicker
          idPrefix="brand"
          theme={form.theme}
          onChange={(theme) => set("theme", theme)}
        />

        <AccentPicker
          idPrefix="brand"
          theme={form.theme}
          accent={form.accent}
          onChange={(accent) => set("accent", accent)}
          problem={attempted ? problems.accent : undefined}
        />

        <LogoPicker
          idPrefix="brand"
          logo={logo.kind === "replace" ? logo.logo : null}
          onChange={(next) =>
            set(
              "logo",
              next ? { kind: "replace", logo: next } : { kind: "keep" },
            )
          }
          where={text.logo.where}
        >
          {logo.kind !== "replace" && (
            <div className="mt-3 space-y-2">
              <p className="text-muted text-sm">
                {base.logo ? text.logo.now : text.logo.none}
              </p>
              {base.logo && (
                <label className="min-h-tap flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={logo.kind === "remove"}
                    onChange={(e) =>
                      set(
                        "logo",
                        e.target.checked
                          ? { kind: "remove" }
                          : { kind: "keep" },
                      )
                    }
                    className="accent-brand h-5 w-5"
                  />
                  <span>{text.logo.remove}</span>
                </label>
              )}
            </div>
          )}
        </LogoPicker>

        <ThemePreview
          theme={form.theme}
          accent={
            form.accent && /^#[0-9a-f]{6}$/i.test(form.accent)
              ? form.accent
              : null
          }
          name={form.name}
          logo={
            logo.kind === "replace"
              ? logoUrl(logo.logo.png)
              : logo.kind === "remove"
                ? null
                : siteLogo
          }
          siteLogo={logo.kind === "keep" && base.logo !== null}
          item={preview}
        />

        <div className="border-line space-y-6 border-l-4 pl-4">
          <Field
            id="brand-currency"
            label={signup.currency.label}
            hint={signup.currency.hint}
            error={error("currency")}
          >
            <select
              value={form.currency}
              onChange={(e) => {
                set("currency", e.target.value);
                setConfirmed(false);
              }}
              {...controlProps("brand-currency", {
                hint: true,
                error: error("currency"),
              })}
              className={selectClass}
            >
              {currencies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          {change.currencyChanged && (
            <div
              role="group"
              aria-labelledby="brand-currency-warning"
              className="bg-accent-soft text-accent-ink space-y-3 rounded-md p-4"
            >
              <p id="brand-currency-warning" className="font-semibold">
                {text.currency.title}
              </p>
              <p>
                {fill(text.currency.text, {
                  before: priceIn(base.currency, base.locale, base.moneyUnit),
                  after: priceIn(form.currency, form.locale, base.moneyUnit),
                })}
              </p>
              <label className="min-h-tap flex cursor-pointer items-center gap-2 font-medium">
                <input
                  id="brand-currency-confirm"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  aria-invalid={attempted && needsConfirm ? true : undefined}
                  className="accent-brand h-5 w-5"
                />
                <span>{text.currency.confirm}</span>
              </label>
              {attempted && needsConfirm && (
                <p className="text-danger font-medium">
                  {text.problems.needsConfirm}
                </p>
              )}
            </div>
          )}

          <Field
            id="brand-timezone"
            label={signup.timeZone.label}
            hint={zoneHint}
            error={error("timeZone")}
          >
            <select
              value={form.timeZone}
              onChange={(e) => set("timeZone", e.target.value)}
              {...controlProps("brand-timezone", {
                hint: true,
                error: error("timeZone"),
              })}
              className={selectClass}
            >
              {zones.here.length > 0 && (
                <optgroup
                  label={fill(signup.timeZone.here, {
                    country: countryName(countries),
                  })}
                >
                  {zones.here.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={signup.timeZone.all}>
                {zones.all.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>

          <Field
            id="brand-locale"
            label={text.locale.label}
            hint={localeHint}
            error={error("locale")}
          >
            <select
              value={form.locale}
              onChange={(e) => set("locale", e.target.value)}
              {...controlProps("brand-locale", {
                hint: localeHint,
                error: error("locale"),
              })}
              className={selectClass}
            >
              {locales.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {attempted && firstBrandingProblem(problems) && (
          <p role="alert" className="text-danger font-medium">
            {text.fixFields}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy || state === "busy"}>
            {busy ? text.saving : text.save}
          </Button>
          {change.changed && !busy && (
            <TextButton
              onClick={() => {
                setForm(brandingFormOf(base));
                setConfirmed(false);
                setAttempted(false);
                setResult(null);
              }}
            >
              {text.discard}
            </TextButton>
          )}
        </div>
        {state === "busy" && (
          <p className="text-muted">{messages.cafe.updates.request.busy}</p>
        )}
        <div role="status" className="space-y-2">
          <p
            className={
              result?.kind === "error" || result?.kind === "unrequested"
                ? "text-danger font-medium"
                : "text-brand-ink font-medium"
            }
          >
            {message}
          </p>
          {result?.kind === "unrequested" && (
            <TextButton onClick={retry} disabled={busy}>
              {text.retry}
            </TextButton>
          )}
        </div>
      </form>
    </FormSection>
  );
}

const toDataUrl = (png: Uint8Array) => logoDataUrl(toBase64(png));

const logoDataUrl = (base64: string) => `data:image/png;base64,${base64}`;

/** What a stored 12000 reads as in a currency: the same number, new money. */
function priceIn(
  currency: string,
  locale: string,
  moneyUnit: "minor" | "major",
): string {
  try {
    return formatMoney(moneyUnit === "minor" ? 12000 : 120, {
      currency,
      locale,
      moneyUnit,
    });
  } catch {
    return currency;
  }
}
