import { describe, expect, it } from "vitest";
import { SETUP_LOGO_MAX_BYTES } from "../../platform/model";
import { logoProblems } from "../../platform/validate";
import {
  LOGO_MAX_UPLOAD_BYTES,
  fitInside,
  fitsStored,
  logoFileProblem,
  logoHints,
  logoSizeProblem,
} from "../logo";

describe("the logo file", () => {
  it("takes PNG, JPEG and WebP up to the upload limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(logoFileProblem({ type, size: 1000 })).toBeNull();
    }
    expect(
      logoFileProblem({ type: "image/png", size: LOGO_MAX_UPLOAD_BYTES }),
    ).toBeNull();
  });

  it("refuses SVG, GIF, HEIC and anything too large", () => {
    for (const type of [
      "image/svg+xml",
      "image/gif",
      "image/heic",
      "application/pdf",
      "",
    ]) {
      expect(logoFileProblem({ type, size: 1000 })).toBe("type");
    }
    expect(
      logoFileProblem({ type: "image/png", size: LOGO_MAX_UPLOAD_BYTES + 1 }),
    ).toBe("file-size");
  });

  it("needs 192 pixels on its longer side, and hints below 512 or when far from square", () => {
    expect(logoSizeProblem({ width: 191, height: 100 })).toBe("too-small");
    expect(logoSizeProblem({ width: 100, height: 192 })).toBeNull();
    expect(logoHints({ width: 300, height: 300 })).toEqual(["small"]);
    expect(logoHints({ width: 1200, height: 300 })).toEqual(["not-square"]);
    expect(logoHints({ width: 800, height: 600 })).toEqual([]);
  });
});

describe("what is stored", () => {
  it("is scaled down to fit, keeping its shape, and never up", () => {
    expect(fitInside(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
    expect(fitInside(300, 600, 512)).toEqual({ width: 256, height: 512 });
    expect(fitInside(300, 400, 512)).toEqual({ width: 300, height: 400 });
    expect(fitInside(5000, 3, 512)).toEqual({ width: 512, height: 1 });
  });

  it("must fit the setup document, and be a PNG", () => {
    expect(fitsStored(SETUP_LOGO_MAX_BYTES)).toBe(true);
    expect(fitsStored(SETUP_LOGO_MAX_BYTES + 1)).toBe(false);
    const png = new Uint8Array(32);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(logoProblems(png)).toEqual([]);
    expect(
      logoProblems(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0])),
    ).toEqual(["logo-not-png"]);
  });
});
