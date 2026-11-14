# Market Fresh Delivery

A full-stack online market and home-delivery application. Customers order estimated-price products; the team then buys and quality-checks the requested items at the local market. If market prices change, customers must approve the revised total before the purchase continues.

## What is included

- Responsive React storefront with home, about, category, product detail, cart, checkout, registration, login, order history/tracking, contact, and admin pages.
- Express REST API backed by MongoDB and Mongoose.
- Customer, administrator, and delivery-person sign-in with bcrypt password hashing and role-checked JWTs in HTTP-only cookies.
- Product and category management, search, reviews for verified delivered purchases, customer addresses, cart, order history, order cancellation, and support messages.
- Admin order workflow: order confirmation, market-purchase pricing, customer price approval, delivery-person assignment, service-charge settings, sales summary, customer list, and support inbox.
- Delivery-person dashboard for assigned routes, address/contact details, arrival and failed-attempt logs, OTP resend, and delivery completion.
- Delivery verification: a random 6-digit code is sent by SMS to the customer's registered phone when an order goes out for delivery; only the assigned delivery person can complete delivery after arriving and verifying the code.
- Admin product management: create, edit, search, filter, feature, and delete products; maintain price, unit, image URL, optional stock quantity, and storefront availability.
- Cash on delivery works without a payment provider. Optional Stripe Checkout is available when Stripe API and webhook credentials are configured. Online payment is requested only after the customer approves the market price.
- Market Fresh AI Shopping Assistant: a responsive storefront chat that searches live catalog data, manages a signed-in customer's cart, checks real order statuses, and requires a separate confirmation against a refreshed order estimate.

## Requirements

- Node.js 20 or newer and npm
- MongoDB Community Server locally, or a MongoDB connection string
- Optional: a Stripe account and Stripe CLI (for online payments and local webhook testing)

## Install and run locally

1. Copy `server/.env.example` to `server/.env`.
2. Set `MONGODB_URI` and replace `JWT_SECRET` with a random secret of at least 32 characters. Set a strong `ADMIN_PASSWORD` of at least 12 characters. Do not commit `.env`.
3. If you have not installed MongoDB as a service, start your MongoDB server.
4. From the project root, install all workspace dependencies:

   ```sh
   npm install
   ```

5. Create the first admin and load the starter categories/products:

   ```sh
   npm run seed:admin
   ```

   The seed reads `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` from `server/.env`; it creates the admin only when that email does not already exist. It can safely be run again to refresh the starter catalog, including the expanded fruit, vegetable, and grocery selection.

6. Start the API and React development server:

   ```sh
   npm run dev
   ```

