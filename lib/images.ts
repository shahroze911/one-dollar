import { supabaseBrowser } from "./supabase/client";

const BUCKET = "product-images";

/** Public URL of a stored product picture (null when the product has none). */
export function imageUrl(path?: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Shrinks a photo in the browser before upload (max 640px, JPEG ~80%).
 * A 4 MB phone photo becomes ~40 KB: fast to upload, fast to load on the till,
 * and it stays well inside the free storage limit.
 */
export async function compressImage(file: File, max = 640): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read that image. Please use a JPG, PNG or WebP photo.");
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not process the image"))),
      "image/jpeg",
      0.82
    )
  );
}

export async function uploadProductImage(file: File): Promise<string> {
  const blob = await compressImage(file);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabaseBrowser()
    .storage.from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Turns a shop logo into a crisp black-and-white picture (error-diffusion dithering),
 * which is what a thermal printer prints best. Colour logos otherwise come out as grey smudges.
 * Output is ~288 px wide (about 36 mm on a thermal roll).
 */
export async function processLogo(file: File, width = 288, maxHeight = 200): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read that image. Please use a PNG, JPG or WebP file.");
  }
  const scale = Math.min(width / bmp.width, maxHeight / bmp.height, 1.5);
  const w = Math.max(8, Math.round(bmp.width * scale));
  const h = Math.max(8, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent logos print on white
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

  // Floyd–Steinberg dithering
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const val = old < 140 ? 0 : 255;
      const err = old - val;
      gray[i] = val;
      if (x + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (x + 1 < w) gray[i + w + 1] += err / 16;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] < 128 ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the logo"))), "image/png")
  );
}

export async function uploadLogo(file: File): Promise<string> {
  const blob = await processLogo(file);
  const path = `logo/${Date.now()}.png`;
  const { error } = await supabaseBrowser()
    .storage.from(BUCKET)
    .upload(path, blob, { contentType: "image/png", cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeProductImage(path?: string | null) {
  if (!path) return;
  try {
    await supabaseBrowser().storage.from(BUCKET).remove([path]);
  } catch {
    /* best effort — an orphaned file is harmless */
  }
}
