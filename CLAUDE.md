# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Shopify app built with Remix that manages invoice data for customers through POS (Point of Sale) extensions. The app allows store staff to collect and manage customer invoice information (Partita IVA, Codice Fiscale, PEC, Ragione Sociale) through a POS tile/modal interface, and automatically attaches invoice metadata to orders via webhooks.

## Development Commands

```bash
# Start development server (with Shopify CLI)
npm run dev

# Build the app
npm run build

# Run linter
npm run lint

# Start production server
npm run start

# Database setup (Prisma)
npm run setup

# Generate Prisma client
npx prisma generate

# Create database migration
npx prisma migrate dev --name migration_name

# Deploy database migrations
npx prisma migrate deploy

# Shopify CLI commands
shopify app deploy              # Deploy to Shopify
shopify app generate            # Generate app extensions
shopify app config link         # Link to app configuration
shopify app env                 # Manage environment variables
```

## Architecture

### Core Components

**Backend (Remix App)**
- `app/shopify.server.ts` - Central Shopify API configuration using `@shopify/shopify-app-remix`
  - Handles OAuth authentication
  - Configures Prisma session storage
  - Exports authentication utilities (`authenticate`, `login`, `registerWebhooks`)
  - Uses API version January 2025
  - Configured for embedded app with App Store distribution

- `app/db.server.ts` - Prisma client singleton with development hot-reload support

**Route Structure**
- `app/routes/app.tsx` - Main app layout with Polaris AppProvider and NavMenu
- `app/routes/app._index.tsx` - Admin dashboard (demo product creation)
- `app/routes/app.settings.tsx` - Settings page showing app URL, webhook status, and configuration
- `app/routes/api.*.ts` - API endpoints for POS extension communication:
  - `api.app-config.ts` - GET dynamic app URL (used by POS extension)
  - `api.customer-invoice-data.ts` - GET customer invoice metafields
  - `api.customer-invoice-save.ts` - SAVE customer invoice data
  - `api.customer-invoice-emit.ts` - TOGGLE invoice request flag
- `app/routes/webhooks.app.*.tsx` - Webhook handlers:
  - `webhooks.app.orders_create.tsx` - Core business logic: reads customer invoice metafields when order is created, resets customer's request_invoice flag, and writes invoice data to order metafields
  - `webhooks.app.uninstalled.tsx` - App cleanup
  - `webhooks.app.scopes_update.tsx` - Handle permission changes

**Authentication Flow**
- All API routes use `authenticate.admin(request)` to validate session tokens from POS extensions
- Webhook routes use `authenticate.webhook(request)` to validate Shopify webhook HMAC signatures
- Admin routes use `authenticate.admin(request)` for OAuth-based session management

### POS Extension (invoice-tail)

Located in `extensions/invoice-tail/`:
- **Tile.tsx** - POS home screen tile that opens the modal (enabled when cart has items)
- **Modal.tsx** - Full modal interface for managing customer invoice data
  - Dynamically fetches app URL from `/api/app-config` on mount
  - Fetches customer metafields via API routes
  - Validates required fields (partita_iva, codice_fiscale, pec, ragione_sociale)
  - Saves data back to Shopify customer metafields
  - Toggle "request invoice" flag for current customer

**Dynamic URL Configuration**: The extension automatically discovers the backend URL by reading a shop metafield (`app_config.app_url`) that is set during app installation/authentication. The URL is saved by the `afterAuth` hook in `shopify.server.ts` and read via GraphQL query in the POS extension. This allows it to work seamlessly across development (Cloudflare tunnel) and production environments without hardcoding URLs.

### Data Flow

1. **Customer invoice data collection** (POS):
   - Staff opens invoice modal in POS
   - Modal reads shop metafield `app_config.app_url` via GraphQL to get current app URL
   - Modal fetches customer metafields from `{appUrl}/api/customer-invoice-data`
   - Staff fills/edits invoice fields
   - Data saved via `{appUrl}/api/customer-invoice-save` to customer metafields (namespace: `invoice`)
   - Staff toggles "request invoice" flag via `{appUrl}/api/customer-invoice-emit`

2. **Order processing** (Webhook):
   - Order created triggers `webhooks.app.orders_create`
   - Webhook checks customer's `invoice.request_invoice` metafield
   - If true: copies `invoice.invoice_data` from customer to order metafields
   - Resets customer's `invoice.request_invoice` to false
   - Order now has `invoice.emit_invoice` = true and `invoice.invoice_data` JSON

### Metafield Schema

