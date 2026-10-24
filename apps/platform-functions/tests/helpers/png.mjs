import { deflateSync } from "node:zlib";

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

/** A real, solid-colour 8-bit RGBA PNG, `side` pixels square. */
export function solidPng(side = 32, [r, g, b] = [200, 120, 60]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, no interlace
  const row = Buffer.concat([
    Buffer.from([0]), // filter: none
    Buffer.from(Array.from({ length: side }, () => [r, g, b, 255]).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array(side).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
