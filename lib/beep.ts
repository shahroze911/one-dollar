let ctx: AudioContext | null = null;

/** Tiny feedback tone for scans: high = added, low buzz = problem. */
export function beep(kind: "ok" | "err" = "ok") {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = kind === "ok" ? "sine" : "square";
    o.frequency.value = kind === "ok" ? 880 : 200;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (kind === "ok" ? 0.08 : 0.25));
  } catch {
    /* audio is optional */
  }
}
