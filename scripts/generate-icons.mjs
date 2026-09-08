import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { crc32 } from './package.mjs';

// Original 5 × 7 pixel G with a terminal cursor, drawn on a 16 × 16 grid.
const glyph = ['01110', '10001', '10000', '10111', '10001', '10001', '01110'];
const palette = Buffer.from([0x11, 0x13, 0x10, 0xef, 0xb8, 0x66, 0xee, 0x75, 0x45]);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const root = fileURLToPath(new URL('../', import.meta.url));

function pixel(x, y) {
  if ((x === 1 || x === 14) && y >= 1 && y <= 14 || (y === 1 || y === 14) && x >= 1 && x <= 14) return 1;
  if (x >= 4 && x < 9 && y >= 4 && y < 11 && glyph[y - 4][x - 4] === '1') return 1;
  if (y === 10 && x >= 10 && x <= 11) return 2;
  return 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}

// Stored DEFLATE avoids compression-library/version differences in generated files.
function zlibStored(data) {
  const parts = [Buffer.from([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65535, data.length - offset);
    const block = Buffer.alloc(5);
    block[0] = offset + length === data.length ? 1 : 0;
    block.writeUInt16LE(length, 1);
    block.writeUInt16LE(length ^ 0xffff, 3);
    parts.push(block, data.subarray(offset, offset + length));
    offset += length;
  }
  let a = 1;
  let b = 0;
  for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(((b << 16) | a) >>> 0);
  parts.push(checksum);
  return Buffer.concat(parts);
}

function png(size) {
  const rowBytes = Math.ceil(size / 4);
  const pixels = Buffer.alloc(size * (rowBytes + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = pixel(Math.floor(x * 16 / size), Math.floor(y * 16 / size));
      pixels[y * (rowBytes + 1) + 1 + Math.floor(x / 4)] |= index << (6 - (x % 4) * 2);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 2; // two bits per pixel
  header[9] = 3; // indexed color
  return Buffer.concat([signature, chunk('IHDR', header), chunk('PLTE', palette), chunk('IDAT', zlibStored(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const directory = path.join(root, 'extension', 'icons');
await mkdir(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(path.join(directory, `icon-${size}.png`), png(size));
console.log('Generated four original Goshen Terminal pixel-G icons.');
