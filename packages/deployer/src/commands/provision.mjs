/**
 * `deployer provision`: turn a fresh Firebase project into one a cafe can run
 * on. Each step reads the current state first and only changes what is
 * missing, so a second run changes nothing. Steps that need a person (for
 * example a console button Google won't let a service account press) are
 * collected and reported together at the end, after everything else is done.
 */
import { randomBytes } from "node:crypto";

import {
  createWebApp,
  getFirebaseProject,
  getWebAppConfig,
  listWebApps,
} from "../apis/firebase.mjs";
import { createDatabase, getDatabase } from "../apis/firestore.mjs";
import { createSite, getSite, setSiteApp } from "../apis/hosting.mjs";
import { getAuthConfig, updateAuthConfig } from "../apis/identitytoolkit.mjs";
import { enableServices, getServiceStates } from "../apis/serviceusage.mjs";
import { ActionNeededError, ApiError, SiteNameTakenError } from "../errors.mjs";
import { act, isAlreadyExists } from "./act.mjs";

/** The APIs the cafe app and the deployer use in the cafe's project. */
export const REQUIRED_APIS = [
  "firebase.googleapis.com",
  "firebasehosting.googleapis.com",
  "firebaserules.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  // Refreshes signed-in users' ID tokens in the browser.
  "securetoken.googleapis.com",
  "cloudresourcemanager.googleapis.com",
];

export const DEFAULT_APP_NAME = "CafeMenu";

const isServiceDisabled = (error) =>
  error instanceof ApiError &&
  error.status === 403 &&
  /SERVICE_DISABLED|has not been used|is disabled/i.test(error.reason);

/**
 * A freshly enabled API can answer SERVICE_DISABLED for a minute or two while
 * the change spreads. Only used for APIs this run just turned on.
 */
async function whenServiceIsUp(ctx, justEnabled, fn) {
  if (!justEnabled) return fn();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isServiceDisabled(error) || attempt >= 12) throw error;
      await ctx.sleep(10_000);
    }
  }
}

export const isNameTaken = (error) =>
  error instanceof ApiError &&
  (isAlreadyExists(error) ||
    /already exists|already taken|is taken|reserved|not available/i.test(
      error.reason,
    ));

/** Up to two free names close to `site`, checked with validate-only creates. */
async function freeAlternatives(ctx, site) {
  const base = site.slice(0, 50).replace(/-+$/, "");
  const candidates = [
    `${base}-cafe`,
    `${base}-menu`,
    `${base}-${randomBytes(2).toString("hex")}`,
  ];
  const free = [];
  for (const name of candidates) {
    try {
      await createSite(ctx.api, ctx.project, name, { validateOnly: true });
      free.push(name);
      if (free.length === 2) break;
    } catch {
      /* taken or invalid: not a suggestion */
    }
  }
  return free;
}