7. Visit [http://localhost:5173](http://localhost:5173). The API runs on [http://localhost:4000](http://localhost:4000). The customer registration and sign-in links are in the header; the team can sign in at **Team sign in** in the footer.

For a production frontend build, run `npm run build`. Start the API with `npm start` from the project root. Deploy the built `client/dist` directory to a static host and configure the API and frontend origins appropriately.

### Admin login troubleshooting

The Admin Login page uses `POST /api/auth/admin/login`. If it returns a server error, first confirm the API starts successfully and MongoDB is reachable using the configured `MONGODB_URI`. Create the initial admin account with `npm run seed:admin`; an unrecognized email or password returns an authentication error, not a server error. The API returns `503` when MongoDB is unavailable during a request.

## Optional Stripe Checkout

Set `STRIPE_SECRET_KEY` and a lowercase ISO currency in `server/.env` (the default is `inr`). Set `STRIPE_WEBHOOK_SECRET` to the webhook signing secret. In local development, start the app and forward Stripe events to the API:

```sh
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Copy the printed `whsec_...` secret into `STRIPE_WEBHOOK_SECRET` and restart the API. Stripe Checkout is offered at checkout only when the server key is configured. For orders with changed market prices, payment remains unavailable until the customer approves the final amount. Configure your live Stripe webhook to call `/api/webhooks/stripe` and subscribe to `checkout.session.completed` before enabling live online payments.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `4000`) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Random signing secret, at least 32 characters |
| `CLIENT_URL` | Frontend origin allowed by CORS (default `http://localhost:5173`) |
| `COOKIE_SECURE` | Set to `true` behind HTTPS in production |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Initial admin for `npm run seed:admin` |
| `SERVICE_CHARGE_PERCENT` | Initial service charge percentage (default `5`; editable in admin reports) |
| `OTP_HASH_SECRET` | Optional random secret (at least 32 characters) used to HMAC delivery OTPs; defaults to `JWT_SECRET` |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for delivery-code SMS |
| `TWILIO_AUTH_TOKEN` | Twilio auth token; keep in `server/.env` only |
| `TWILIO_FROM_NUMBER` | Twilio-enabled sender number in E.164 format |
| `SMS_DEFAULT_COUNTRY_CODE` | Country code for local 10-digit SMS numbers (default `91`) |
| `STRIPE_SECRET_KEY` | Optional Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | Optional Stripe webhook signing secret |
| `STRIPE_CURRENCY` | Stripe currency code (default `inr`) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp Cloud API phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp Business Account ID used when configuring the Meta webhook |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API bearer token; keep in `server/.env` only |
| `WHATSAPP_VERIFY_TOKEN` | Secret value used to verify the Meta webhook setup challenge |
| `WHATSAPP_APP_SECRET` | Meta app secret used to validate webhook POST signatures |
| `WHATSAPP_API_VERSION` | Graph API version (default `v22.0`) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Approved WhatsApp template language (default `en_US`) |
| `WHATSAPP_ORDER_CONFIRMATION_TEMPLATE` | Approved order confirmation template name (default `order_confirmation`) |
| `WHATSAPP_DELIVERY_TEMPLATE` | Approved delivery template name (default `delivery_notification`) |
| `WHATSAPP_ORDER_STATUS_TEMPLATE` | Approved status template for confirmed, packed, and dispatched orders (default `order_status_update`) |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | Country code for local 10-digit numbers (default `91`) |

## WhatsApp Cloud API notifications

Set the WhatsApp variables in `server/.env`; never add the access token to client code or a `VITE_` variable. The backend sends an approved `order_confirmation` template after orders are placed through checkout or the shopping assistant, and an approved `delivery_notification` template when an admin changes an order to Delivered. Notifications use the delivery phone number and do not prevent an order update if Meta is unavailable; failures are written to the server log without logging credentials.

Create and get Meta approval for the templates before enabling notifications. The order template body should have three text placeholders in this order: customer name, order number, and total (for example, `Hi {{1}}, we received order #{{2}} totaling {{3}}.`). The delivery template should have two: customer name and order number (for example, `Hi {{1}}, order #{{2}} has been delivered. Thank you!`). Configure the template names/language to match the approved templates.

In the Meta App Dashboard, configure the webhook callback URL as `https://YOUR_API_HOST/api/webhooks/whatsapp`, subscribe to the WhatsApp Business Account `messages` field, and set the same `WHATSAPP_VERIFY_TOKEN` value on both sides. Set `WHATSAPP_APP_SECRET` from the Meta app dashboard so webhook POST payloads are validated with `X-Hub-Signature-256`. The `WHATSAPP_BUSINESS_ACCOUNT_ID` is used during Meta setup; message sends use the phone number ID. Ten-digit local delivery numbers are prefixed with the configured default country code.

Order confirmation, order status (confirmed, packed, and out for delivery), and delivery messages are sent as templates because WhatsApp requires approved templates for business-initiated messages outside the customer-service window. The status template body takes three text placeholders in this order: customer name, order number, and status (for example, `Hi {{1}}, order #{{2}} is now {{3}}.`). Keep `server/.env` out of source control; it is ignored by `.gitignore`.

## SMS delivery verification

Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in `server/.env` to enable delivery codes. Set `OTP_HASH_SECRET` to a separate random secret of at least 32 characters; if omitted, the server uses `JWT_SECRET` to HMAC the stored code. Credentials and codes are only used by the server.

When an administrator changes an order to **Out for Delivery**, the server sends a six-digit code to the customer's registered phone. Codes expire after 10 minutes, are stored only as keyed hashes, and allow at most five verification attempts. Admins create and assign delivery-person accounts from **Admin Dashboard → Delivery**. The assigned person signs in at `/delivery`, records arrival at the customer's address, and enters the code supplied by the customer. Admin and customer APIs never return the code or its hash. Resending is limited to one request per minute and three resends per order, and verification requests are rate limited. If SMS is not configured or delivery fails, the order remains packed.

Use HTTPS, strong unique secrets, a managed MongoDB deployment, restrictive CORS, and a production Stripe webhook before serving real customers. The sample catalog images are hosted by Unsplash; replace them with your own licensed product photography for production.

## Product management

Sign in with the seeded administrator account and open **Team sign in** from the site footer. In the Admin Dashboard, choose **Products** to add and manage listings. Products can only be assigned to **Fruits**, **Vegetables**, or **Groceries**. Enter the product name, category, price, price unit, optional image URL, and stock quantity; use the availability toggle to control whether customers can order it. A quantity of zero automatically marks the product unavailable. Existing products without a recorded quantity remain untracked until an admin enters one.

Use the Products search and filters to locate an item, then choose **Edit** to update its details or **Delete** and confirm to remove it. Deleting a product also removes it from customer carts. Product images are stored as URLs, matching the existing product model; use an accessible image URL.

The admin product APIs are `GET /api/admin/products`, `POST /api/products`, `PUT /api/products/:id`, and `DELETE /api/products/:id`. All write operations require the existing admin session.

## Order workflow

1. Customers create an account, browse, add products to their cart, save a delivery address, and submit an order. The order stores estimated product prices, the service charge, address, and payment method.
2. The admin confirms the order, then advances it to **Market Purchasing**. The team records actual market prices and quality-checks the products.
3. If prices changed, the customer sees the revised item prices and final bill and must approve before packing. Unchanged prices can be confirmed without an unnecessary approval.
4. The admin marks the order **Packed**, assigns an active delivery person, and advances it to **Out for Delivery**. The server sends a code to the customer's registered mobile; the assigned person records arrival and verifies the code at the address.
5. Customer order pages refresh periodically and show **Order Placed**, **Order Confirmed**, **Market Purchasing**, **Quality Checking**, **Packed**, **Out for Delivery**, **OTP Verification**, and **Delivered**.
6. Cash-on-delivery orders are marked paid only after successful OTP verification. Stripe orders are marked paid from the verified Stripe webhook and cannot be delivered until then. Successful delivery records the timestamp, assigned delivery person, and verification events. Delivery currently has no separate fee; it appears explicitly in checkout and order totals.

## Market Fresh AI Shopping Assistant

The storefront chat is available from the **Ask Fresh AI** button. It searches MongoDB-backed products and reports their catalog prices and stock status. Signed-in customers can ask it to add, remove, or change cart items, view a price breakdown, and check their saved order statuses. Guests can search products and learn about the market-purchase and quality-check process; cart and order data require customer sign-in.

When a customer asks the assistant to place an order, it shows the current cart, delivery address, service charge, delivery charge, and cash-on-delivery total first. A separate **Confirm order** action is required. The server rechecks the cart, address, product availability, catalog prices, and service charge before creating the order; if any quote inputs have changed, it requires another review and confirmation. The assistant does not invent catalog details or order updates.

Assistant API: `POST /api/assistant/chat` accepts `{ "message": "..." }` and, only when confirming a previously displayed estimate, a `confirmationToken`. Requests are limited to 25 per minute per client. Product search is available without an account; cart changes, order placement, and personal order status use the existing HTTP-only customer session.

## REST API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/admin/login`, `POST /api/auth/delivery/login`
- `GET /api/store/config`, `GET /api/categories`, `GET /api/products`, `GET /api/products/:id`, `POST /api/products/:id/reviews`
- Customer cart: `GET /api/cart`, `POST /api/cart/items`, `PATCH /api/cart/items/:productId`, `DELETE /api/cart/items/:productId`
- Customer addresses: `GET /api/addresses`, `POST /api/addresses`, `DELETE /api/addresses/:id`
- Customer orders: `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/price-approval`, `POST /api/orders/:id/cancel`
- Shopping assistant: `POST /api/assistant/chat`
- Payments/support: `POST /api/payments/checkout/:orderId`, `POST /api/webhooks/stripe`, `POST /api/contact`
- WhatsApp Cloud API: `GET /api/webhooks/whatsapp` (Meta verification challenge), `POST /api/webhooks/whatsapp` (signed event callbacks)
- Admin: `/api/admin/summary`, `/api/admin/customers`, `/api/admin/orders`, `/api/admin/delivery-personnel`, `/api/admin/products`, `/api/admin/settings`, `/api/admin/messages`; admin-only product/category CRUD and `PATCH /api/admin/orders/:id`.
- Delivery-person: `GET /api/delivery/orders`, `POST /api/delivery/orders/:id/attempt`, `POST /api/delivery/orders/:id/delivery-otp`, and `POST /api/delivery/orders/:id/deliver`. Each route is restricted to the active delivery person assigned to that order.

All request bodies are validated on the server. Admin-only and customer-only endpoints use role-checked authentication; payment completion is recorded only from a signature-verified Stripe webhook.
