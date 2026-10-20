# CafeMenu privacy policy

> **Draft, not legal advice, not in force.** This policy does not apply to
> anyone yet. It must be reviewed by a qualified lawyer before the first outside
> cafe signs up. Anything marked `[[TO DECIDE: …]]` is not settled.

_Last updated: [[TO DECIDE: date of publishing]]_

This policy explains what CafeMenu keeps about you as a cafe owner, what
CafeMenu can reach inside your cafe's Firebase project and what it promises to
do and not do with it, and who looks after your customers' information.

## Who we are

"CafeMenu", "we" and "us" mean [[TO DECIDE: the legal person who runs
CafeMenu: the maintainer as an individual, or a company, with its registered
name and address]]. CafeMenu is open source: the code that runs the console and
your cafe's site is public at
[github.com/shreyashp47/cafemenu](https://github.com/shreyashp47/cafemenu).

"You" means the cafe owner who signs up on the CafeMenu console. "Your
customers" means the people who order at your tables.

## The short version

- Your cafe's data (menu, orders, staff accounts and customers' sessions) lives
  in **your own Firebase project**, in your own Google account. It was never
  ours and it does not pass through CafeMenu's own systems.
- To set your cafe up and keep it updated, you give CafeMenu's deploy service
  account near-admin access to that project. That access means CafeMenu
  **could** technically read your orders. We use it only to set up, deploy,
  migrate and support your cafe. We never read your order data for our own
  purposes, and never sell it, analyse it or use it for advertising.
- The CafeMenu console keeps a small amount about you: your email, your cafe's
  name and settings, your project ID, your release choice and a history of
  deploys.
- You can remove our access at any time, and ask us to delete everything the
  console keeps about you.

## 1. What the CafeMenu console keeps about you

