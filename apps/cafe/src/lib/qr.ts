/**
 * Dependency-free QR encoder (byte mode, versions 1–10, ECC level M).
 *
 * docs/requirements.md §5.5: "One static QR code per table, encoding table number in
 * the URL. Generated once, printed, placed on table — no dynamic regeneration
 * needed."
 *
 * A library would be ~30 kB of JS on a page whose whole point is to be light on
 * cafe wifi (docs/anime-theme.md §6), and the payload is a ~45 character URL — squarely
 * inside the small-version range. So this is a compact, well-known
 * implementation of ISO/IEC 18004: byte mode + Reed–Solomon + mask selection.
 *
 * Scope is deliberately narrow and asserted by tests: byte mode only (the
 * payload is ASCII), ECC level M, versions 1–10. Anything outside that throws
 * rather than silently producing an unscannable code.
 */

export type Matrix = boolean[][]; // true = dark module

// --- Galois field GF(256), primitive polynomial 0x11D ------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
initTables();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function gfPow(a: number, n: number): number {
  if (a === 0) return 0;
  return EXP[(LOG[a] * n) % 255];
}

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], gfPow(2, i));
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], ecLen: number): number[] {
  const gen = generatorPoly(ecLen);
  const result = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i += 1) {
        result[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return result;
}

// --- version tables (ECC level M only) --------------------------------------

interface VersionSpec {
  version: number;
  /** total codewords for this version */
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  /** [group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords] */
  blocks: [number, number, number, number];
  alignmentCenters: number[];
}

/** Data capacity in codewords, versions 1–10, ECC level M (ISO table 9). */
const SPECS: VersionSpec[] = [
  {
    version: 1,
    totalCodewords: 26,
    ecCodewordsPerBlock: 10,
    blocks: [1, 16, 0, 0],
    alignmentCenters: [],
  },
  {
    version: 2,
    totalCodewords: 44,
    ecCodewordsPerBlock: 16,
    blocks: [1, 28, 0, 0],
    alignmentCenters: [6, 18],
  },
  {
    version: 3,
    totalCodewords: 70,
    ecCodewordsPerBlock: 26,
    blocks: [1, 44, 0, 0],
    alignmentCenters: [6, 22],
  },
  {
    version: 4,
    totalCodewords: 100,
    ecCodewordsPerBlock: 18,
    blocks: [2, 32, 0, 0],
    alignmentCenters: [6, 26],
  },
  {
    version: 5,
    totalCodewords: 134,
    ecCodewordsPerBlock: 24,
    blocks: [2, 43, 0, 0],
    alignmentCenters: [6, 30],
  },
  {
    version: 6,
    totalCodewords: 172,
    ecCodewordsPerBlock: 16,
    blocks: [4, 27, 0, 0],
    alignmentCenters: [6, 34],
  },
  {
    version: 7,
    totalCodewords: 196,
    ecCodewordsPerBlock: 18,
    blocks: [4, 31, 0, 0],
    alignmentCenters: [6, 22, 38],
  },
  {
    version: 8,
    totalCodewords: 242,
    ecCodewordsPerBlock: 22,
    blocks: [2, 38, 2, 39],
    alignmentCenters: [6, 24, 42],
  },
  {
    version: 9,
    totalCodewords: 292,
    ecCodewordsPerBlock: 22,
    blocks: [3, 36, 2, 37],
    alignmentCenters: [6, 26, 46],
  },
  {
    version: 10,
    totalCodewords: 346,
    ecCodewordsPerBlock: 26,
    blocks: [4, 43, 1, 44],
    alignmentCenters: [6, 28, 50],
  },
];

function dataCodewords(spec: VersionSpec): number {
  const [g1, d1, g2, d2] = spec.blocks;
  return g1 * d1 + g2 * d2;
}

function charCountBits(version: number): number {
  // byte mode: 8 bits for versions 1–9, 16 for 10–40
  return version < 10 ? 8 : 16;
}

export function chooseVersion(byteLength: number): VersionSpec {
  for (const spec of SPECS) {
    const needed = Math.ceil(
      (4 + charCountBits(spec.version) + byteLength * 8) / 8,
    );
    if (needed <= dataCodewords(spec)) return spec;
  }
  throw new Error(
    `Payload too long for a table QR code (${byteLength} bytes, max ${maxPayloadBytes()}).`,
  );
}

export function maxPayloadBytes(): number {
  const last = SPECS[SPECS.length - 1];
  const capacityBits =
    dataCodewords(last) * 8 - 4 - charCountBits(last.version);
  return Math.floor(capacityBits / 8);
}

// --- encoding ---------------------------------------------------------------

function toBytes(text: string): number[] {
  // TextEncoder is available in Node 18+ and every target browser; non-ASCII
  // still round-trips because byte mode is byte mode.
  return [...new TextEncoder().encode(text)];
}

function buildCodewords(bytes: number[], spec: VersionSpec): number[] {
  const capacityBits = dataCodewords(spec) * 8;
  const countBits = charCountBits(spec.version);
  const bits: number[] = [];

  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, countBits);
  for (const byte of bytes) push(byte, 8);

  // terminator
  const terminator = Math.min(4, capacityBits - bits.length);
  push(0, terminator);
  // pad to a byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }

  // alternating pad bytes
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < dataCodewords(spec); i += 1) {
    data.push(PAD[i % 2]);
  }

  return data;
}

