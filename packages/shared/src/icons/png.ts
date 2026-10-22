/**
 * PNG in and out, without a dependency: enough to read any logo a browser
 * would accept as a PNG and to write the app icons.
 *
 * Compression is the caller's: pass Node's `node:zlib` (or anything with the
 * same two functions). That keeps this file free of Node imports, so it
 * type-checks and runs anywhere, and the deployer gets zlib's real deflate
 * rather than a home-made one.
 *
 * Reads every PNG the spec allows: greyscale, RGB, palette, each with or
 * without alpha (or a tRNS chunk), bit depths 1 to 16, interlaced or not.
 * Writes 8-bit RGB or RGBA, whichever the image needs, with a filter per row.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** width × height × 4 bytes: red, green, blue, alpha (not premultiplied). */
  data: Uint8Array;
}

/** The two functions of `node:zlib` this needs. */
export interface Zlib {
  deflateSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
  inflateSync(
    data: Uint8Array,
    options?: { maxOutputLength?: number },
  ): Uint8Array;
}

export class PngError extends Error {
  override name = "PngError";
}

/** Larger than any logo needs, small enough to decode in memory. */
export const MAX_PNG_SIDE = 4096;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return concat([uint32(data.length), body, uint32(crc32(body))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// --- writing ----------------------------------------------------------------

/** A PNG of `image`: RGB when every pixel is opaque, RGBA otherwise. */
export function encodePng(image: RgbaImage, zlib: Zlib): Uint8Array {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new PngError("image data does not match its size");
  }
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const rows = new Uint8Array(height * (stride + 1));
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        current[x * channels + c] = data[(y * width + x) * 4 + c]!;
      }
    }
    // The usual heuristic: try all five filters, keep the one whose output
    // is smallest as signed bytes.
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter < 5; filter += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const a = i >= channels ? current[i - channels]! : 0;
        const b = previous[i]!;
        const c = i >= channels ? previous[i - channels]! : 0;
        const predictor =
          filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? (a + b) >> 1
                  : paeth(a, b, c);
        const value = (current[i]! - predictor) & 0xff;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best.set(candidate);
      }
    }
    rows[y * (stride + 1)] = bestFilter;
    rows.set(best, y * (stride + 1) + 1);
    previous.set(current);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  return concat([
    new Uint8Array(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// --- reading ----------------------------------------------------------------

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** Adam7: [x start, y start, x step, y step] for each of the seven passes. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface Header {
  width: number;
  height: number;
  depth: number;
  colourType: number;
  interlaced: boolean;
}

export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > SIGNATURE.length && SIGNATURE.every((b, i) => bytes[i] === b)
  );
}

/** Reads a PNG into RGBA. Throws a PngError for anything it cannot read. */
export function decodePng(bytes: Uint8Array, zlib: Zlib): RgbaImage {
  if (!isPng(bytes)) throw new PngError("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = SIGNATURE.length;
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  let ended = false;

  while (at + 12 <= bytes.length && !ended) {
    const length = view.getUint32(at);
    const typeStart = at + 4;
    const dataStart = at + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new PngError("truncated chunk");
    const type = String.fromCharCode(...bytes.subarray(typeStart, dataStart));
    if (crc32(bytes, typeStart, dataEnd) !== view.getUint32(dataEnd)) {
      throw new PngError(`damaged ${type} chunk`);
    }
    const body = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      const h = new DataView(body.buffer, body.byteOffset, body.byteLength);
      header = {
        width: h.getUint32(0),
        height: h.getUint32(4),
        depth: body[8]!,
        colourType: body[9]!,
        interlaced: body[12] === 1,
      };
      const depths = DEPTHS[header.colourType];
      if (!depths?.includes(header.depth) || body[10] !== 0 || body[11] !== 0) {
        throw new PngError("unsupported PNG format");
      }
      if (
        header.width < 1 ||
        header.height < 1 ||
        header.width > MAX_PNG_SIDE ||
        header.height > MAX_PNG_SIDE
      ) {
        throw new PngError(
          `image must be 1 to ${MAX_PNG_SIDE} pixels on each side`,
        );
      }
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      transparency = body;
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      ended = true;
    } else if (!(bytes[typeStart]! & 0x20)) {
      // An upper-case first letter marks a chunk a reader must understand.
      throw new PngError(`unsupported critical chunk ${type}`);
    }
    at = dataEnd + 4;
  }
  if (!header) throw new PngError("no IHDR chunk");
  if (data.length === 0) throw new PngError("no image data");
  if (header.colourType === 3 && !palette) throw new PngError("no palette");

  const { width, height, depth, colourType, interlaced } = header;
  const channels = CHANNELS[colourType]!;
  const bitsPerPixel = channels * depth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const passes = interlaced
    ? ADAM7.map(([x0, y0, dx, dy]) => ({
        x0,
        y0,
        dx,
        dy,
        w: Math.ceil((width - x0) / dx),
        h: Math.ceil((height - y0) / dy),
      }))
    : [{ x0: 0, y0: 0, dx: 1, dy: 1, w: width, h: height }];
  const expected = passes.reduce(
    (n, p) =>
      p.w > 0 && p.h > 0
        ? n + p.h * (1 + Math.ceil((p.w * bitsPerPixel) / 8))
        : n,
    0,
  );

  let raw: Uint8Array;
  try {
    raw = zlib.inflateSync(concat(data), { maxOutputLength: expected });
  } catch {
    throw new PngError("image data does not decompress");
  }
  if (raw.length < expected) throw new PngError("image data is too short");

  const out = new Uint8Array(width * height * 4);
  const max = (1 << depth) - 1;
  // tRNS for greyscale and RGB names one colour, at the image's bit depth,
  // that is fully transparent.
  const key =
    transparency && colourType !== 3
      ? Array.from(
          { length: colourType === 0 ? 1 : 3 },
          (_, i) =>
            ((transparency[i * 2]! << 8) | transparency[i * 2 + 1]!) & 0xffff,
        )
      : null;

  let offset = 0;
  for (const pass of passes) {
    if (pass.w === 0 || pass.h === 0) continue;
    const stride = Math.ceil((pass.w * bitsPerPixel) / 8);
    let previous = new Uint8Array(stride);
    for (let y = 0; y < pass.h; y += 1) {
      const filter = raw[offset]!;
      const line = raw.slice(offset + 1, offset + 1 + stride);
      offset += 1 + stride;
      for (let i = 0; i < stride; i += 1) {
        const a = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
        const b = previous[i]!;
        const c = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
        const predictor =
          filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? (a + b) >> 1
                  : filter === 4
                    ? paeth(a, b, c)
                    : -1;
        if (predictor < 0) throw new PngError(`unknown filter ${filter}`);
        line[i] = (line[i]! + predictor) & 0xff;
      }
      previous = line;

      const sample = (index: number): number => {
        if (depth === 8) return line[index]!;
        if (depth === 16) return (line[index * 2]! << 8) | line[index * 2 + 1]!;
        const bit = index * depth;
        return (line[bit >> 3]! >> (8 - depth - (bit & 7))) & max;
      };
      const to8 = (value: number) =>
        depth === 16 ? value >> 8 : depth === 8 ? value : (value * 255) / max;

      for (let x = 0; x < pass.w; x += 1) {
        const target =
          ((pass.y0 + y * pass.dy) * width + pass.x0 + x * pass.dx) * 4;
        let r: number;
        let g: number;
        let b: number;
        let alpha = 255;
        const s = x * channels;
        if (colourType === 3) {
          const index = sample(x);
          if (index * 3 + 2 >= palette!.length) {
            throw new PngError("palette index out of range");
          }
          r = palette![index * 3]!;
          g = palette![index * 3 + 1]!;
          b = palette![index * 3 + 2]!;
          alpha =
            transparency && index < transparency.length
              ? transparency[index]!
              : 255;
        } else if (colourType === 0 || colourType === 4) {
          const grey = sample(s);
          r = g = b = to8(grey);
          if (colourType === 4) alpha = to8(sample(s + 1));
          else if (key && grey === key[0]) alpha = 0;
        } else {
          const red = sample(s);
          const green = sample(s + 1);
          const blue = sample(s + 2);
          r = to8(red);
          g = to8(green);
          b = to8(blue);
          if (colourType === 6) alpha = to8(sample(s + 3));
          else if (
            key &&
            red === key[0] &&
            green === key[1] &&
            blue === key[2]
          ) {
            alpha = 0;
          }
        }
        out[target] = r;
        out[target + 1] = g;
        out[target + 2] = b;
        out[target + 3] = alpha;
      }
    }
  }
  return { width, height, data: out };
}
