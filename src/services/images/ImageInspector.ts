// L9_META: layer=service, role=image_inspector, status=active, version=1.0.0
//
// Decode just enough of an image's header to establish MIME type and pixel
// dimensions, plus a content hash. Pure and dependency-free (no native image
// library) so it runs identically in CI and in production. Supports the raster
// formats the ingestion policy accepts plus SVG.

import { createHash } from 'node:crypto';

export interface InspectedImage {
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export class ImageInspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageInspectError';
  }
}

export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  // IHDR is the first chunk; width/height are big-endian uint32 at offsets 16/20.
  if (bytes.length < 24) throw new ImageInspectError('PNG header truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readGifDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 10) throw new ImageInspectError('GIF header truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI (FF D8)
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry frame dimensions.
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) throw new ImageInspectError('JPEG segment length invalid');
    offset += 2 + segmentLength;
  }
  throw new ImageInspectError('JPEG frame header not found');
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30) throw new ImageInspectError('WEBP header truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (format === 'VP8 ') {
    // Lossy: 16-bit width/height (14 bits used) at offset 26/28.
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (format === 'VP8L') {
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (format === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  throw new ImageInspectError(`Unsupported WEBP frame format: ${format}`);
}

function readSvgDimensions(text: string): { width: number; height: number } {
  const widthMatch = /\bwidth\s*=\s*["']?\s*([\d.]+)/i.exec(text);
  const heightMatch = /\bheight\s*=\s*["']?\s*([\d.]+)/i.exec(text);
  if (widthMatch && heightMatch) {
    return { width: Math.round(Number(widthMatch[1])), height: Math.round(Number(heightMatch[1])) };
  }
  const viewBox = /\bviewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(text);
  if (viewBox) return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
  // Scalable vector without intrinsic size — dimensions are unconstrained.
  return { width: 0, height: 0 };
}

/** Detect MIME type from magic bytes (independent of any HTTP content-type). */
export function detectMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  // AVIF: ftyp box with an avif/avis brand.
  if (bytes.length > 12 && startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 512))).toString('utf8').trimStart();
  if (head.startsWith('<?xml') && head.includes('<svg')) return 'image/svg+xml';
  if (head.startsWith('<svg')) return 'image/svg+xml';
  return undefined;
}

/** Inspect raw image bytes; throws ImageInspectError on unrecognized/corrupt input. */
export function inspectImage(bytes: Uint8Array): InspectedImage {
  const mimeType = detectMimeType(bytes);
  if (!mimeType) throw new ImageInspectError('Unrecognized image format');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const byteLength = bytes.byteLength;
  let dimensions: { width: number; height: number };
  switch (mimeType) {
    case 'image/png':
      dimensions = readPngDimensions(bytes);
      break;
    case 'image/gif':
      dimensions = readGifDimensions(bytes);
      break;
    case 'image/jpeg':
      dimensions = readJpegDimensions(bytes);
      break;
    case 'image/webp':
      dimensions = readWebpDimensions(bytes);
      break;
    case 'image/svg+xml':
      dimensions = readSvgDimensions(Buffer.from(bytes).toString('utf8'));
      break;
    default:
      // AVIF header decoding is out of scope; record it without dimensions.
      dimensions = { width: 0, height: 0 };
  }
  return { mimeType, width: dimensions.width, height: dimensions.height, byteLength, sha256 };
}
