# Bloomly — application under test (AUT)

Source: `public/aut/` (vanilla JS SPA). Data: `public/aut/data.json`.
In the trainer every test runs against a fresh "browser context" (empty storage,
logged out, empty cart) unless the task sets `app.state`.

Virtual base URL: `http://localhost:3000`. Tests use relative paths:
`await page.goto('/login')`, `await expect(page).toHaveURL('/account')`.

## Test data

| Email | Password | Name | Notes |
|---|---|---|---|
| anna@bloomly.app | bloom123 | Anna Silva (Lisbon) | main customer, 6 orders |
| tom@bloomly.app | tulips42 | Tom Becker (Berlin) | 2 orders |
| maya@bloomly.app | qa-rocks | Maya Chen | 0 orders |
| locked@bloomly.app | bloom123 | Lucy Locked | account locked |

Products (shop order = "Most popular"):

| id | name | category | price | stock |
|---|---|---|---|---|
| rose-bouquet | Rose Bouquet | bouquets | €35.00 | yes |
| sunny-tulips | Sunny Tulips | bouquets | €24.00 | yes |
| lavender-pot | Lavender Pot | plants | €18.00 | yes |
| peony-dream | Peony Dream | bouquets | €42.00 | yes |
| mint-succulent | Mint Succulent | plants | €12.00 | yes |
| white-orchid | White Orchid | plants | €29.00 | **out of stock** (button disabled) |

Promo codes: `BLOOM10` = −10%; `SPRING20` = expired. Delivery €4.90, free when
(subtotal − discount) ≥ €50. Prices are formatted `€35.00`.

Anna's orders (newest first): #1042 2026-09-28 Rose Bouquet, Lavender Pot €53.00 Delivered ·
#1041 2026-09-21 Sunny Tulips €28.90 Shipped · #1040 2026-09-14 Peony Dream €46.90 Processing ·
#1039 2026-09-02 Mint Succulent, Mint Succulent €28.90 Delivered · #1038 2026-08-25 White Orchid €33.90 Cancelled ·
#1037 2026-08-11 Rose Bouquet, Sunny Tulips €59.00 Delivered.

## Layout on every page

- `banner`: link **"Bloomly home"** (logo).
- `navigation` named **"Main"**: links **Shop**, **Orders**, **Cart** (accessible name "Cart 0" — contains the count),
  then either link **Log in** (logged out) or text `[data-testid=user-name]` "Anna" + button **Log out**.
  Cart count: `getByTestId('cart-count')`.
- Toast after cart actions: `getByRole('status')` / `getByTestId('toast')`, e.g. "Rose Bouquet added to cart" (disappears after 2.5 s).

## Pages

### `/` — Home (title "Bloomly — Fresh flowers delivered")
- heading h1 "Fresh flowers, delivered with love"; link **Shop now** → `/shop`; h2 "Why Bloomly?" + list of 3 features.

### `/login` — Log in (title "Log in · Bloomly")
- h1 **"Log in"** (note: the text "Log in" also appears on the nav link and the submit button → `getByText('Log in')` is a strict-mode violation).
- `getByLabel('Email')` — text input `#email`, placeholder "you@example.com".
- `getByLabel('Password')` — password input `#password`, placeholder "Your password" (password inputs have NO role textbox).
- checkbox **"Remember me"**.
- button **"Log in"** (`data-testid=login-button`). While submitting (≈250 ms) it is disabled with text "Logging in…".
- error box `getByRole('alert')` / `getByTestId('login-error')` (hidden until an error):
  - empty email → "Please enter your email."
  - not an email → "Please enter a valid email address."
  - empty password → "Please enter your password."
  - wrong email/password → "Invalid email or password."
  - locked user → "Your account is locked. Please contact support."
- email is trimmed and lower-cased before checking.
- success → navigates to `/account` (or `?next=` path). Visiting `/login` while logged in redirects to `/account`.
- link **"Create an account"** → `/signup`.

### `/account` — My account (login required, title "My account · Bloomly")
- h1 **"Welcome back, Anna!"** (first name).
- `getByTestId('account-name')` "Anna Silva", `account-email` "anna@bloomly.app", `account-city` "Lisbon".
- links **Go to shop**, **My orders**.
- Logged-out visit → redirect to `/login?next=%2Faccount`.

### `/signup` — Create account (title "Create account · Bloomly")
- h1 "Create your account".
- `getByLabel('Full name')`, `getByLabel('Email')`, `getByLabel('Password')` (placeholder "At least 8 characters").
- `getByLabel('Country')` select: "Choose a country" (value ""), Portugal (PT), Germany (DE), Poland (PL), Spain (ES), France (FR).
- radio group (fieldset) "Account type": radios **Personal** (checked) / **Business**.
- checkboxes **"Send me the Bloomly newsletter"**, **"I agree to the Terms of Service"**.
- button **"Create account"**.
- field errors (all shown at once, testids): `name-error` "Please enter your name." · `email-error` "Please enter a valid email address." / "This email is already registered." · `password-error` "Password must be at least 8 characters." · `country-error` "Please choose a country." · `terms-error` "You must accept the Terms of Service."
- success (≈250 ms): form hidden, `getByRole('status')` / `getByTestId('signup-success')` contains heading **"Account created!"** and "Welcome to Bloomly, Anna." (first word of the name). User is logged in.

