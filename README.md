# Dollar POS

Point of sale + stock manager for a shop selling in **Pakistani rupees (Rs)**.
Next.js 14 + Supabase (database, login, picture storage) + Tailwind. Deploys to Vercel.

## What it does

- **Checkout:** scan a barcode (USB/Bluetooth scanner, phone camera, or type it) and the item goes into the cart. Cash with quick Rs 50 / 100 / 500 / 1000 / 5000 buttons and change due, or card. Unknown barcode? Add it on the spot (needs the owner password).
- **Hold a sale:** press **Hold** (or `F4`) to park the current cart and serve the next customer. Held sales appear in an "On hold" strip above the cart; tap one to continue it (the cart you were on goes on hold automatically, so nothing is lost). Held sales are kept in that browser, so they survive a refresh. Stock is not reserved while a sale is on hold; it is re-checked when you continue it.
- **Custom Bill (owner area):** for bulk stock sold at a price you decide per sale (e.g. 300 pieces in stock, today 3 go at Rs 250 or Rs 300 each). Pick the item, set the quantity and your price (one-tap chips remember recent prices), and it creates the bill, receipt and stock deduction. Only an unlocked owner can sell at a price other than the listed one: the database refuses it otherwise.
  Custom Bill now has everything Checkout has: discounts (line and whole bill), split payments, camera scanning, quick-add of unknown barcodes, Hold/Resume (its own held list), the cash-drawer reminder and the F2 / F4 / F9 shortcuts.
- **Reports (owner area, sidebar > Reports):** pick Today, Yesterday, 7/30 days, this or last month, or exact dates. See sales, discounts, refunds, profit, payments by method, day by day, best sellers, cashiers and refund reasons. **Download Excel report**: one .xlsx file with 7 coloured sheets (Summary, Day by day, Best sellers, Sales, Sold items, Refunds, Cash drawer), filter arrows on every table, frozen headers and totals that follow whatever you filter. Plain CSV files are also offered for other software. "Print / save as PDF" prints the report page. The Sales page also has a **Download** button (Excel: Sales + Sold items sheets) for the period you are looking at, all of it, not just the 50 shown.
- **Works on any screen:** phone, tablet, desktop. On phones the menu is a bottom bar that scrolls sideways, tables scroll instead of squeezing, inputs don't trigger zoom on iPhone, and the bars respect the notch / home indicator.
- **Menu (Settings > "Menu: choose what to show"):** hide pages you don't use (Checkout, Cash Drawer, Custom Bill, Products, Stock, Sales, Dashboard). It applies to every device. It only tidies the menu; the owner password is still what protects the owner pages. Settings is always visible.

- **Discounts:** on any line ("Add discount", Rs or %) and on the whole sale. A discount up to the limit in Settings (default 10%) is allowed for cashiers; above it the till asks for the owner password. The server enforces this too.
- **Split payments:** tap "Split payment" to take part cash, part card, part JazzCash/Easypaisa. Cash can give change; card/wallet can't exceed the bill. The receipt lists each part.
- **Refunds (owner area, Sales page):** open a receipt, "Refund items", pick items and quantities, choose a reason and how the money goes back, and whether the items return to stock. The amount follows what the customer really paid (discounts included). A refund receipt is printed and kept. A sale that has refunds can't be voided.
- **Cash drawer (sidebar, everyone):** open a shift with your opening float, record cash in/out (tea, supplier, deposit), and at the end count the drawer blind. The system compares your count with what it expects; any difference needs a written reason and is saved. The owner sees the expected figure and past shifts.
- **Settings:** shop logo (auto-converted to black & white for thermal paper), optional WhatsApp / Instagram / Facebook / TikTok / website lines on the receipt, cashier discount limit, paper width, live preview.

> **Upgrading from an earlier version:** re-run the whole `supabase/schema.sql` in the SQL Editor. It is safe to run again and keeps your products and sales. The app will not work until you do (checkout and Settings use new database functions).
- **Thermal receipts:** prints on 80 mm or 58 mm rolls right after each sale (can be switched off), and any past receipt can be reprinted.
- **Records:** every sale is saved with a receipt number, cashier, items, payment and change. Search by receipt number, filter by period, void a sale (stock returns).
- **Product pictures:** optional. Photos are shrunk in the browser before upload (about 40 KB each).
- **Owner password:** Products, Stock, Sales, Dashboard and Settings are locked. Cashiers can only use Checkout.
- **Dashboard:** today vs yesterday, profit, 7-day chart, top sellers, restock list, inventory value.

