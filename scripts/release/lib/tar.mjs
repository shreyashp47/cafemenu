/**
 * A small deterministic tar writer and a strict tar reader, so the release
 * scripts need nothing but Node.
 *
 * The writer emits POSIX ustar, plus a pax "path" record for any path too long
 * for ustar's name and prefix fields. Every entry gets the same mtime, uid and
 * gid 0, no owner names, and mode 644 (files) or 755 (folders), so the bytes
 * depend on the paths and contents alone.
 *
 * The reader accepts only what the writer produces: ustar headers with valid
 * checksums, regular files, folders, pax "path" records, and safe relative
 * paths. Anything else is an error, because its job is to check a downloaded
 * package before the deployer trusts any of it.
 */
import { gunzipSync, gzipSync } from "node:zlib";

const BLOCK = 512;
// tar's default blocking factor. Padding to it costs nothing once gzipped and
// keeps old readers that expect whole records happy.
const RECORD = 20 * BLOCK;
const MAX_SIZE = 8 ** 11 - 1; // the most 11 octal digits hold
const PAX_NAME = "PaxHeader";

export class TarError extends Error {}

function octal(value, width) {
  const digits = value.toString(8);
  if (digits.length > width - 1)
    throw new TarError(`${value} does not fit a tar header field`);

  return `${digits.padStart(width - 1, "0")}\0`;
}

function header({ name, prefix = Buffer.alloc(0), size, mtime, type }) {
  const block = Buffer.alloc(BLOCK);
  name.copy(block, 0);
  block.write(octal(type === "5" ? 0o755 : 0o644, 8), 100, "latin1");
  block.write(octal(0, 8), 108, "latin1"); // uid
  block.write(octal(0, 8), 116, "latin1"); // gid
  block.write(octal(size, 12), 124, "latin1");
  block.write(octal(mtime, 12), 136, "latin1");
  block.write(" ".repeat(8), 148, "latin1"); // checksum, counted as spaces
  block.write(type, 156, "latin1");
  block.write("ustar\0", 257, "latin1");
  block.write("00", 263, "latin1");
  block.write(octal(0, 8), 329, "latin1"); // devmajor
  block.write(octal(0, 8), 337, "latin1"); // devminor
  prefix.copy(block, 345);
  block.write(
    `${checksum(block).toString(8).padStart(6, "0")}\0 `,
    148,
    "latin1",
  );
  return block;
}

function checksum(block) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];

  return sum;
}

function padded(data) {
  const extra = data.length % BLOCK;
  return extra ? Buffer.concat([data, Buffer.alloc(BLOCK - extra)]) : data;
}

/** ustar keeps a long path as prefix + "/" + name, split at a slash. */
function splitPath(path) {
  const bytes = Buffer.from(path);
  if (bytes.length <= 100) return { name: bytes };

  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    const prefix = Buffer.from(path.slice(0, i));
    const name = Buffer.from(path.slice(i + 1));
    if (name.length && name.length <= 100 && prefix.length <= 155)
      return { name, prefix };
  }
  return null;
}

/** One pax record, "<length> <key>=<value>\n", where length counts itself. */
function paxRecord(key, value) {
  const body = Buffer.byteLength(` ${key}=${value}\n`);
  let length = body + 1;
  while (body + String(length).length !== length)
    length = body + String(length).length;

  return Buffer.from(`${length} ${key}=${value}\n`);
}

/**
 * Builds a tar archive from `entries` in the order given: {path, type: "file",
 * data} or {path, type: "dir"}. Folder paths end with "/".
 */
export function createTar(entries, { mtime }) {
  const blocks = [];
  for (const entry of entries) {
    const data = entry.type === "dir" ? Buffer.alloc(0) : entry.data;
    if (data.length > MAX_SIZE)
      throw new TarError(`${entry.path} is too big for a tar entry`);

    let fields = splitPath(entry.path);
    if (!fields) {
      const record = paxRecord("path", entry.path);
      blocks.push(
        header({
          name: Buffer.from(PAX_NAME),
          size: record.length,
          mtime,
          type: "x",
        }),
      );
      blocks.push(padded(record));
      // Readers that know pax use the record; the name field is a fallback.
      fields = { name: Buffer.from(entry.path).subarray(0, 100) };
    }
    blocks.push(
      header({
        ...fields,
        size: data.length,
        mtime,
        type: entry.type === "dir" ? "5" : "0",
      }),
    );
    if (data.length) blocks.push(padded(data));
  }
  blocks.push(Buffer.alloc(2 * BLOCK)); // end of archive
  const tar = Buffer.concat(blocks);
  const extra = tar.length % RECORD;
  return extra ? Buffer.concat([tar, Buffer.alloc(RECORD - extra)]) : tar;
}

