import { fmtReceiptDate, money, receiptNo } from "@/lib/format";
import { imageUrl } from "@/lib/images";
import { methodLabel } from "@/lib/payments";
import type { ReceiptData, ShopSettings } from "@/lib/types";

/**
 * The receipt exactly as it prints on a 58mm / 80mm thermal roll.
 * Styling lives in globals.css (.receipt, .r-*) so screen preview and print match.
 */
export function ReceiptView({ data, settings }: { data: ReceiptData; settings: ShopSettings }) {
  const w = settings.paper_width === 58 ? "w58" : "w80";
  const isRefund = data.kind === "refund";
  const logo = imageUrl(settings.logo_path);
  const qtyTotal = data.items.reduce((s, i) => s + i.qty, 0);
  const saleDisc = Number(data.discount ?? 0);
  const lineDisc = data.items.reduce((s, i) => s + Number(i.discount ?? 0), 0);
  const showSubtotal = !isRefund && (saleDisc > 0 || lineDisc > 0);
  const subtotal = data.subtotal != null && data.subtotal > 0 ? data.subtotal : data.total + saleDisc;

  const socials = (
    [
      ["WhatsApp", settings.whatsapp],
      ["Instagram", settings.instagram],
      ["Facebook", settings.facebook],
      ["TikTok", settings.tiktok],
      ["Web", settings.website],
    ] as const
  ).filter(([, v]) => v && v.trim());

  return (
    <div className={`receipt ${w}`}>
      <div className="r-c">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="r-logo" />
        )}
        <div className="r-title">{settings.shop_name}</div>
        {settings.address && <div>{settings.address}</div>}
        {settings.phone && <div>Tel: {settings.phone}</div>}
      </div>

      <div className="r-dash" />

      {isRefund && <div className="r-c r-b r-big">*** REFUND ***</div>}
      {data.offline && <div className="r-c r-b">** OFFLINE RECEIPT **</div>}

      <div className="r-row">
        <span>{isRefund ? "Refund #" : "Receipt #"}</span>
        <span className="r-b">{data.temp_no ?? receiptNo(data.id)}</span>
      </div>
      {isRefund && data.ref_sale != null && (
        <div className="r-row">
          <span>Original receipt</span>
          <span>#{receiptNo(data.ref_sale)}</span>
        </div>
      )}
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
        <span>{isRefund ? "Refund via" : "Payment"}</span>
        <span>{methodLabel(data.payment_method)}</span>
      </div>

      <div className="r-dash" />

      {data.items.map((i, idx) => (
        <div key={idx} className="r-item">
          <div className="r-b">{i.name}</div>
          <div className="r-row">
            <span>
              {i.qty} x {money(i.unit_price)}
            </span>
            <span>
              {isRefund ? "-" : ""}
              {money(i.qty * i.unit_price)}
            </span>
          </div>
          {Number(i.discount ?? 0) > 0 && (
            <div className="r-row">
              <span>&nbsp;&nbsp;Discount</span>
              <span>-{money(i.discount)}</span>
            </div>
          )}
        </div>
      ))}

      <div className="r-dash" />

      <div className="r-row">
        <span>Items</span>
        <span>{qtyTotal}</span>
      </div>
      {showSubtotal && (
        <div className="r-row">
          <span>Subtotal</span>
          <span>{money(subtotal)}</span>
        </div>
      )}
      {saleDisc > 0 && (
        <div className="r-row">
          <span>Discount</span>
          <span>-{money(saleDisc)}</span>
        </div>
      )}
      <div className="r-row r-total">
        <span>{isRefund ? "TOTAL REFUND" : "TOTAL"}</span>
        <span>{money(data.total)}</span>
      </div>

      {!isRefund && data.payments && data.payments.length > 1 && (
        <>
          {data.payments.map((p, idx) => (
            <div key={idx} className="r-row">
              <span>Paid by {methodLabel(p.method)}</span>
              <span>{money(p.amount)}</span>
            </div>
          ))}
        </>
      )}
      {!isRefund && data.cash_received != null && (
        <>
          <div className="r-row">
            <span>Cash received</span>
            <span>{money(data.cash_received)}</span>
          </div>
          <div className="r-row r-b">
            <span>Change</span>
            <span>{money(data.change_given ?? 0)}</span>
          </div>
        </>
      )}

      {isRefund && data.reason && <div className="r-mt">Reason: {data.reason}</div>}
      {data.voided && <div className="r-c r-b r-mt">*** VOIDED SALE ***</div>}

      <div className="r-dash" />

      <div className="r-c">
        {settings.footer && !isRefund && <div>{settings.footer}</div>}
        {socials.length > 0 && (
          <div className="r-mt">
            {socials.map(([label, value]) => (
              <div key={label}>
                {label}: {value}
              </div>
            ))}
          </div>
        )}
        {data.duplicate && <div className="r-mt">-- Duplicate copy --</div>}
      </div>
      <div className="r-feed" />
    </div>
  );
}
