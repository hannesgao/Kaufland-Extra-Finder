/**
 * What a JPEG file's header says, and loading product pictures as JPEG bytes for the PDF writer.
 * `jpegInfo` is pure; the loaders use fetch and, for pictures that are not plain JPEGs, a canvas.
 */

import type { PdfImage } from "./pdfdoc";

/** Size and colour components from the frame header; null when the bytes are not a JPEG. */
export function jpegInfo(
  data: Uint8Array,
): { width: number; height: number; components: number; precision: number } | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1] ?? 0;
    // Fill bytes before a marker, and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = ((data[at + 2] ?? 0) << 8) | (data[at + 3] ?? 0);
    // SOF0–SOF15 without DHT (C4), JPG (C8) and DAC (CC).
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) {
      return {
        precision: data[at + 4] ?? 0,
        height: ((data[at + 5] ?? 0) << 8) | (data[at + 6] ?? 0),
        width: ((data[at + 7] ?? 0) << 8) | (data[at + 8] ?? 0),
        components: data[at + 9] ?? 0,
      };
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/** A JPEG the PDF can take as it is: 8 bits, grey or colour (not CMYK). */
export function asPdfImage(data: Uint8Array): PdfImage | null {
  const info = jpegInfo(data);
  if (info?.precision !== 8 || info.width < 1 || info.height < 1) return null;
  if (info.components !== 1 && info.components !== 3) return null;
  return { data, width: info.width, height: info.height, components: info.components };
}

/** Any picture the browser can decode, drawn on white and encoded again as a JPEG. */
async function reencode(blob: Blob): Promise<PdfImage | null> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  return jpeg ? asPdfImage(new Uint8Array(await jpeg.arrayBuffer())) : null;
}

/** One picture; null when it cannot be loaded or decoded (the sheet then leaves its box empty). */
export async function loadPdfImage(url: string): Promise<PdfImage | null> {
  try {
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "image/jpeg" },
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return asPdfImage(new Uint8Array(await blob.arrayBuffer())) ?? (await reencode(blob));
  } catch {
    return null;
  }
}

/** Pictures by URL, a few at a time; URLs that fail are left out. */
export async function loadPdfImages(
  urls: readonly string[],
  load: (url: string) => Promise<PdfImage | null> = loadPdfImage,
  parallel = 6,
): Promise<Map<string, PdfImage>> {
  const queue = [...new Set(urls)];
  const images = new Map<string, PdfImage>();
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const image = await load(url);
      if (image) images.set(url, image);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return images;
}
