/**
 * Where a cafe's Firestore database can live: the location IDs the Firestore
 * Admin API takes (`deployer provision --region`). A database cannot move
 * once created, so the owner picks one at sign-up, pre-filled from their
 * country, and it is fixed when setup starts.
 *
 * From https://firebase.google.com/docs/firestore/locations, October 2026.
 * Only locations that have been offered for some years are listed; a newer
 * one is a line here and a name in messages/en.json (`locations`). The rules
 * check only the shape of an ID (REGION_FORMAT in validate.ts), so adding one
 * needs no rules change.
 *
 * Every location here is open to a project on the free Spark plan. Which is
 * nearest matters a little for speed and nothing for cost.
 */

export const LOCATION_GROUPS = [
  "multi",
  "americas",
  "europe",
  "asia",
  "middleEast",
  "africa",
] as const;
export type LocationGroup = (typeof LOCATION_GROUPS)[number];

export const FIRESTORE_LOCATIONS = [
  // Several regions at once: the most available, a little slower to write.
  { id: "nam5", group: "multi" },
  { id: "eur3", group: "multi" },

  { id: "us-central1", group: "americas" },
  { id: "us-east1", group: "americas" },
  { id: "us-east4", group: "americas" },
  { id: "us-west1", group: "americas" },
  { id: "us-west2", group: "americas" },
  { id: "us-west3", group: "americas" },
  { id: "us-west4", group: "americas" },
  { id: "northamerica-northeast1", group: "americas" },
  { id: "northamerica-northeast2", group: "americas" },
  { id: "southamerica-east1", group: "americas" },
  { id: "southamerica-west1", group: "americas" },

  { id: "europe-west1", group: "europe" },
  { id: "europe-west2", group: "europe" },
  { id: "europe-west3", group: "europe" },
  { id: "europe-west4", group: "europe" },
  { id: "europe-west6", group: "europe" },
  { id: "europe-west8", group: "europe" },
  { id: "europe-west9", group: "europe" },
  { id: "europe-central2", group: "europe" },
  { id: "europe-north1", group: "europe" },
  { id: "europe-southwest1", group: "europe" },

  { id: "asia-south1", group: "asia" },
  { id: "asia-south2", group: "asia" },
  { id: "asia-southeast1", group: "asia" },
  { id: "asia-southeast2", group: "asia" },
  { id: "asia-east1", group: "asia" },
  { id: "asia-east2", group: "asia" },
  { id: "asia-northeast1", group: "asia" },
  { id: "asia-northeast2", group: "asia" },
  { id: "asia-northeast3", group: "asia" },
  { id: "australia-southeast1", group: "asia" },
  { id: "australia-southeast2", group: "asia" },

  { id: "me-central1", group: "middleEast" },
  { id: "me-west1", group: "middleEast" },

  { id: "africa-south1", group: "africa" },
] as const satisfies readonly { id: string; group: LocationGroup }[];

export type FirestoreLocation = (typeof FIRESTORE_LOCATIONS)[number]["id"];

export const LOCATION_IDS: readonly string[] = FIRESTORE_LOCATIONS.map(
  (l) => l.id,
);

export const isFirestoreLocation = (
  value: unknown,
): value is FirestoreLocation =>
  typeof value === "string" && LOCATION_IDS.includes(value);