function interleave(data: number[], spec: VersionSpec): number[] {
  const [g1, d1, g2, d2] = spec.blocks;
  const blockSizes: number[] = [];
  for (let i = 0; i < g1; i += 1) blockSizes.push(d1);
  for (let i = 0; i < g2; i += 1) blockSizes.push(d2);

  const ecLen = spec.ecCodewordsPerBlock;
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const size of blockSizes) {
    const block = data.slice(offset, offset + size);
    offset += size;
    blocks.push(block);
    ecBlocks.push(rsRemainder(block, ecLen));
  }

  const out: number[] = [];
  const maxData = Math.max(...blockSizes);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// --- matrix construction ----------------------------------------------------

function placeFunctionPatterns(
  matrix: Matrix,
  reserved: boolean[][],
  spec: VersionSpec,
) {
  const size = matrix.length;
  const set = (r: number, c: number, dark: boolean) => {
    matrix[r][c] = dark;
    reserved[r][c] = true;
  };

  // finder patterns + separators
  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(rr, cc, inRing);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // alignment patterns
  const centers = spec.alignmentCenters;
  for (const r of centers) {
    for (const c of centers) {
      // skip the three finder corners
      const nearFinder =
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(r + dr, c + dc, ring !== 1);
        }
      }
    }
  }

  // dark module
  set(size - 8, 8, true);

  // reserve format information areas
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) set(8, i, false);
    if (!reserved[i][8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, false);
    if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, false);
  }

  // Version information, versions 7 and up: two 6×3 blocks beside the top-right
  // and bottom-left finders. A scanner reads the version from here rather than
  // from the matrix size, so without it every code from version 7 on decodes
  // to nothing — which is exactly what this encoder did until the UPI link
  // (~110 bytes) became the first payload long enough to need version 7.
  if (spec.version >= 7) {
    const bits = versionBits(spec.version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
}

/** BCH(18,6) version information: 6 bits of version, 12 of error correction. */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  }
  return (version << 12) | rem;
}

// --- masking ----------------------------------------------------------------

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(matrix: Matrix): number {
  const size = matrix.length;
  let score = 0;

  // rule 1: runs of 5+
  for (let i = 0; i < size; i += 1) {
    for (const read of [
      (k: number) => matrix[i][k],
      (k: number) => matrix[k][i],
    ]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (read(j) === read(j - 1)) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = matrix[r][c];
      if (
        v === matrix[r][c + 1] &&
        v === matrix[r + 1][c] &&
        v === matrix[r + 1][c + 1]
      ) {
        score += 3;
      }
    }
  }

  // rule 3: finder-like patterns
  const A = [true, false, true, true, true, false, true];
  const B = [false, false, false, false, true, false, false];
  const matches = (
    get: (k: number) => boolean,
    start: number,
    pattern: boolean[],
  ) => pattern.every((v, k) => get(start + k) === v);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 7; j += 1) {
      for (const get of [
        (k: number) => matrix[i][k],
        (k: number) => matrix[k][i],
      ]) {
        if (matches(get, j, A) || matches(get, j, B)) score += 40;
        const revA = [...A].reverse();
        const revB = [...B].reverse();
        if (matches(get, j, revA) || matches(get, j, revB)) score += 40;
      }
    }
  }

  // rule 4: dark/light balance
  const dark = matrix.flat().filter(Boolean).length;
  const total = size * size;
  const ratio = (dark * 100) / total;
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

function applyFormatBits(matrix: Matrix, ecLevelBits: number, maskId: number) {
  const size = matrix.length;
  // BCH(15,5) format information for level M (0b00) with the given mask
  const data = (ecLevelBits << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  // First copy: top-left, hugging the corner finder.
  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bit(i);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let i = 9; i <= 14; i += 1) matrix[8][14 - i] = bit(i);

  // Second copy: split between the top-right and bottom-left finders.
  for (let i = 0; i <= 7; i += 1) matrix[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i += 1) matrix[size - 15 + i][8] = bit(i);

  matrix[size - 8][8] = true; // dark module
}

// --- public API -------------------------------------------------------------

/** Encode `text` into a boolean matrix. `true` means a dark module. */
export function encodeQr(text: string): Matrix {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Nothing to encode.");
  }
  const bytes = toBytes(text);
  const spec = chooseVersion(bytes.length);
  const size = spec.version * 4 + 17;

  const codewords = interleave(buildCodewords(bytes, spec), spec);

  const base: Matrix = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );

  placeFunctionPatterns(base, reserved, spec);

  // try all 8 masks, keep the lowest-penalty result
  let best: Matrix | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate: Matrix = base.map((row) => [...row]);
    const maskFn = MASKS[mask];

    // fill data with masking applied
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const col = right - j;
          const row = upward ? size - 1 - vert : vert;
          if (reserved[row][col]) continue;
          const byte = codewords[bitIndex >>> 3] ?? 0;
          const bit = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
          candidate[row][col] = (bit !== maskFn(row, col)) as never;
        }
      }
      upward = !upward;
    }

    applyFormatBits(candidate, 0b00, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best) throw new Error("Could not build a QR matrix.");
  return best;
}

/**
 * Render to an inline SVG string. Uses a 4-module quiet zone (the spec
 * minimum) so the code still scans when printed at tent-card size.
 */
export function qrToSvg(
  text: string,
  options?: { moduleSize?: number; quiet?: number },
): string {
  const matrix = encodeQr(text);
  const quiet = options?.quiet ?? 4;
  const size = matrix.length + quiet * 2;

  let path = "";
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix.length; c += 1) {
      if (matrix[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"`,
    ` shape-rendering="crispEdges" role="img" aria-label="Table QR code">`,
    `<rect width="${size}" height="${size}" fill="#fff"/>`,
    `<path d="${path}" fill="#000"/>`,
    `</svg>`,
  ].join("");
}

export { MASKS, SPECS };