## How the password protection works

Two layers: the normal email login (everyone), then an **owner password** for the owner pages.
It is enforced **in the database**, not just hidden in the screen: without the password, the database itself refuses to return sales, stock history or cost prices, and refuses to change products, stock or settings. 5 wrong tries locks it for 5 minutes. Owner mode lasts 60 minutes, or until you press Lock.

## Setup / upgrade

### 1. Database
1. Supabase → **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
   It works on a new project **and** safely upgrades the earlier version (your products and sales are kept). It also creates the `product-images` storage bucket.
2. **Authentication → Users:** add one user per person (cashiers and you). Turn off public sign-ups under Sign In / Providers.
3. Project Settings → API → copy the Project URL and anon key.

### 2. Run / deploy
```bash
npm install
cp .env.example .env.local      # paste the two values
npm run dev                     # http://localhost:3000
```
Push to GitHub and import into Vercel with the same two environment variables. For an upgrade, just `git push`.

### 3. First login: do these right away
1. Open **Products**. It asks you to **create the owner password**. Do this immediately, before cashiers log in.
2. Open **Settings** and fill in shop name, address, phone, footer message and paper width. Press **Test print**.

**Forgot the owner password?** In the Supabase SQL Editor run: `update public.admin_secret set hash = null;` then open Products and create a new one.

## Thermal printer setup (Windows / Chrome or Edge)

1. Install the printer's driver (from the maker's website) and confirm it prints a Windows test page.
2. Open the app → Settings → **Test print**. In the print dialog choose the thermal printer, set **Margins: None**, **Scale: 100%**, turn **Headers and footers off**. Paper size is the 80 mm (or 58 mm) roll.
3. **One-click printing with no dialog:** right-click your Chrome shortcut → Properties → in *Target* add ` --kiosk-printing` at the end → use that shortcut for the till. Receipts then print instantly to the default printer (set the thermal printer as default).
4. Printing from Android/iPad shows the system print sheet; a Bluetooth ESC/POS printer would need a small extra app, so a USB printer on a PC or laptop is the smooth option.

## Barcode scanners

- **USB / Bluetooth scanner:** plug in and scan. It types the number and presses Enter, which is all the app needs.
- **Phone camera:** *Camera* button on Checkout (Chrome on Android and desktop; needs HTTPS, which Vercel provides).
- **No barcode on the item:** in Products use *Generate*, or tap the item in the Checkout grid.

## Notes

- Every signed-in user can sell; only people who know the owner password can see records and costs.
- Prices come from the database at checkout; a price change only affects future sales. Old receipts keep the price they sold at.
- Free Supabase projects pause after ~1 week of inactivity and have no automatic backups. Export the `sales` and `products` tables now and then.

## Selling without internet (offline mode)

Checkout keeps working when the internet drops:

- The app opens with no internet (it is saved on the device) and uses the product list from the last time it was online.
- If a sale can't reach the server, it is **saved on that device**, a receipt marked "OFFLINE RECEIPT" with a temporary number (OFF-001…) prints, and stock on screen goes down. A coloured bar at the top shows "No internet" and how many sales are waiting.
- When the internet returns the sales are sent automatically (oldest first). Each sale has its own unique id, so a sale can never be recorded twice, even if the connection drops in the middle of sending.
- Sales that look odd on arrival (price changed meanwhile, stock was short, discount above the limit) are still recorded, but marked **check** on the Sales page with the reason.

**Set it up once (important):**
1. Re-run `supabase/schema.sql` (adds the fields that make this safe).
2. Offline mode works on the **deployed (Vercel) site**, not under `npm run dev`. Open the site while online at least once on each till, and open Checkout, so it is saved.
3. Optional: in Chrome use the menu > "Install app" / "Add to Home screen". It then opens like an app.

**Limits to know:**
- Needs internet: signing in, Custom Bill, refunds, products/stock changes, the cash drawer, anything needing the owner password (so a discount above your limit can't be approved offline).
- Don't clear browser data or sign out of the till while sales are waiting. The bar shows what is waiting. Signing out warns you first.
- Stock is exact only after sync. Two tills selling the last item offline can leave one sale flagged "check".
- Offline sales join the cash-drawer shift that is open **when they are sent**, not when they were made.
- Offline receipts have temporary numbers; the real receipt number appears on the Sales page after sync.
