"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Phone / webcam barcode scanning using the browser's built-in BarcodeDetector
 * (Chrome, Edge, Android). No library, no bundle weight. Unsupported browsers
 * get a friendly message — USB scanners and typing still work everywhere.
 */
export default function CameraScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef(onDetect);
  cb.current = onDetect;
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const BD = (window as any).BarcodeDetector;

    if (!BD) {
      setErr("Camera scanning isn't supported in this browser. Use Chrome, or a USB/Bluetooth scanner, or type the number.");
      return;
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const detector = new BD({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"],
        });
        let lastCode = "";
        let lastAt = 0;
        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(v);
            if (found.length) {
              const code: string = found[0].rawValue;
              const now = Date.now();
              if (code !== lastCode || now - lastAt > 2000) {
                lastCode = code;
                lastAt = now;
                cb.current(code);
              }
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 150);
        };
        tick();
      } catch (e: any) {
        setErr(e?.message || "Could not open the camera");
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="card pop overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-sm font-semibold">Point the camera at a barcode</span>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close camera">
          <X size={18} />
        </button>
      </div>
      {err ? (
        <p className="px-4 pb-4 text-sm text-slate-600">{err}</p>
      ) : (
        <div className="relative bg-black">
          <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80 shadow-[0_0_12px_2px_rgba(244,63,94,.6)]" />
        </div>
      )}
    </div>
  );
}
