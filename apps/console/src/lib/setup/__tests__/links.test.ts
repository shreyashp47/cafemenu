import { describe, expect, it } from "vitest";
import {
  cloudIamUrl,
  firebaseConsoleUrl,
  projectSettingsUrl,
  usersAndPermissionsUrl,
} from "../links";

describe("links into Google's consoles", () => {
  it("open the owner's project when its ID is known", () => {
    expect(usersAndPermissionsUrl("lantern-cafe-1a2b")).toBe(
      "https://console.firebase.google.com/project/lantern-cafe-1a2b/settings/iam",
    );
    expect(projectSettingsUrl("lantern-cafe-1a2b")).toBe(
      "https://console.firebase.google.com/project/lantern-cafe-1a2b/settings/general",
    );
    expect(cloudIamUrl("lantern-cafe-1a2b")).toBe(
      "https://console.cloud.google.com/iam-admin/iam?project=lantern-cafe-1a2b",
    );
  });

  it("fall back to the consoles' own pickers for no ID, or a malformed one", () => {
    for (const id of [null, "", "Not A Project", "x/../../evil"]) {
      expect(usersAndPermissionsUrl(id)).toBe(firebaseConsoleUrl());
      expect(cloudIamUrl(id)).toBe(
        "https://console.cloud.google.com/iam-admin/iam",
      );
    }
  });
});
