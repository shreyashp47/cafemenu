/** What a Firebase project ID and a Hosting site name look like. */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
// A site name becomes <name>.web.app, so it must be a DNS label.
export const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
