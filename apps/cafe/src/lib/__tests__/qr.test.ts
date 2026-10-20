/**
 * The QR encoder is the one piece of this app that is very easy to get subtly
 * wrong, and a subtly wrong QR code prints 10 cards that nobody can scan. So
 * instead of snapshotting the matrix, this test round-trips it through a real
 * decoder: encode -> rasterise -> jsQR -> must equal the original payload.
 */
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";

import { encodeQr, chooseVersion, maxPayloadBytes, qrToSvg } from "@/lib/qr";

function rasterize(matrix: boolean[][], scale = 6, quiet = 4) {
  const n = matrix.length + quiet * 2;
  const width = n * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix.length; c += 1) {
      if (!matrix[r][c]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (r + quiet) * scale + dy;
          const x = (c + quiet) * scale + dx;
          const i = (y * width + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, width, height: width };
}

function decode(text: string): string | null {
  const matrix = encodeQr(text);
  const { data, width, height } = rasterize(matrix);
  return jsQR(data, width, height)?.data ?? null;
}

describe("qr encoder", () => {
  it("round-trips a table URL", () => {
    const url = "https://mochi-and-beans.web.app/order?table=4";
    expect(decode(url)).toBe(url);
  });

  it.each([1, 2, 6, 7, 8, 10])("round-trips table %i", (table) => {
    const url = `https://cafe.web.app/order?table=${table}`;
    expect(decode(url)).toBe(url);
  });

  it("round-trips a long URL at a larger version", () => {
    const url =
      "https://very-long-cafe-name-for-testing.web.app/order?table=10&utm_source=table-tent-card";
    expect(decode(url)).toBe(url);
  });

  it("picks the smallest version that fits", () => {
    expect(chooseVersion(10).version).toBe(1);
    // 14 bytes needs version 2 at level M
    expect(chooseVersion(16).version).toBe(2);
  });

  it("refuses a payload that cannot fit", () => {
    expect(() => encodeQr("x".repeat(maxPayloadBytes() + 1))).toThrow(
      /too long/i,
    );
  });

  it("rejects an empty payload", () => {
    expect(() => encodeQr("")).toThrow();
  });

  it("produces a square matrix of the right size", () => {
    const matrix = encodeQr("https://cafe.web.app/order?table=3");
    expect(matrix.length).toBe(matrix[0].length);
    expect(matrix.length % 4).toBe(1); // 4v + 17
  });

  it("places the three finder patterns", () => {
    const m = encodeQr("https://cafe.web.app/order?table=3");
    const size = m.length;

    // A finder is a 7x7 dark ring around a 3x3 dark core, i.e. rows/cols 0 and 6
    // dark, the middle 3x3 dark, and the two diagonals between them light.
    const isFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const ring = r === 0 || c === 0 || r === 6 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (m[r0 + r][c0 + c] !== (ring || core)) return false;
        }
      }
      return true;
    };

    expect(isFinder(0, 0)).toBe(true);
    expect(isFinder(0, size - 7)).toBe(true);
    expect(isFinder(size - 7, 0)).toBe(true);
  });

  it("keeps a light quiet zone outside the top-left finder", () => {
    // (0,0) is inside the finder, so the separator row/col must be light —
    // this is what stops a QR from being misread as a logo.
    const m = encodeQr("https://cafe.web.app/order?table=3");
    for (let i = 0; i < 8; i += 1) {
      expect(m[7][i]).toBe(false);
      expect(m[i][7]).toBe(false);
    }
  });

  // Versions 7–10 carry an extra version-information block that 1–6 do not.
  // The encoder once shipped without it, and every code of version 7 or more
  // decoded to nothing; the table URLs never got that long, so nobody noticed
  // until the UPI link did. Walk every version, not just the ones in use today.
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "round-trips a payload at version %i",
    (version) => {
      let bytes = 1;
      while (
        bytes < maxPayloadBytes() &&
        chooseVersion(bytes + 1).version <= version
      ) {
        bytes += 1;
      }
      // the longest payload that still fits this version
      expect(chooseVersion(bytes).version).toBe(version);
      const text = `upi://pay?pa=cafe@okaxis&tn=${"x".repeat(bytes)}`.slice(
        0,
        bytes,
      );
      expect(decode(text)).toBe(text);
    },
  );

  it("writes the version-7 information block both times", () => {
    // ISO/IEC 18004 Annex D: version 7 is 000111 110010010100 (0x07C94).
    const m = encodeQr("x".repeat(120));
    expect(m.length).toBe(45);
    const size = m.length;
    for (let i = 0; i < 18; i += 1) {
      const expected = ((0x07c94 >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      expect(m[a][b]).toBe(expected); // bottom-left block
      expect(m[b][a]).toBe(expected); // top-right block
    }
  });

  it("emits an SVG with a quiet zone", () => {
    const svg = qrToSvg("https://cafe.web.app/order?table=2");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg).toContain("<rect");
  });
});