export async function provision(
  ctx,
  { region, site, appName = DEFAULT_APP_NAME },
) {
  const { api, log, project, dryRun } = ctx;
  const todo = [];
  log.title(`Setting up project ${project}`);

  // --- Firebase project --------------------------------------------------
  log.step("Firebase project");
  const firebaseProject = await getFirebaseProject(api, project);
  if (!firebaseProject) {
    throw new ActionNeededError(
      `${project} isn't a Firebase project, or ${ctx.clientEmail} can't see it.`,
      {
        hint: `Check the project ID, and run \`deployer check --project ${project}\` to see which permissions are missing.`,
      },
    );
  }
  log.same(
    `${firebaseProject.displayName ?? project} (project number ${firebaseProject.projectNumber})`,
  );
  const parent = `projects/${firebaseProject.projectNumber}`;

  // --- APIs --------------------------------------------------------------
  log.step("APIs");
  const states = await getServiceStates(api, parent, REQUIRED_APIS);
  const off = REQUIRED_APIS.filter((id) => states.get(id) !== "ENABLED");
  const on = REQUIRED_APIS.filter((id) => !off.includes(id));
  if (on.length) log.same(`already on: ${on.join(", ")}`);
  if (off.length) {
    await act(
      ctx,
      {
        would: `would turn on: ${off.join(", ")}`,
        done: `turned on: ${off.join(", ")}`,
      },
      () => enableServices(api, parent, off),
    );
  }
  // In a dry run an API that's still off can't be asked anything, so its
  // step reports what it would do without looking.
  const unreadable = (id) => dryRun && off.includes(id);
  const fresh = (id) => !dryRun && off.includes(id);

  // --- Firestore database ------------------------------------------------
  log.step("Firestore database");
  if (unreadable("firestore.googleapis.com")) {
    log.change(`would create the (default) database in ${region}`);
  } else {
    const database = await whenServiceIsUp(
      ctx,
      fresh("firestore.googleapis.com"),
      () => getDatabase(api, project),
    );
    if (database?.type && database.type !== "FIRESTORE_NATIVE") {
      todo.push(
        new ActionNeededError(
          `The (default) database is in ${database.type} mode; the cafe app needs Firestore in Native mode.`,
          {
            hint: "A database's mode can't be changed. Use a new Firebase project.",
          },
        ),
      );
      log.warn(`exists in ${database.type} mode, not Native mode`);
    } else if (database && database.locationId !== region) {
      log.warn(
        `already exists in ${database.locationId}, not ${region}. A database can't move, so it stays there.`,
      );
    } else if (database) {
      log.same(`(default) exists in ${database.locationId}`);
    } else {
      await act(
        ctx,
        {
          would: `would create the (default) database in ${region}`,
          done: `created the (default) database in ${region}`,
        },
        async () => {
          try {
            await createDatabase(api, project, region);
          } catch (error) {
            // Made by someone else since we looked: fine, it's there.
            if (!isAlreadyExists(error)) throw error;
          }
        },
      );
    }
  }

  // --- Sign-in methods ---------------------------------------------------
  log.step("Sign-in methods");
  if (unreadable("identitytoolkit.googleapis.com")) {
    log.change("would turn on Email/Password and Anonymous sign-in");
  } else {
    const config = await whenServiceIsUp(
      ctx,
      fresh("identitytoolkit.googleapis.com"),
      () => getAuthConfig(api, project),
    );
    if (!config) {
      todo.push(
        new ActionNeededError(
          "Authentication isn't set up in this project yet.",
          {
            hint: "Firebase console → Build → Authentication → Get started, then re-run. (Google only lets billing-enabled projects do this through the API.)",
          },
        ),
      );
      log.warn(
        "Authentication isn't set up yet: needs one click in the console",
      );
    } else {
      const signIn = config.signIn ?? {};
      const mask = [
        ["signIn.email.enabled", signIn.email?.enabled],
        ["signIn.email.passwordRequired", signIn.email?.passwordRequired],
        ["signIn.anonymous.enabled", signIn.anonymous?.enabled],
      ]
        .filter(([, value]) => value !== true)
        .map(([path]) => path);
      if (mask.length === 0) {
        log.same("Email/Password and Anonymous are on");
      } else {
        await act(
          ctx,
          {
            would: `would set ${mask.join(", ")}`,
            done: `set ${mask.join(", ")}`,
          },
          () =>
            updateAuthConfig(
              api,
              project,
              {
                signIn: {
                  email: { enabled: true, passwordRequired: true },
                  anonymous: { enabled: true },
                },
              },
              mask,
            ),
        );
      }
    }
  }

  // --- Web app -----------------------------------------------------------
  log.step(`Web app "${appName}"`);
  const apps = await listWebApps(api, project);
  let app = apps.find(
    (a) => a.displayName === appName && a.state !== "DELETED",
  );
  if (app) {
    log.same(`registered (${app.appId})`);
  } else {
    app = await act(
      ctx,
      {
        would: `would register web app "${appName}"`,
        done: (created) => `registered web app "${appName}" (${created.appId})`,
      },
      () => createWebApp(api, project, appName),
    );
  }
  let webConfig = null;
  if (app) {
    webConfig = await getWebAppConfig(api, project, app.appId);
    log.info(
      `config: projectId ${webConfig.projectId}, authDomain ${webConfig.authDomain}`,
    );
  }

  // --- Hosting site ------------------------------------------------------
  log.step(`Hosting site "${site}"`);
  let existing = null;
  if (!unreadable("firebasehosting.googleapis.com")) {
    try {
      existing = await whenServiceIsUp(
        ctx,
        fresh("firebasehosting.googleapis.com"),
        () => getSite(api, project, site),
      );
    } catch (error) {
      // A site owned by another project can answer 403; the create below
      // tells "taken" from "no permission" for certain.
      if (!(error instanceof ApiError && error.status === 403)) throw error;
    }
  }
  let siteUrl = `https://${site}.web.app`;
  if (existing) {
    siteUrl = existing.defaultUrl ?? siteUrl;
    log.same(`exists in this project: ${siteUrl}`);
    if (app && existing.appId !== app.appId) {
      await act(
        ctx,
        {
          would: `would link the site to web app ${app.appId}`,
          done: `linked the site to web app ${app.appId}`,
        },
        () => setSiteApp(api, project, site, app.appId),
      );
    } else if (!app) {
      log.change(`would link the site to the new web app`);
    }
  } else if (unreadable("firebasehosting.googleapis.com")) {
    log.change(
      `would create ${siteUrl} (the name can't be checked until Hosting is on)`,
    );
  } else {
    try {
      if (dryRun) {
        await createSite(api, project, site, {
          appId: app?.appId,
          validateOnly: true,
        });
        log.change(`would create ${siteUrl} (the name is free)`);
      } else {
        const created = await createSite(api, project, site, {
          appId: app.appId,
        });
        siteUrl = created.defaultUrl ?? siteUrl;
        log.change(`created ${siteUrl}`);
      }
    } catch (error) {
      if (!isNameTaken(error)) throw error;
      log.warn(`"${site}" is taken by another Firebase project`);
      todo.push(
        new SiteNameTakenError(site, await freeAlternatives(ctx, site)),
      );
    }
  }

  // --- Done --------------------------------------------------------------
  log.blank();
  if (todo.length === 1) throw todo[0];
  if (todo.length > 1) {
    throw new ActionNeededError(
      `${todo.length} things need doing before setup can finish:`,
      {
        hint: todo
          .map((e) => `- ${e.message}${e.hint ? ` ${e.hint}` : ""}`)
          .join("\n"),
        details: todo,
      },
    );
  }
  log.say(
    log.changes.length === 0
      ? `Nothing to change: ${project} is already set up.`
      : dryRun
        ? `Dry run: ${log.changes.length} change(s) would be made.`
        : `Done: ${project} is set up. Site: ${siteUrl}`,
  );
  return {
    projectNumber: firebaseProject.projectNumber,
    appId: app?.appId ?? null,
    webConfig,
    siteUrl,
    changes: log.changes,
  };
}