**Shop Metafields** (namespace: `app_config`):
- `app_url` (single_line_text_field) - Current app URL, set by `afterAuth` hook, used by POS extension

**Customer Metafields** (namespace: `invoice`):
- `request_invoice` (boolean) - Flag indicating customer wants invoice for next order
- `invoice_data` (json) - Contains: partita_iva, codice_fiscale, pec, ragione_sociale

**Order Metafields** (namespace: `invoice`):
- `emit_invoice` (boolean) - Flag indicating this order should generate an invoice
- `invoice_data` (json) - Copy of customer invoice data at time of order

### Database

Uses Prisma with SQLite (development). Schema in `prisma/schema.prisma`:
- `Session` model - Shopify session storage (required by `@shopify/shopify-app-session-storage-prisma`)

For production, consider migrating to PostgreSQL/MySQL as noted in README.

### Configuration Files

- `shopify.app.toml` - App configuration for Shopify CLI
  - Defines webhooks subscriptions
  - Access scopes: `read_customers,write_customers,write_products,read_orders,write_orders`
  - Embedded app configuration

- `vite.config.ts` - Vite bundler configuration
  - Remix plugin setup
  - HMR configuration for local/tunneled development
  - Optimizes Polaris and App Bridge dependencies

- `tsconfig.json` - TypeScript configuration (ES2022, strict mode)

## Key Technical Details

### Remix-Specific Patterns
- Use `loader` exports for GET requests (initial page data)
- Use `action` exports for POST/PUT/DELETE requests (mutations)
- Use `useFetcher` for actions without navigation
- Use `useLoaderData` to access loader data in components
- Always use `Link` from `@remix-run/react`, never `<a>` tags (embedded app requirement)

### Shopify-Specific Patterns
- Import `authenticate` from `app/shopify.server.ts`
- Use `admin.graphql()` for Admin API queries/mutations
- Webhook handlers must return Response objects
- All GraphQL operations use Admin API (no REST API - `removeRest: true`)
- GID format: `gid://shopify/Customer/123` for GraphQL IDs

### CORS Handling
API routes include CORS headers for POS extension access:
```typescript
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "POST, OPTIONS",
"Access-Control-Allow-Headers": "Content-Type, Authorization"
```

### Error Handling
- Webhook handlers should return appropriate HTTP status codes
- API routes return JSON responses with `success` boolean and error messages
- Use try-catch blocks in webhook handlers to prevent webhook retry storms

## Common Development Workflows

### Adding a New API Endpoint
1. Create `app/routes/api.endpoint-name.ts`
2. Export `loader` for OPTIONS (CORS preflight)
3. Export `action` for POST/PUT requests
4. Use `authenticate.admin(request)` to validate session
5. Return Response with CORS headers

### Modifying Webhook Logic
1. Edit relevant `app/routes/webhooks.app.*.tsx` file
2. Test with `shopify app webhook trigger --topic=<topic>`
3. Deploy changes: `npm run deploy`
4. Webhook subscriptions are in `shopify.app.toml`

### Updating POS Extension
1. Edit files in `extensions/invoice-tail/src/`
2. Extensions auto-rebuild on save during `npm run dev`
3. Test in Shopify POS app or simulator
4. Deploy with `shopify app deploy`

