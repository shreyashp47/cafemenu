/**
 * The words only the staff board, the owner dashboard and the join page show
 * (messages/en.staff.json). Importing this adds them to the language: those
 * three entry points do, and nothing a customer's phone loads may, which
 * src/lib/__tests__/messages.test.ts checks.
 */

import enStaff from "../../messages/en.staff.json";

import { addMessages } from "./i18n";

addMessages("en", enStaff);