### `/shop` — Shop (title "Shop · Bloomly")
- h1 "Shop". `getByLabel('Search')` (searchbox, placeholder "Search flowers"), `getByLabel('Category')` select (all/bouquets/plants), `getByLabel('Sort by')` select (popular / price-asc "Price: low to high" / price-desc "Price: high to low").
- "Loading products…" (`products-loading`) for ≈150 ms, then:
- `getByTestId('results-count')` "6 products" ("1 product").
- list `product-list` of `article` cards (`getByTestId('product-card')`), each: img (alt e.g. "Bouquet of pink roses"), h2 product name, `product-price` "€35.00", button **"Add to cart"** (`add-to-cart`). Every card has the same button name → use `.filter({ hasText: 'Sunny Tulips' })`.
- White Orchid: text "Out of stock", button disabled.
- search is case-insensitive substring; no match → `no-results` "No flowers found for “xyz”." and "0 products".
- `/shop?category=plants&q=rose&sort=price-asc` presets filters.

### `/cart` — Cart (title "Cart · Bloomly")
- h1 "Your cart". Empty → `cart-empty` "Your cart is empty." + link "Continue shopping".
- table `cart-table` (caption "Items in your cart"), one `row` per item (`cart-row`): name, price, quantity controls, `row-subtotal`, button **"Remove"** (`remove-item`, same name on every row).
- quantity: buttons **"Decrease Rose Bouquet"** (−, disabled at 1) / **"Increase Rose Bouquet"** (+, disabled at 10), spinbutton `getByLabel('Quantity of Rose Bouquet')` (`qty-input`, 1–10; `fill('3')` updates totals).
- promo: `getByLabel('Promo code')`, button **"Apply"**, message `promo-message` (role status):
  "Promo code BLOOM10 applied: −10%." / "This promo code is not valid." / "This promo code has expired." / "Please enter a promo code." (codes are case-insensitive).
- summary: `cart-subtotal`, `cart-discount` ("−€3.50"), `cart-delivery` ("€4.90" or "Free"), `cart-total`.
- button **"Proceed to checkout"** (`checkout-button`) → `/checkout`; link "Continue shopping".

### `/checkout` — Checkout (title "Checkout · Bloomly")
- `getByLabel('Full name')` (prefilled when logged in), `getByLabel('Street address')`, `getByLabel('City')` select (Lisbon/Berlin/Warsaw), `getByLabel('Delivery date')` (type=date, value format `2026-12-24`).
- radios "Delivery time": **Morning** (checked) / **Afternoon** / **Evening**.
- checkbox **"This is a gift"** → reveals `getByLabel('Gift message')` (textarea, max 200) and counter `gift-counter` "0/200". Hidden while unchecked.
- `order-total` "Total to pay: €39.90". Button **"Place order"**.
- errors: `co-name-error`, `co-address-error`, `co-city-error`, `co-date-error` ("Please choose a delivery date." / "Delivery date can't be in the past.").
- success (≈300 ms) → `/order-confirmation?id=1043`: h1 **"Thank you for your order!"**, `order-number` "Order #1043", `confirmation-total`. Cart is emptied.

### `/orders` — My orders (login required, title "My orders · Bloomly")
- h1 "My orders". `getByLabel('Status')` select (all/Processing/Shipped/Delivered/Cancelled), `getByLabel('Search orders')`.
- "Loading orders…" (`orders-loading`) for ≈400 ms.
- table `orders-table` (caption "Your recent orders"), columns Order/Date/Items/Total/Status; rows `order-row`, first cell "#1042".
- `orders-summary` "Showing 6 of 6 orders"; nothing matched → `orders-empty` "No orders match your filters.".

### Anything else → h1 "Page not found", title "Not found · Bloomly".

## Bugs that tasks can switch on (`app.bugs`)

| id | effect |
|---|---|
| `login-trim` | spaces around the email are not trimmed → "Please enter a valid email address." |
| `login-case-sensitive` | "Anna@Bloomly.app" → "Invalid email or password." |
| `login-no-error` | wrong password shows no error at all |
| `login-redirect-home` | successful login goes to `/` instead of `/account` |
| `greeting-wrong-name` | account heading uses last name: "Welcome back, Silva!" |
| `signup-terms-ignored` | account is created without accepting the terms |
| `signup-short-password` | 6–7 character passwords are accepted |
| `signup-greeting-email` | success text shows the email instead of the name |
| `search-case-sensitive` | "rose" finds nothing, "Rose" works |
| `sort-by-name` | price sorting actually sorts by name |
| `add-to-cart-double` | one click adds 2 items |
| `cart-count-stale` | header cart count does not update after "Add to cart" (until next page load) |
| `cart-total-ignores-qty` | row subtotals are right, but subtotal/total ignore quantity |
| `remove-wrong-item` | "Remove" always removes the first row |
| `promo-case-sensitive` | "bloom10" is rejected |
| `promo-stacks` | applying BLOOM10 twice gives −20% |
| `free-delivery-boundary` | exactly €50.00 still pays delivery |
| `checkout-past-date` | past delivery dates are accepted |
| `orders-filter-wrong` | "Shipped" filter also shows Processing orders |
| `orders-summary-wrong` | summary always counts all orders ("Showing 6 of 6") |

## Latency (`app.latency`)

Keys: `products` (default 150), `orders` (400), `login` (250), `signup` (250), `checkout` (300), `cookies` (0).
Value: ms or `[min, max]` (random each run — used to create flaky tests).
`app.cookieBanner: true` shows a fixed cookie dialog (role dialog "Cookie consent", buttons **Accept all** / **Reject**) that covers the bottom of the page.

## Preset state (`app.state`)

```yaml
app:
  state:
    user: anna@bloomly.app        # already logged in (like storageState in real Playwright)
    cart: [{ id: rose-bouquet, qty: 2 }]
    promo: BLOOM10
```