/**
 * gzip at level 9 with a fixed header. zlib already writes no file name and a
 * zero timestamp; the OS byte, though, is whatever platform zlib was built for
 * (3 on Linux, 19 on macOS), which would make one archive differ by a byte
 * between a laptop and CI. The header has no checksum, so it is set to 3 here.
 */
export function gzip(data) {
  const out = gzipSync(data, { level: 9 });
  out[9] = 3;
  return out;
}

/** gunzip that refuses to inflate past `maxOutputLength` bytes. */
export function gunzip(data, maxOutputLength) {
  try {
    return gunzipSync(data, { maxOutputLength });
  } catch (error) {
    if (error.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError)
      throw new TarError(`unpacks to more than ${maxOutputLength} bytes`);

    throw new TarError(`is not valid gzip (${error.message})`);
  }
}

function isZero(bytes) {
  for (const byte of bytes) if (byte !== 0) return false;

  return true;
}

function text(block, start, length) {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? length : end).toString("utf8");
}

function number(block, start, length, what) {
  const value = block
    .subarray(start, start + length)
    .toString("latin1")
    .replace(/[\0 ]+$/, "")
    .replace(/^ +/, "");
  if (!/^[0-7]{1,11}$/.test(value))
    throw new TarError(`has a header with an unreadable ${what}`);

  return parseInt(value, 8);
}

function parsePax(data) {
  let path = null;
  let rest = data;
  while (rest.length) {
    const space = rest.indexOf(0x20);
    const length = Number(rest.subarray(0, space).toString("latin1"));
    if (
      space < 1 ||
      !Number.isInteger(length) ||
      length > rest.length ||
      rest[length - 1] !== 0x0a
    )
      throw new TarError("has a malformed pax header");

    const record = rest.subarray(space + 1, length - 1).toString("utf8");
    const equals = record.indexOf("=");
    const key = record.slice(0, equals);
    if (key !== "path" || path !== null) {
      throw new TarError(
        `has a pax header with "${key}" in it, which packages never use`,
      );
    }
    path = record.slice(equals + 1);
    rest = rest.subarray(length);
  }
  if (path === null) throw new TarError("has an empty pax header");

  return path;
}

/** A path that stays inside the folder it is unpacked into. */
function checkPath(path) {
  const segments = path.split("/");
  const safe =
    path.length > 0 &&
    !path.startsWith("/") &&
    !/[\\\u0000-\u001f]/.test(path) &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    );
  if (!safe) throw new TarError(`has an unsafe path: ${JSON.stringify(path)}`);
}

/**
 * Reads a tar archive into [{path, type: "file", data} | {path, type: "dir"}],
 * with folder paths given without their trailing "/".
 */
export function readTar(tar) {
  if (tar.length % BLOCK !== 0)
    throw new TarError("is not a whole number of 512-byte blocks");

  const entries = [];
  const seen = new Set();
  let paxPath = null;
  let offset = 0;

  for (;;) {
    if (offset + 2 * BLOCK > tar.length)
      throw new TarError("ends without an end-of-archive marker");

    const block = tar.subarray(offset, offset + BLOCK);
    if (isZero(block)) {
      // Two zero blocks end the archive; only zero padding may follow.
      if (!isZero(tar.subarray(offset)))
        throw new TarError("has data after its end-of-archive marker");

      break;
    }
    if (number(block, 148, 8, "checksum") !== checksum(block))
      throw new TarError(`has a corrupt header at byte ${offset}`);

    if (block.toString("latin1", 257, 265) !== "ustar\u000000")
      throw new TarError(`has a header at byte ${offset} that is not ustar`);

    const type = String.fromCharCode(block[156]);
    const size = number(block, 124, 12, "size");
    const start = offset + BLOCK;
    if (start + size > tar.length) throw new TarError("is truncated");

    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      if (paxPath !== null) throw new TarError("has two pax headers in a row");

      paxPath = parsePax(data);
      continue;
    }

    const prefix = text(block, 345, 155);
    const name = text(block, 0, 100);
    let path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;

    if (type === "5") {
      if (size !== 0)
        throw new TarError(`has a folder with data in it: ${path}`);

      path = path.replace(/\/$/, "");
    } else if (type !== "0" && type !== "\0") {
      throw new TarError(
        `has ${JSON.stringify(path)} of tar type "${type}"; packages hold only files and folders`,
      );
    }
    checkPath(path);
    if (seen.has(path)) throw new TarError(`has ${path} twice`);

    seen.add(path);
    entries.push(
      type === "5" ? { path, type: "dir" } : { path, type: "file", data },
    );
  }

  if (paxPath !== null)
    throw new TarError("ends with a pax header and no entry after it");

  return entries;
}
