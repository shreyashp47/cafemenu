/**
 * The browser half of ./logo.ts: draws the chosen file onto a canvas and
 * reads it back as a PNG that fits SETUP_LOGO_SIDE and SETUP_LOGO_MAX_BYTES.
 * Redrawing also drops whatever else the file carried (camera data,
 * location), so only pixels leave the owner's device.
 */

import {
  LOGO_STEPS,
  fitInside,
  fitsStored,
  logoFileProblem,
  logoSizeProblem,
  type LogoProblem,
} from "./logo";

export interface StoredLogo {
  png: Uint8Array;
  width: number;
  height: number;
  /** The size of the file as chosen, for the hints. */
  original: { width: number; height: number };
}

export class LogoError extends Error {
  constructor(readonly problem: LogoProblem) {
    super(`logo: ${problem}`);
    this.name = "LogoError";
  }
}

async function decode(file: Blob): Promise<
  CanvasImageSource & {
    width: number;
    height: number;
  }
> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to an <img>, which some browsers decode more of.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return Object.assign(img, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new LogoError("unreadable"))),
      "image/png",
    ),
  );
}

/** The file as the PNG the platform keeps, or a LogoError saying why not. */
export async function storedLogo(file: File): Promise<StoredLogo> {
  const early = logoFileProblem(file);
  if (early) throw new LogoError(early);
  let image: Awaited<ReturnType<typeof decode>>;
  try {
    image = await decode(file);
  } catch {
    throw new LogoError("unreadable");
  }
  const original = { width: image.width, height: image.height };
  const small = logoSizeProblem(original);
  if (small) throw new LogoError(small);

  for (const side of LOGO_STEPS) {
    const size = fitInside(original.width, original.height, side);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new LogoError("unreadable");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await toPng(canvas);
    if (fitsStored(blob.size)) {
      return {
        png: new Uint8Array(await blob.arrayBuffer()),
        ...size,
        original,
      };
    }
  }
  throw new LogoError("too-detailed");
}
