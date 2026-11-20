// L9_META: layer=test, role=real_image_fixture, status=active, version=1.0.0
//
// Synchronous encoder for genuinely decodable PNG fixtures of any size. Image
// fixtures used to be a 1x1 PNG with its IHDR width/height overwritten: the
// header said 1920x1080 but the pixel data was one pixel, so any real decoder
// (the optimisation step) rejects it. Every shipped raster is now decoded and
// re-encoded, so fixtures must be real images.

import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real RGB PNG of the given size: a horizontal gradient from `from` to `to`,
 * so different sizes and colours give different bytes and digests.
 */
export function realPng(
  width: number,
  height: number,
  from: readonly [number, number, number] = [40, 90, 140],
  to: readonly [number, number, number] = [220, 180, 120],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    const t = width > 1 ? x / (width - 1) : 0;
    for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(from[c] + (to[c] - from[c]) * t);
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
