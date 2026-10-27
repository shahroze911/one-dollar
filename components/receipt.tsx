import { fmtReceiptDate, money, receiptNo } from "@/lib/format";
import type { ReceiptData, ShopSettings } from "@/lib/types";

/**
 * The receipt exactly as it prints on an 58mm / 80mm thermal roll.
 * Styling lives in globals.css (.receipt, .r-*) so screen preview and print match.
 */
export function ReceiptView({ data, settings }: { data: ReceiptData; settings: ShopSettings }) {
  const w = settings.paper_width === 58 ? "w58" : "w80";
  const qtyTotal = data.items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className={`receipt ${w}`}>
      <div className="r-c">
        <div className="r-title">{settings.shop_name}</div>
        {settings.address && <div>{settings.address}</div>}
        {settings.phone && <div>Tel: {settings.phone}</div>}
      </div>

      <div className="r-dash" />

      <div className="r-row">
        <span>Receipt #</span>
        <span className="r-b">{receiptNo(data.id)}</span>
      </div>
      <div className="r-row">
        <span>Date</span>
        <span>{fmtReceiptDate(data.created_at)}</span>
      </div>
      {data.cashier && (
        <div className="r-row">
          <span>Cashier</span>
          <span>{data.cashier.split("@")[0]}</span>
        </div>
      )}
      <div className="r-row">
        <span>Payment</span>
        <span>{data.payment_method === "cash" ? "Cash" : "Card"}</span>
      </div>

      <div className="r-dash" />

      {data.items.map((i, idx) => (
        <div key={idx} className="r-item">
          <div className="r-b">{i.name}</div>
          <div className="r-row">
            <span>
              {i.qty} x {money(i.unit_price)}
            </span>
            <span>{money(i.qty * i.unit_price)}</span>
          </div>
        </div>
      ))}

      <div className="r-dash" />

      <div className="r-row">
        <span>Items</span>
        <span>{qtyTotal}</span>
      </div>
      <div className="r-row r-total">
        <span>TOTAL</span>
        <span>{money(data.total)}</span>
      </div>
      {data.payment_method === "cash" && data.cash_received != null && (
        <>
          <div className="r-row">
            <span>Cash</span>
            <span>{money(data.cash_received)}</span>
          </div>
          <div className="r-row r-b">
            <span>Change</span>
            <span>{money(data.change_given ?? 0)}</span>
          </div>
        </>
      )}

      {data.voided && <div className="r-c r-b r-mt">*** VOIDED SALE ***</div>}

      <div className="r-dash" />

      <div className="r-c">
        {settings.footer && <div>{settings.footer}</div>}
        {data.duplicate && <div className="r-mt">-- Duplicate copy --</div>}
      </div>
      <div className="r-feed" />
    </div>
  );
}
