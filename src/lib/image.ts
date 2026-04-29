// Client-side image helpers for profile avatars.

export interface CompressOptions {
  maxSize?: number;   // square edge, in pixels. Default 256.
  quality?: number;   // JPEG quality 0–1. Default 0.85.
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Read a file into an ImageBitmap (handles EXIF orientation on most browsers).
export async function loadBitmap(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File is not an image');
  }
  return await createImageBitmap(file, { imageOrientation: 'from-image' });
}

// Read a file into a data URL (used by react-easy-crop's `image` prop).
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Crop the source image to the given pixel area, scale to maxSize, encode JPEG.
export async function cropAndCompressToJpeg(
  file: File,
  area: CropArea,
  { maxSize = 256, quality = 0.85 }: CompressOptions = {},
): Promise<Blob> {
  const bitmap = await loadBitmap(file);

  const target = Math.min(maxSize, Math.max(1, Math.round(area.width)));
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, target, target);
  bitmap.close?.();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Failed to encode JPEG');
  return blob;
}

// Auto center-crop fallback (no manual UI) — kept for callers that want a
// one-shot conversion.
export async function compressImageToSquareJpeg(
  file: File,
  opts: CompressOptions = {},
): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  bitmap.close?.();
  return cropAndCompressToJpeg(
    file,
    { x: sx, y: sy, width: side, height: side },
    opts,
  );
}
