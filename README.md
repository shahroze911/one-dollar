# Dollar POS

Point of sale + stock manager for a shop selling in **Pakistani rupees (Rs)**.
Next.js 14 + Supabase (database, login, picture storage) + Tailwind. Deploys to Vercel.

## What it does

- **Checkout:** scan a barcode (USB/Bluetooth scanner, phone camera, or type it) and the item goes into the cart. Cash with quick Rs 50 / 100 / 500 / 1000 / 5000 buttons and change due, or card. Unknown barcode? Add it on the spot (needs the owner password).
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
