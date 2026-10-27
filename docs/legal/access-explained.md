# Your access, explained

> **Draft, not legal advice, not in force.** This page must be reviewed by a
> qualified lawyer before the first outside cafe signs up. Anything marked
> `[[TO DECIDE: …]]` is not settled.

To build your cafe's site and keep it updated, CafeMenu needs to work inside
**your** Firebase project. You let it in by adding one member to the project:
CafeMenu's deploy service account. Here is exactly what that means.

## What you're granting

**Who:** `[[TO DECIDE: the deploy service account's address, settled by the Phase 0 spike]]`.
It's a robot account, not a person. CafeMenu's deployer uses it.

**Roles:** [[TO DECIDE: the exact IAM roles, settled by the Phase 0 spike]].

**How much that is:** close to admin. It can set up and change almost
everything the cafe needs, and it **can technically read your orders**. It
can't see your Google account, your other projects, or your billing details,
and it can't delete your project.
[[TO DECIDE: confirm these limits once the roles are known]]

## Why each part is needed

| CafeMenu needs to…                                                 | So that…                                                                                              | Role                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------- |
| Turn on Firebase services and register your web app                | your project has everything the cafe app uses, without you clicking through each setting              | [[TO DECIDE: role]] |
| Create your database and deploy its **security rules** and indexes | orders and the menu are protected, and each release ships the rules it was tested with                | [[TO DECIDE: role]] |
| Turn on sign-in and **create your owner account**                  | you get a "set your password" email from your own project, and customers can order without logging in | [[TO DECIDE: role]] |
| Deploy your **site** and add its web address                       | `your-cafe.web.app` shows the release you chose, with your name and logo                              | [[TO DECIDE: role]] |
| **Migrate data** when a release changes how it's stored            | upgrades and rollbacks keep working without you doing anything                                        | [[TO DECIDE: role]] |

## What CafeMenu will and won't do

**Will:**

- set your cafe up, then deploy the releases you choose;
- deploy **security fixes** to every cafe, even if you chose to stay on an older
  version;
- run data migrations, using code that's public on GitHub;
- check each deploy works, and roll it back if it doesn't;
- look at a problem in your project **when you ask us to**, and only at what
  that problem needs.

**Won't:**

- read your orders, staff list or customers' data for our own purposes;
- sell, share or analyse your data, or use it for advertising;
- change your menu, prices or tables unless you ask (apart from loading your
  starting menu once at setup);
- touch your billing or your other Google projects.

The full promise is in the [privacy policy](privacy-policy.md#2-what-cafemenu-can-reach-in-your-firebase-project).

## How to check it

The Firebase console's **Users and permissions** page **doesn't list robot
accounts**, so you won't see CafeMenu there, even when it's connected. Check on
the Google Cloud IAM page instead:

1. Open
   [console.cloud.google.com/iam-admin/iam](https://console.cloud.google.com/iam-admin/iam),
   signed in with the Google account that owns your cafe's project. The
   CafeMenu owner area links straight to this page with your project already
   picked.
2. Make sure your cafe's project is selected at the top of the page.
3. On the **View by principals** tab, find
   `[[TO DECIDE: the deploy service account's address]]`. The **Role** column
   shows what it has.

If it has any role not listed above, tell us. It shouldn't.

You can also see what the deployer has done in your project under **Logging →
Logs Explorer** (Cloud Audit Logs) in the same console.

## How to remove it

1. On the same IAM page, tick the box next to CafeMenu's deploy service account.
2. Press **Remove access**, then confirm.

That's it. From that moment:

- CafeMenu can't reach your project at all;
- updates **and security fixes** stop;
- your site keeps running on its last release, and your data stays in your
  project, where it always was.

Changed your mind? Add the member again and press **Check connection** in the
console.

To delete your CafeMenu console account as well, see
[Leaving](privacy-policy.md#7-leaving-and-deleting-your-console-data).

## Maintenance after leaving

If CafeMenu had put your site into **maintenance** (customers see a "back
soon" page and can't order) when you removed its access, it stays on: only
CafeMenu's deploy account can write that setting, and it can't reach your
project any more. You can end it yourself, as the project's owner:

1. Open the [Firebase console](https://console.firebase.google.com/), pick
   your cafe's project, and go to **Firestore Database**.
2. Open the `config` collection, then the `site` document.
3. Find the field called `maintenance`. Hover over it and press the bin icon to
   delete the field (or set it to `null`).

Your customers can order again within a minute; the page follows the setting
live. Leave everything else in `config/site` as it is: it holds your cafe's
name, look and other settings. Maintenance you turned on yourself, from your
cafe's dashboard, is in `config/ownerMaintenance`, and you can turn that off
from the dashboard as usual.

Questions: [[TO DECIDE: support contact email address]].
