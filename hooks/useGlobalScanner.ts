"use client";
import { useEffect, useRef } from "react";

/**
 * USB / Bluetooth scanners behave like a very fast keyboard that ends with Enter.
 * This catches scans even when no input is focused (inputs handle their own Enter).
 */
export function useGlobalScanner(onScan: (code: string) => void, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buf = "";
    let last = 0;

    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (now - last > 80) buf = ""; // human typing is slower than a scanner
      last = now;

      if (e.key === "Enter") {
        if (buf.length >= 3) {
          e.preventDefault();
          const code = buf;
          buf = "";
          cb.current(code);
        }
        buf = "";
        return;
      }
      if (e.key.length === 1) buf += e.key;
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
