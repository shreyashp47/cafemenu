"use client";

import { useMemo } from "react";
import { fill, messages } from "@/lib/messages";
import { FIRESTORE_LOCATIONS, LOCATION_GROUPS } from "@/lib/platform/locations";
import {
  OTHER_COUNTRY,
  countriesByName,
  countryName,
} from "@/lib/signup/countries";
import {
  isOtherCountry,
  withCountry,
  type FieldProblems,
  type SignupForm,
} from "@/lib/signup/form";
import {
  currencyOptions,
  formatSample,
  localeOptions,
  zoneOptions,
  zoneOffsets,
} from "@/lib/signup/places";
import { Field, controlClass, controlProps } from "../form/Field";

const { signup, locations } = messages;
const problemText = signup.problems;

const selectClass = `${controlClass} min-h-tap`;

/**
 * The country, and the four things it fills in: currency, time zone, number
 * and date format, and where the data is kept. All four stay editable.
 */
export function PlaceFields({
  form,
  onChange,
  problems,
}: {
  form: SignupForm;
  onChange: (form: SignupForm) => void;
  problems: FieldProblems;
}) {
  const countries = useMemo(() => countriesByName(), []);
  const currencies = useMemo(
    () => currencyOptions(form.currency),
    [form.currency],
  );
  const zones = useMemo(
    () => zoneOptions(form.country, form.timeZone),
    [form.country, form.timeZone],
  );
  const locales = useMemo(() => localeOptions(form.locale), [form.locale]);
  const offsets = useMemo(() => zoneOffsets(form.timeZone), [form.timeZone]);
  const sample = formatSample(form.locale, form.currency, form.timeZone);

  const set = (field: keyof SignupForm) => (value: string) =>
    onChange({ ...form, [field]: value });

  const error = <K extends keyof FieldProblems>(
    field: K,
  ): string | undefined => {
    const code = problems[field];
    if (!code) return undefined;
    return (problemText[field] as Record<string, string>)[code as string];
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
  const localeHint = sample ? fill(signup.locale.sample, sample) : undefined;
  const countryHint = isOtherCountry(form)
    ? signup.country.otherHint
    : signup.country.hint;

  return (
    <>
      <Field
        id="signup-country"
        label={signup.country.label}
        hint={countryHint}
        error={error("country")}
      >
        <select
          value={form.country}
          onChange={(e) => onChange(withCountry(form, e.target.value))}
          autoComplete="country"
          {...controlProps("signup-country", {
            hint: countryHint,
            error: error("country"),
          })}
          className={selectClass}
        >
          <option value="" disabled>
            {signup.country.choose}
          </option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
          <option value={OTHER_COUNTRY}>{signup.country.other}</option>
        </select>
      </Field>

      <div className="border-line space-y-6 border-l-4 pl-4">
        <Field
          id="signup-currency"
          label={signup.currency.label}
          hint={signup.currency.hint}
          error={error("currency")}
        >
          <select
            value={form.currency}
            onChange={(e) => set("currency")(e.target.value)}
            {...controlProps("signup-currency", {
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

        <Field
          id="signup-timezone"
          label={signup.timeZone.label}
          hint={zoneHint}
          error={error("timeZone")}
        >
          <select
            value={form.timeZone}
            onChange={(e) => set("timeZone")(e.target.value)}
            {...controlProps("signup-timezone", {
              hint: true,
              error: error("timeZone"),
            })}
            className={selectClass}
          >
            {zones.here.length > 0 && (
              <optgroup
                label={fill(signup.timeZone.here, {
                  country: countryName(form.country),
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
          id="signup-locale"
          label={signup.locale.label}
          hint={localeHint}
          error={error("locale")}
        >
          <select
            value={form.locale}
            onChange={(e) => set("locale")(e.target.value)}
            {...controlProps("signup-locale", {
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

        <Field
          id="signup-region"
          label={signup.region.label}
          hint={signup.region.hint}
          error={error("region")}
        >
          <select
            value={form.region}
            onChange={(e) => set("region")(e.target.value)}
            {...controlProps("signup-region", {
              hint: true,
              error: error("region"),
            })}
            className={selectClass}
          >
            {LOCATION_GROUPS.map((group) => (
              <optgroup key={group} label={locations.groups[group]}>
                {FIRESTORE_LOCATIONS.filter((l) => l.group === group).map(
                  (l) => (
                    <option key={l.id} value={l.id}>
                      {fill(locations.option, {
                        name: locations.names[l.id],
                        id: l.id,
                      })}
                    </option>
                  ),
                )}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}
