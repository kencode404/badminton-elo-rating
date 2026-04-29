import { useCallback, useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { cropAndCompressToJpeg, fileToDataUrl } from '../lib/image';

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
  saving?: boolean;
}

export function AvatarCropModal({ file, onCancel, onConfirm, saving = false }: Props) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fileToDataUrl(file)
      .then((url) => {
        if (active) setImageSrc(url);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to read image');
      });
    return () => {
      active = false;
    };
  }, [file]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setAreaPixels(pixels);
  }, []);

  async function handleConfirm() {
    if (!areaPixels) return;
    setError(null);
    try {
      const blob = await cropAndCompressToJpeg(file, areaPixels, {
        maxSize: 256,
        quality: 0.85,
      });
      await onConfirm(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Crop failed');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label="Crop avatar"
    >
      <div className="glass-panel w-full max-w-sm overflow-hidden">
        <div className="relative w-full aspect-square bg-black">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs uppercase tracking-widest font-display">
              Loading…
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="block text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
              Zoom
            </span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </label>

          {error && (
            <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="cosmic-button-ghost flex-1 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!areaPixels || saving}
              className="cosmic-button flex-1 text-xs"
            >
              {saving ? 'Uploading…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