The console is the CafeMenu website where you sign up, connect your project and
choose releases ([[TO DECIDE: the console's final web address]]). It keeps:

| What                                                                                                                                                                                  | Why                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Your **email address** and sign-in details for the console ([[TO DECIDE: sign-in method; passwords, if used, are handled by Google's Firebase Authentication and we never see them]]) | To give you an account, confirm the email is yours, and tell you about your cafe, releases and these documents.   |
| Your **cafe's name**, web address name, country, currency, time zone, language, number of tables, theme, accent colour and logo                                                       | To build and brand your cafe's site. Most of this is also copied into your own project, where your site reads it. |
| The **starting menu** you choose or paste in during setup                                                                                                                             | To load it into your project once. [[TO DECIDE: whether the console keeps a copy after setup, and for how long]]  |
| Your **Firebase project ID**                                                                                                                                                          | To know which project to deploy to.                                                                               |
| Your **release choice** (auto-update stable or beta, or stay on a version) and current and previous release                                                                           | To deploy the version you chose and let you roll back.                                                            |
| A **history of deploys** and setup steps for your cafe (when, which release, whether it worked, error messages)                                                                       | To show you progress, fix failures, roll back automatically when a deploy breaks, and answer support questions.   |
| **Messages** you send us for support                                                                                                                                                  | To answer them.                                                                                                   |
| **Technical logs** kept by Google when you use the console, such as IP address, browser and time                                                                                      | To keep the console running and secure. [[TO DECIDE: which logs are kept and for how long]]                       |

We do not use advertising trackers on the console.
[[TO DECIDE: whether the console uses any analytics, and if so which and with
what settings]]

**Why we're allowed to use it.** We use this information because you ask us to
provide the service, to run it securely, and to meet legal duties. Where a law
asks for consent instead (for example India's DPDP Act), signing up and
connecting your project is that consent, and you can withdraw it by leaving
(section 7).

### Who else handles it

We use other companies to run the console. They handle your information only to
provide their service to us:

- **Google** (Firebase and Google Cloud) hosts the console, its database and
  sign-in, and runs the deployer. Console data is stored in
  [[TO DECIDE: the platform project's region, for example asia-south1 (Mumbai)]].
- **An email provider** sends verification and notice emails:
  [[TO DECIDE: which provider]].
- [[TO DECIDE: any other service, for example error reporting or a support
inbox]]

We don't sell your information or share it with anyone else, unless the law
requires it.

## 2. What CafeMenu can reach in your Firebase project

To set up your cafe and keep it updated, you add CafeMenu's deploy service
account, [[TO DECIDE: exact address, settled by the Phase 0 spike, of the form
deploy@….iam.gserviceaccount.com]], as a member of your Firebase project with
these roles: [[TO DECIDE: the smallest set of IAM roles, settled by the Phase 0
spike]]. [Your access, explained](access-explained.md) goes through each one.

That access is **near-admin**. It has to be: to set up and update your cafe, the
deployer must deploy your security rules, change your database when a release
needs it, and create your owner account. In practice this means CafeMenu could
technically read or change everything in the project's database and sign-in
list, including:

- your **menu**, tables, settings and today's special;
- your **orders**: table number, items, prices, totals, payment method, times,
  and any **notes customers type**, which may contain personal details;
- your **staff** list: names, email addresses and roles;
- your **customers' anonymous sessions**: a random ID per phone, with no name,
  email or phone number.

### What we promise

We use this access **only** to:

1. **set up** your project: turn on services, create the database, turn on
   sign-in, deploy the rules and the site, load your starting menu and tables,
   and create your owner account;
2. **deploy** the releases you chose, including security fixes, and roll them
   back when they fail;
3. **migrate** your data when a release changes how it is stored, by running
   migration code that is public in our repository;
4. **check** that a deploy worked, using automated checks against your site.
   [[TO DECIDE: whether the post-deploy smoke test places a test order in the
cafe's database, and if so how it is marked and removed]]
5. **support** you, when you ask us to look at a problem. We will look only at
   what that problem needs.

We will **never**:

- read your orders, staff list or customers' data except as above;
- sell, rent or give it to anyone;
- analyse it, combine it across cafes, or use it for marketing, advertising or
  training any model;
- copy it out of your project, except where a support request you made needs a
  specific record.

We keep the deploy service account's credentials private, limit who on our side
can use them ([[TO DECIDE: who, for example only the maintainer and the
automated deployer]]), and keep a deploy history of what the deployer did in
your project. Google also records admin actions in your project, such as
deploying rules or changing members, in its Cloud Audit Logs, which you can view
in the Google Cloud console. Reads of your database are not recorded there
unless you turn on Data Access audit logs for Firestore.

## 3. Your customers' data is yours

The information your customers create (their orders, notes and sessions) and
your staff's accounts live **in your Firebase project**, under your Google
account. That makes **you** responsible for it: you decide what is collected,
you tell your customers about it, and you answer their requests.

CafeMenu acts **on your behalf** when the deployer touches that data, and only
for the purposes in section 2. In the language of data protection law, you are
the _controller_ (GDPR) or _Data Fiduciary_ (India's DPDP Act) for your
customers' and staff's data, and CafeMenu is your _processor_ (GDPR) or _Data
Processor_ (DPDP Act).

[[TO DECIDE: whether CafeMenu offers a template customer notice that cafes can
show on their site, and whether the cafe app links to it]]

The terms between Google and you for your Firebase project (Google's terms and
its data processing terms) apply separately. CafeMenu is not a party to them.

## 4. How long we keep things

| What                                    | How long                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Your console account and cafe settings  | While your account is open, then deleted as in section 7.                            |
| Deploy history                          | [[TO DECIDE: for example 12 months, or as long as the account is open]]              |
| Support messages                        | [[TO DECIDE: for example 12 months after the conversation ends]]                     |
| Technical logs                          | [[TO DECIDE: Google's default log retention, or a shorter period we set]]            |
| Backups of the console database, if any | [[TO DECIDE: whether backups are kept, and for how long deleted data stays in them]] |
| Anything in your own project            | Not ours to keep or delete. It stays until you delete it.                            |

We may keep a record that an account existed and was deleted, and anything the
law requires us to keep, for as long as the law requires.

## 5. Security and breaches

We protect the console and the deploy service account with Google's security
controls, [[TO DECIDE: our own specific measures, for example two-step sign-in
for every account with admin access and no downloadable service-account
keys]], and the process in our public [security policy](../../SECURITY.md). No
system is perfectly secure.

If we learn that your information, or the deploy service account's access to
your project, has been exposed, we will tell you
[[TO DECIDE: how fast, for example within 72 hours of confirming it]], say
what happened and what you should do, and tell any authority the law requires.

## 6. Your rights

You can ask us to:

- show you what the console keeps about you;
- correct it (most of it you can edit yourself in the console);
- delete it (section 7);
- stop using it for anything you've objected to, where the law gives you that
  right.

Which rights you have depends on where you are:

- **India.** The Digital Personal Data Protection Act 2023 and its rules give
  you rights to information, correction, erasure, grievance redressal and to
  nominate someone to act for you. Contact our grievance contact below. If
  you're not satisfied, you can complain to the Data Protection Board of India.
- **European Union, EEA and UK.** If you or your cafe are there, the GDPR (or
  the UK GDPR) may apply. It also gives you the right to a copy of your data in
  a portable form and to complain to your local data protection authority.
  Console data is stored in [[TO DECIDE: region]], which may be outside your
  country. If you are an EU or UK cafe, the GDPR requires a written data
  processing agreement for what CafeMenu does in your project on your behalf.
  [[TO DECIDE: whether CafeMenu offers one, and how]]
- **Elsewhere.** Your local law may give you similar rights. Ask us and we will
  help where we can.

We don't claim that CafeMenu, or this policy, already meets every requirement of
these laws. That is part of the lawyer's review this draft is waiting for.

## 7. Leaving, and deleting your console data

1. **Stop updates:** remove CafeMenu's deploy service account from your project
   on the Google Cloud IAM page, as shown in
   [Your access, explained](access-explained.md#how-to-remove-it). From that
   moment CafeMenu can't reach your project at all. Your site keeps running on
   its last release, and all of your data stays where it always was.
2. **Delete your console account:** [[TO DECIDE: a "Delete my account" button
in the owner area, an email to the contact below, or both]]. We delete your
   console account, cafe settings and deploy history within [[TO DECIDE: for
example 30 days]], apart from anything section 4 says we keep longer.
3. **Delete your cafe's data, if you want to:** that's yours to do, in your own
   Firebase or Google Cloud console. Once you've removed our access, we can't do
   it for you.

## 8. Age

CafeMenu is for businesses. You must be [[TO DECIDE: minimum age, for example
18]] or older to sign up. Your cafe's customers order without an account; what
your cafe allows is up to you.

## 9. Changes to this policy

If we change this policy, we'll update the date at the top, publish the change
in our repository, and email you about any significant change
[[TO DECIDE: how many days before it takes effect, for example 30]].

## 10. Contact

Questions, requests and complaints about privacy:
[[TO DECIDE: privacy and grievance contact email address, and the name of the
grievance officer if the DPDP Act requires one]].

Security problems: please follow our [security policy](../../SECURITY.md)
instead.
