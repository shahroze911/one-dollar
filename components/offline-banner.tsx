"use client";
import { useState } from "react";
import { CloudOff, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { money } from "@/lib/format";
import { removeQueued, retryFailed } from "@/lib/offline";
import { useOffline } from "@/components/providers";
import Modal from "@/components/modal";

/** Thin strip under the top bar: tells the cashier when they are offline and what is waiting to sync. */
export default function OfflineBanner() {
  const { online, queue, pending, failed, syncing, authProblem, syncNow, refresh } = useOffline();
  const [open, setOpen] = useState(false);

  if (online && pending === 0 && failed === 0) return null;

  const tone = !online ? "bg-amber-500 text-amber-950" : failed > 0 ? "bg-rose-600 text-white" : "bg-sky-600 text-white";

  return (
    <>
      <div className={`no-print flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-semibold lg:ml-64 ${tone}`}>
        {!online ? <CloudOff size={16} /> : failed > 0 ? <TriangleAlert size={16} /> : <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />}
        <span>
          {!online
            ? "No internet. You can keep selling in Checkout; sales are saved on this device and sent later."
            : authProblem
            ? "Sign in again so the waiting sales can be sent."
            : failed > 0
            ? `${failed} sale${failed === 1 ? "" : "s"} could not be saved. Tap to see why.`
            : syncing
            ? "Sending saved sales…"
            : "Saved sales are waiting to be sent."}
          {pending > 0 && ` (${pending} waiting)`}
        </span>
        <div className="ml-auto flex gap-2">
          {online && pending > 0 && !syncing && (
            <button onClick={syncNow} className="rounded-lg bg-white/25 px-2.5 py-0.5 text-xs font-bold hover:bg-white/35">Send now</button>
          )}
          {(pending > 0 || failed > 0) && (
            <button onClick={() => setOpen(true)} className="rounded-lg bg-white/25 px-2.5 py-0.5 text-xs font-bold hover:bg-white/35">View</button>
          )}
        </div>
      </div>

      {open && (
        <Modal title="Sales saved on this device" onClose={() => setOpen(false)} wide>
          <div className="space-y-2">
            {queue.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nothing is waiting. All sales are saved. ✓</p>}
            {queue.map((q) => (
              <div key={q.client_id} className={`rounded-xl border p-3 text-sm ${q.error ? "border-rose-200 bg-rose-50" : "border-slate-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold">{q.temp_no} · {money(q.receipt.total)}</div>
                  <div className="text-xs text-slate-500">{new Date(q.at).toLocaleString()}</div>
                </div>
                <div className="text-xs text-slate-600">{q.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
                {q.error ? (
                  <div className="mt-1.5 text-xs font-semibold text-rose-700">Not saved: {q.error}. The customer already has the goods, so enter this sale by hand or fix the cause and retry.</div>
                ) : (
                  <div className="mt-1.5 text-xs text-sky-700">Waiting to be sent</div>
                )}
                {q.error && (
                  <div className="mt-2 flex gap-2">
                    <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => { retryFailed(); refresh(); syncNow(); }}>
                      <RefreshCw size={13} /> Retry
                    </button>
                    <button
                      className="btn btn-ghost px-3 py-1 text-xs text-rose-600"
                      onClick={() => {
                        if (confirm(`Remove ${q.temp_no} from this device? It will never be saved to your records.`)) {
                          removeQueued(q.client_id);
                          refresh();
                        }
                      }}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
            {syncing && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Sending…</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
