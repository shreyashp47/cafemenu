/** Service Usage API: which Google APIs are on in a project, and turning them on. */
import { withQuery } from "../http.mjs";

export const SERVICE_USAGE = "https://serviceusage.googleapis.com/v1";

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

/**
 * Map of service id → state ("ENABLED" | "DISABLED"). `parent` is
 * `projects/{number}`; the docs' examples all use the project number.
 */
export async function getServiceStates(api, parent, serviceIds) {
  const states = new Map();
  // At most 30 names per call.
  for (const ids of chunk(serviceIds, 30)) {
    // https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/services/batchGet
    // GET v1/{parent}/services:batchGet?names=… → {services: [{name, state}]}
    // UNVERIFIED: run in spike #4
    const res = await api.get(
      withQuery(`${SERVICE_USAGE}/${parent}/services:batchGet`, {
        names: ids.map((id) => `${parent}/services/${id}`),
      }),
    );
    for (const service of res.services ?? []) {
      states.set(service.name.split("/").pop(), service.state);
    }
  }
  return states;
}

export async function enableServices(api, parent, serviceIds) {
  // At most 20 per call, and each call is all-or-nothing.
  for (const ids of chunk(serviceIds, 20)) {
    // https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/services/batchEnable
    // POST v1/{parent}/services:batchEnable {serviceIds} → Operation
    // UNVERIFIED: run in spike #4
    const op = await api.post(
      `${SERVICE_USAGE}/${parent}/services:batchEnable`,
      {
        serviceIds: ids,
      },
    );
    // https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/operations/get
    // UNVERIFIED: run in spike #4
    await api.waitForOperation(SERVICE_USAGE, op, { what: "Enabling APIs" });
  }
}