### Database Schema Changes
1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name descriptive_name`
3. Prisma client regenerates automatically
4. For production: `npx prisma migrate deploy`

## Dynamic URL Management

The app automatically handles different URLs between development and production:

**Development (Cloudflare Tunnel)**:
- Shopify CLI creates a new Cloudflare tunnel on each `npm run dev`
- The tunnel URL is injected as `process.env.SHOPIFY_APP_URL`
- The `afterAuth` hook saves this URL to shop metafield `app_config.app_url`
- POS extension reads the URL from the shop metafield via GraphQL
- Webhooks automatically update thanks to `automatically_update_urls_on_dev = true` in `shopify.app.toml`

**Production**:
- Set `SHOPIFY_APP_URL` to your deployed app URL (e.g., Heroku, Fly.io)
- The `afterAuth` hook will update the shop metafield on next authentication
- POS extension will read the production URL from the shop metafield
- Run `npm run deploy` to sync webhook URLs with production

**Important Note**: After changing `SHOPIFY_APP_URL`, the shop metafield will be updated automatically on the next OAuth flow (when a merchant reinstalls or when access token expires). To force an immediate update, you can uninstall and reinstall the app, or manually update the metafield via GraphQL.

**Monitoring**:
- Visit `/app/settings` to view current app URL and webhook status
- The settings page shows all active webhook subscriptions and their callback URLs
- Use this page to verify configuration after deployment

## Important Notes

- The app is configured for embedded mode (runs inside Shopify Admin iframe)
- POS extension uses dynamic URL fetching via `/api/app-config` - no hardcoded URLs
- Session storage uses SQLite in development; production should use PostgreSQL/MySQL
- Webhook API version is 2026-01, Admin API version is January 2025
- The app uses the new embedded auth strategy (`unstable_newEmbeddedAuthStrategy: true`)
- All webhook subscriptions are managed via `shopify.app.toml` (recommended approach)

---

## Session History & Major Updates

### Session: 2025-01-05 - Cart Properties Migration & UX Improvements

#### 🎯 Major Changes: Hybrid Approach (Cart Properties + Order Metafields)

**Problem Solved**: Migrated from fetching customer metafields in webhook to using cart properties that are automatically transferred to orders. This eliminates API calls and improves performance.

**Architecture Change**:
- **Before**: Webhook fetched customer metafields → wrote to order metafields
- **After**: POS writes cart properties → webhook reads from order customAttributes → writes to order metafields

#### Files Modified

**Backend:**
1. `app/routes/webhooks.app.orders_create.tsx`
   - Added `parseInvoiceDataFromCustomAttributes()` helper function
   - Reads `payload.note_attributes` (IMPORTANT: use `.name` not `.key`)
   - Reconstructs `invoice_data` JSON from `_invoice.*` properties
   - Handles nested `sede_legale` object
   - Metafield names updated:
     - `invoice.emit_invoice` → `invoice.requested` (boolean)
     - `invoice.invoice_emitted` → `invoice.emitted` (boolean)
     - `invoice.invoice_data` (json) - unchanged

2. `app/routes/app._index.tsx`
   - Added customer column with priority: ragione_sociale > displayName > firstName+lastName > email
   - Updated all references: `emit_invoice` → `requested`, `invoice_emitted` → `emitted`
   - Customer search implemented (searches all customer fields)

3. `app/routes/app.$orderId_.proforma.tsx`
   - Updated query: `metafield_emit_invoice` → `metafield_requested`

**Frontend POS:**
4. `extensions/invoice-tail/src/Modal.tsx`
   - Cart properties cleanup on customer removal or cart clear
   - Calls API to reset customer `request_invoice` flag
   - Loading state with `hasLoadedOnce` flag (prevents flicker)
   - Passes `cart.properties` to hook for priority logic

5. `extensions/invoice-tail/src/hooks/useCustomerInvoiceData.ts`
   - **CRITICAL CHANGE**: Cart properties priority over customer metafields
   - Logic: If `_invoice.requested` exists in cart → use it, else → default `false`
   - This prevents "stale" customer metafields from showing on clean carts
   - Added `hasLoadedOnce` tracking for loading state
   - Resets `hasLoadedOnce` when customer changes

6. `extensions/invoice-tail/src/Tile.tsx`
   - Shows customer name in subtitle when invoice requested
   - Watches cart properties for real-time updates

#### Cart Properties Structure

**Structured Properties (with underscore prefix - hidden in some contexts):**
```typescript
{
  "_invoice.updated_at": "timestamp",
  "_invoice.requested": "true" | "false",
  "_invoice.emitted": "false",
  "_invoice.customer_type": "company" | "individual",
  "_invoice.codice_fiscale": "BLDLFS01A69F839J",
  "_invoice.pec": "email@pec.it",
  "_invoice.codice_sdi": "ABC1DEF",
  // For companies only:
  "_invoice.ragione_sociale": "Company SRL",
  "_invoice.partita_iva": "12345678901",
  "_invoice.sede_legale.via": "Via Roma 1",
  "_invoice.sede_legale.cap": "00100",
  "_invoice.sede_legale.citta": "Roma",
  "_invoice.sede_legale.provincia": "RM"
}
```

**Display Properties (visible in POS cart):**
```typescript
{
  "Fattura - Ragione Sociale": "Company SRL",
  "Fattura - P.IVA": "12345678901",
  "Fattura - C.F.": "BLDLFS01A69F839J",
  "Fattura - Sede": "Via Roma 1, 00100 Roma (RM)",
  "Fattura - PEC": "email@pec.it",
  "Fattura - Codice SDI": "ABC1DEF"
}
```

#### Order Metafields Structure (namespace: "invoice")

```typescript
{
  requested: boolean,        // true when invoice requested
  emitted: boolean,          // false initially, true when issued
  invoice_data: {            // Complete JSON snapshot
    customer_type: "company" | "individual",
    codice_fiscale: string,
    pec?: string,
    codice_sdi?: string,
    // If company:
    ragione_sociale: string,
    partita_iva: string,
    sede_legale: {
      via: string,
      cap: string,
      citta: string,
      provincia: string
    }
  }
}
```

#### Critical Behaviors

**1. Cart Cleanup on Customer Removal/Cart Clear**
When customer is removed or cart is emptied:
- Removes all `_invoice.*` and `Fattura - *` properties
- Calls `/api/customer-invoice-emit` to reset customer flag
- Prevents invoice state from persisting across carts

**2. Cart Properties Priority Logic** (MOST IMPORTANT)
```typescript
// In useCustomerInvoiceData hook:
const hasCartInvoiceRequest = cartProperties?.['_invoice.requested'] !== undefined;
const finalInvoiceRequested = hasCartInvoiceRequest
  ? cartProperties['_invoice.requested'] === 'true'
  : false; // Clean cart = always false, ignore customer metafield!
