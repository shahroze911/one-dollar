export const CURRENCY = "Rs";

/** Pakistani rupees: "Rs 1,250" (paisa shown only when there is any: "Rs 99.50"). */
export const money = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  const hasFraction = Math.abs(v - Math.round(v)) > 0.004;
  return `${CURRENCY} ${v.toLocaleString("en-PK", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export const fmtReceiptDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

export const receiptNo = (id: number) => String(id).padStart(6, "0");

/** Integer-paisa math so float errors never reach the till. */
export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number) => c / 100;
