/**
 * What a country fills in on the sign-up form: currency, time zone, the
 * number and date format (locale) and where the database lives. Every one of
 * them stays editable; this is only the likeliest start.
 *
 * Names are not here: `countryName` asks Intl.DisplayNames, so they follow
 * the console's language when it has more than one. A country missing from
 * the list is "Somewhere else" on the form, where the owner picks each field.
 *
 * Countries with more than one time zone list the others too, most people
 * first, so the form can offer them at the top of the list. Locales are
 * English where cafes there commonly write menus in English and the local
 * format would switch the digits; the owner can pick another. Regions are the
 * nearest Firestore location (./../platform/locations.ts).
 *
 * Left out: places Firebase does not serve (mainland China, Cuba, Iran,
 * North Korea, Russia, Syria and others under sanctions).
 */

import type { FirestoreLocation } from "../platform/locations";

export interface CountryDefaults {
  currency: string;
  timeZone: string;
  locale: string;
  region: FirestoreLocation;
  /** Its other time zones, if any. */
  zones: readonly string[];
}

type Row = [
  code: string,
  currency: string,
  timeZone: string,
  locale: string,
  region: FirestoreLocation,
  zones?: string[],
];

// prettier-ignore
const ROWS: Row[] = [
  // -- the Americas --
  ["US", "USD", "America/New_York", "en-US", "nam5", ["America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]],
  ["CA", "CAD", "America/Toronto", "en-CA", "northamerica-northeast2", ["America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Regina", "America/Halifax", "America/St_Johns"]],
  ["MX", "MXN", "America/Mexico_City", "es-MX", "us-central1", ["America/Monterrey", "America/Cancun", "America/Tijuana", "America/Hermosillo", "America/Mazatlan", "America/Chihuahua"]],
  ["GT", "GTQ", "America/Guatemala", "es-GT", "us-east1"],
  ["SV", "USD", "America/El_Salvador", "es-SV", "us-east1"],
  ["HN", "HNL", "America/Tegucigalpa", "es-HN", "us-east1"],
  ["NI", "NIO", "America/Managua", "es-NI", "us-east1"],
  ["CR", "CRC", "America/Costa_Rica", "es-CR", "us-east1"],
  ["PA", "USD", "America/Panama", "es-PA", "us-east1"],
  ["DO", "DOP", "America/Santo_Domingo", "es-DO", "us-east1"],
  ["PR", "USD", "America/Puerto_Rico", "es-PR", "us-east1"],
  ["JM", "JMD", "America/Jamaica", "en-JM", "us-east1"],
  ["BS", "BSD", "America/Nassau", "en-BS", "us-east1"],
  ["BB", "BBD", "America/Barbados", "en-BB", "us-east1"],
  ["TT", "TTD", "America/Port_of_Spain", "en-TT", "us-east1"],
  ["CO", "COP", "America/Bogota", "es-CO", "us-east1"],
  ["VE", "VES", "America/Caracas", "es-VE", "us-east1"],
  ["EC", "USD", "America/Guayaquil", "es-EC", "us-east1", ["Pacific/Galapagos"]],
  ["PE", "PEN", "America/Lima", "es-PE", "southamerica-west1"],
  ["BO", "BOB", "America/La_Paz", "es-BO", "southamerica-west1"],
  ["CL", "CLP", "America/Santiago", "es-CL", "southamerica-west1", ["America/Punta_Arenas", "Pacific/Easter"]],
  ["AR", "ARS", "America/Argentina/Buenos_Aires", "es-AR", "southamerica-east1"],
  ["UY", "UYU", "America/Montevideo", "es-UY", "southamerica-east1"],
  ["PY", "PYG", "America/Asuncion", "es-PY", "southamerica-east1"],
  ["BR", "BRL", "America/Sao_Paulo", "pt-BR", "southamerica-east1", ["America/Bahia", "America/Fortaleza", "America/Recife", "America/Belem", "America/Manaus", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"]],

  // -- Europe --
  ["GB", "GBP", "Europe/London", "en-GB", "europe-west2"],
  ["IE", "EUR", "Europe/Dublin", "en-IE", "europe-west2"],
  ["FR", "EUR", "Europe/Paris", "fr-FR", "europe-west9"],
  ["DE", "EUR", "Europe/Berlin", "de-DE", "europe-west3"],
  ["NL", "EUR", "Europe/Amsterdam", "nl-NL", "europe-west4"],
  ["BE", "EUR", "Europe/Brussels", "nl-BE", "europe-west1"],
  ["LU", "EUR", "Europe/Luxembourg", "fr-LU", "europe-west1"],
  ["CH", "CHF", "Europe/Zurich", "de-CH", "europe-west6"],
  ["AT", "EUR", "Europe/Vienna", "de-AT", "europe-west3"],
  ["IT", "EUR", "Europe/Rome", "it-IT", "europe-west8"],
  ["MT", "EUR", "Europe/Malta", "en-MT", "europe-west8"],
  ["ES", "EUR", "Europe/Madrid", "es-ES", "europe-southwest1", ["Atlantic/Canary"]],
  ["PT", "EUR", "Europe/Lisbon", "pt-PT", "europe-southwest1", ["Atlantic/Madeira", "Atlantic/Azores"]],
  ["GR", "EUR", "Europe/Athens", "el-GR", "europe-west8"],
  ["CY", "EUR", "Asia/Nicosia", "el-CY", "europe-west8"],
  ["PL", "PLN", "Europe/Warsaw", "pl-PL", "europe-central2"],
  ["CZ", "CZK", "Europe/Prague", "cs-CZ", "europe-west3"],
  ["SK", "EUR", "Europe/Bratislava", "sk-SK", "europe-central2"],
  ["HU", "HUF", "Europe/Budapest", "hu-HU", "europe-central2"],
  ["SI", "EUR", "Europe/Ljubljana", "sl-SI", "europe-west8"],
  ["HR", "EUR", "Europe/Zagreb", "hr-HR", "europe-west8"],
  ["BA", "BAM", "Europe/Sarajevo", "bs-BA", "europe-west8"],
  ["RS", "RSD", "Europe/Belgrade", "sr-Latn-RS", "europe-central2"],
  ["ME", "EUR", "Europe/Podgorica", "sr-Latn-ME", "europe-central2"],
  ["MK", "MKD", "Europe/Skopje", "mk-MK", "europe-central2"],
  ["AL", "ALL", "Europe/Tirane", "sq-AL", "europe-west8"],
  ["RO", "RON", "Europe/Bucharest", "ro-RO", "europe-central2"],
  ["BG", "EUR", "Europe/Sofia", "bg-BG", "europe-central2"],
  ["MD", "MDL", "Europe/Chisinau", "ro-MD", "europe-central2"],
  // Europe/Kiev rather than Europe/Kyiv: older browsers know only that name.
  ["UA", "UAH", "Europe/Kiev", "uk-UA", "europe-central2"],
  ["EE", "EUR", "Europe/Tallinn", "et-EE", "europe-north1"],
  ["LV", "EUR", "Europe/Riga", "lv-LV", "europe-north1"],
  ["LT", "EUR", "Europe/Vilnius", "lt-LT", "europe-north1"],
  ["FI", "EUR", "Europe/Helsinki", "fi-FI", "europe-north1"],
  ["SE", "SEK", "Europe/Stockholm", "sv-SE", "europe-north1"],
  ["NO", "NOK", "Europe/Oslo", "nb-NO", "europe-north1"],
  ["DK", "DKK", "Europe/Copenhagen", "da-DK", "europe-north1"],
  ["IS", "ISK", "Atlantic/Reykjavik", "is-IS", "europe-west2"],
  ["TR", "TRY", "Europe/Istanbul", "tr-TR", "europe-west3"],
  ["GE", "GEL", "Asia/Tbilisi", "ka-GE", "europe-central2"],
  ["AM", "AMD", "Asia/Yerevan", "hy-AM", "europe-central2"],
  ["AZ", "AZN", "Asia/Baku", "az-Latn-AZ", "europe-central2"],

  // -- the Middle East --
  ["AE", "AED", "Asia/Dubai", "en-AE", "me-central1"],
  ["SA", "SAR", "Asia/Riyadh", "en-SA", "me-central1"],
  ["QA", "QAR", "Asia/Qatar", "en-QA", "me-central1"],
  ["KW", "KWD", "Asia/Kuwait", "en-KW", "me-central1"],
  ["BH", "BHD", "Asia/Bahrain", "en-BH", "me-central1"],
  ["OM", "OMR", "Asia/Muscat", "en-OM", "me-central1"],
  ["JO", "JOD", "Asia/Amman", "en-JO", "me-central1"],
  ["LB", "LBP", "Asia/Beirut", "en-LB", "me-central1"],
  ["IQ", "IQD", "Asia/Baghdad", "en-IQ", "me-central1"],
  ["IL", "ILS", "Asia/Jerusalem", "he-IL", "me-west1"],
  ["EG", "EGP", "Africa/Cairo", "en-EG", "me-central1"],

  // -- South and Central Asia --
  ["IN", "INR", "Asia/Kolkata", "en-IN", "asia-south1"],
  ["PK", "PKR", "Asia/Karachi", "en-PK", "asia-south1"],
  ["BD", "BDT", "Asia/Dhaka", "en-BD", "asia-south1"],
  ["LK", "LKR", "Asia/Colombo", "en-LK", "asia-south1"],
  ["NP", "NPR", "Asia/Kathmandu", "en-NP", "asia-south2"],
  ["BT", "BTN", "Asia/Thimphu", "en-BT", "asia-south2"],
  ["MV", "MVR", "Indian/Maldives", "en-MV", "asia-south1"],
  ["KZ", "KZT", "Asia/Almaty", "ru-KZ", "europe-west3", ["Asia/Qostanay", "Asia/Aqtobe", "Asia/Atyrau", "Asia/Oral"]],
  ["UZ", "UZS", "Asia/Tashkent", "uz-Latn-UZ", "europe-west3"],

  // -- East and Southeast Asia --
  ["JP", "JPY", "Asia/Tokyo", "ja-JP", "asia-northeast1"],
  ["KR", "KRW", "Asia/Seoul", "ko-KR", "asia-northeast3"],
  ["TW", "TWD", "Asia/Taipei", "zh-TW", "asia-east1"],
  ["HK", "HKD", "Asia/Hong_Kong", "en-HK", "asia-east2"],
  ["MO", "MOP", "Asia/Macau", "en-MO", "asia-east2"],
  ["MN", "MNT", "Asia/Ulaanbaatar", "mn-MN", "asia-northeast3"],
  ["SG", "SGD", "Asia/Singapore", "en-SG", "asia-southeast1"],
  ["MY", "MYR", "Asia/Kuala_Lumpur", "en-MY", "asia-southeast1"],
  ["TH", "THB", "Asia/Bangkok", "th-TH", "asia-southeast1"],
  ["VN", "VND", "Asia/Ho_Chi_Minh", "vi-VN", "asia-southeast1"],
  ["PH", "PHP", "Asia/Manila", "en-PH", "asia-southeast1"],
  ["ID", "IDR", "Asia/Jakarta", "id-ID", "asia-southeast2", ["Asia/Pontianak", "Asia/Makassar", "Asia/Jayapura"]],
  ["KH", "KHR", "Asia/Phnom_Penh", "en-KH", "asia-southeast1"],
  ["LA", "LAK", "Asia/Vientiane", "en-LA", "asia-southeast1"],
  ["MM", "MMK", "Asia/Yangon", "en-MM", "asia-southeast1"],
  ["BN", "BND", "Asia/Brunei", "ms-BN", "asia-southeast1"],

  // -- Oceania --
  ["AU", "AUD", "Australia/Sydney", "en-AU", "australia-southeast1", ["Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide", "Australia/Hobart", "Australia/Darwin"]],
  ["NZ", "NZD", "Pacific/Auckland", "en-NZ", "australia-southeast1", ["Pacific/Chatham"]],
  ["FJ", "FJD", "Pacific/Fiji", "en-FJ", "australia-southeast1"],
  ["PG", "PGK", "Pacific/Port_Moresby", "en-PG", "australia-southeast1"],

  // -- Africa --
  ["ZA", "ZAR", "Africa/Johannesburg", "en-ZA", "africa-south1"],
  ["NA", "NAD", "Africa/Windhoek", "en-NA", "africa-south1"],
  ["BW", "BWP", "Africa/Gaborone", "en-BW", "africa-south1"],
  // Zimbabwe's cafes mostly price in US dollars.
  ["ZW", "USD", "Africa/Harare", "en-ZW", "africa-south1"],
  ["ZM", "ZMW", "Africa/Lusaka", "en-ZM", "africa-south1"],
  ["MZ", "MZN", "Africa/Maputo", "pt-MZ", "africa-south1"],
  ["AO", "AOA", "Africa/Luanda", "pt-AO", "africa-south1"],
  ["MU", "MUR", "Indian/Mauritius", "en-MU", "africa-south1"],
  ["KE", "KES", "Africa/Nairobi", "en-KE", "africa-south1"],
  ["TZ", "TZS", "Africa/Dar_es_Salaam", "en-TZ", "africa-south1"],
  ["UG", "UGX", "Africa/Kampala", "en-UG", "africa-south1"],
  ["RW", "RWF", "Africa/Kigali", "en-RW", "africa-south1"],
  ["ET", "ETB", "Africa/Addis_Ababa", "en-ET", "me-central1"],
  ["NG", "NGN", "Africa/Lagos", "en-NG", "europe-west2"],
  ["GH", "GHS", "Africa/Accra", "en-GH", "europe-west2"],
  ["SN", "XOF", "Africa/Dakar", "fr-SN", "europe-southwest1"],
  ["CI", "XOF", "Africa/Abidjan", "fr-CI", "europe-southwest1"],
  ["CM", "XAF", "Africa/Douala", "fr-CM", "europe-west9"],
  ["MA", "MAD", "Africa/Casablanca", "fr-MA", "europe-southwest1"],
  ["DZ", "DZD", "Africa/Algiers", "fr-DZ", "europe-west9"],
  ["TN", "TND", "Africa/Tunis", "fr-TN", "europe-west8"],
];

export const COUNTRIES: Readonly<Record<string, CountryDefaults>> =
  Object.freeze(
    Object.fromEntries(
      ROWS.map(([code, currency, timeZone, locale, region, zones = []]) => [
        code,
        Object.freeze({
          currency,
          timeZone,
          locale,
          region,
          zones: Object.freeze(zones),
        }),
      ]),
    ),
  );

export const COUNTRY_CODES: readonly string[] = ROWS.map(([code]) => code);

/** The form's choice for a country not in the list. */
export const OTHER_COUNTRY = "other";

export function countryDefaults(code: string): CountryDefaults | null {
  return COUNTRIES[code] ?? null;
}

/** Every time zone of the country, its main one first. */
export function countryZones(code: string): string[] {
  const country = countryDefaults(code);
  return country ? [country.timeZone, ...country.zones] : [];
}

/** "India", in `language`; the code itself where Intl has no name for it. */
export function countryName(code: string, language = "en"): string {
  try {
    return (
      new Intl.DisplayNames([language], { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/** Every country in the list, by name, for the form's menu. */
export function countriesByName(
  language = "en",
): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({
    code,
    name: countryName(code, language),
  })).sort((a, b) => a.name.localeCompare(b.name, language));
}

/**
 * The visitor's likely country, or null: the region of one of the browser's
 * languages ("en-IN" is India), else the country of its time zone. Only a
 * guess for the form to start on; a bare "en" says nothing about where.
 */
export function guessCountry(
  languages: readonly string[],
  timeZone?: string,
): string | null {
  for (const tag of languages) {
    try {
      const region = new Intl.Locale(tag).region;
      if (region && COUNTRIES[region]) return region;
    } catch {
      // Not a language tag: try the next one.
    }
  }
  if (!timeZone) return null;
  return (
    COUNTRY_CODES.find((code) => countryZones(code).includes(timeZone)) ?? null
  );
}
