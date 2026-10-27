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

export async function removeProductImage(path?: string | null) {
  if (!path) return;
  try {
    await supabaseBrowser().storage.from(BUCKET).remove([path]);
  } catch {
    /* best effort — an orphaned file is harmless */
  }
}