```

**Why this matters:**
- Customer metafield `request_invoice` might still be `true` from previous order
- When cart is cleared, properties are removed
- Hook detects no cart properties → defaults to `false`
- **Prevents showing "Invoice Requested" on clean cart with same customer**

**3. Loading State**
- Shows loading immediately when modal opens with customer
- Uses `hasLoadedOnce` flag to track if initial load completed
- Prevents content → loading → content flicker
- Resets on customer change

#### Data Flow Complete Example

**Scenario: Order with Invoice**
1. POS: Staff enables invoice for customer AAA
2. POS: Cart properties written (`_invoice.requested = "true"`, all data fields)
3. POS: Order completed
4. Webhook: Receives order with `note_attributes` containing all `_invoice.*` properties
5. Webhook: `parseInvoiceDataFromCustomAttributes()` reconstructs JSON
6. Webhook: Writes 3 metafields to order: `requested`, `emitted`, `invoice_data`
7. Webhook: Resets customer `request_invoice` to `false`
8. Admin: Order list shows customer name and "Not emitted" badge
9. Admin: Proforma loads data from order `invoice_data` metafield

**Scenario: Cart Cleanup (Critical Fix)**
1. POS: Customer AAA has invoice enabled in cart 1
2. POS: Cart cleared (all items removed)
3. Modal: Cleanup effect detects empty cart with `_invoice.requested` present
4. Modal: Removes all cart properties
5. Modal: Calls API to reset customer metafield `request_invoice = false`
6. POS: New cart created, customer AAA added again
7. Modal: Hook checks cart properties → none found
8. Modal: `finalInvoiceRequested = false` (ignores customer metafield!)
9. Modal: Shows "Non richiesta" ✅ (correct behavior)

#### Benefits of This Approach

1. **Performance**: Eliminates customer metafield fetch in webhook (-1 API call per order)
2. **Reliability**: Data already in order via `customAttributes`, no race conditions
3. **Clean State**: Cart properties priority prevents stale customer data from showing
4. **User Experience**: Loading state prevents flicker, cleanup prevents confusion
5. **Maintainability**: Structured data in both formats (programmatic + display)

#### Common Issues & Solutions

**Issue**: Invoice shows "Requested" on clean cart with same customer
**Solution**: Cart properties priority logic (lines 85-103 in useCustomerInvoiceData.ts)

**Issue**: Loading shows content briefly then loading then content (flicker)
**Solution**: `hasLoadedOnce` flag and proper condition (line 196 in Modal.tsx)

**Issue**: Webhook can't read cart properties
**Solution**: Use `.name` not `.key` for `note_attributes` (line 74 in webhooks.app.orders_create.tsx)

**Issue**: Cart properties not cleaned up when customer removed
**Solution**: Cleanup effect in Modal.tsx (lines 70-139)

#### Testing Checklist

- [ ] Enable invoice for customer A, complete order → metafields written ✅
- [ ] Clear cart, add customer A again → shows "Not requested" ✅
- [ ] Remove customer from cart → properties cleaned ✅
- [ ] Search orders by customer name → finds orders ✅
- [ ] Modal opens → loading shows immediately, no flicker ✅
- [ ] Webhook logs show correct `note_attributes` parsing ✅

#### Future Considerations

- Consider removing customer metafield `request_invoice` entirely (only use cart properties)
- Add cart property validation before order creation
- Monitor webhook performance with cart properties approach
- Consider adding retry logic for cleanup API call failure

---
