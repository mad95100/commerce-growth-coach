# BS Garage — Architecture

BS Garage is a billing-first management system for an automotive garage in
Dubai. Everything around the invoice (customers, vehicles, estimates, job
cards, parts, stock, suppliers, appointments, inspections) exists to make
invoicing faster and more accurate.

This document records the decisions taken before and during implementation.
Each decision states **why**, so it can be revisited with the reasoning intact.

---

## 1. Where the code lives

The repository already contains **EcomPilot**, an unrelated Shopify audit SaaS
(French copy, its own CI, its own Supabase project, deployed on Cloudflare).

BS Garage is a different product, with different users, language and data.
It lives in `garage/` as a **self-contained package**:

- its own `package.json`, lockfile, TypeScript, lint and build;
- its own Supabase migrations in `garage/supabase/migrations`;
- its own tests in `garage/tests`.

Nothing in `garage/` is imported by EcomPilot and vice versa. The folder can be
moved to its own repository with `git subtree split` without any code change.
The root ESLint configuration ignores `garage/` (it has its own).

## 2. Stack

Same family as the existing project, so the team keeps one skill set:

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 19, TypeScript strict, Tailwind 4 | Same as EcomPilot |
| Routing | TanStack Router, file-based | Same conventions as EcomPilot |
| Data fetching | TanStack Query + supabase-js | Cache, retries, loading/error states |
| Database | Supabase Postgres | Relational data, row-level security, transactions |
| Auth | Supabase Auth (email + password) | Managed, JWT understood by Postgres |
| Business logic | **Postgres functions (RPC)** | Atomic, tenant-safe, one source of truth |
| Charts | Recharts | Already used in EcomPilot |
| Build | Vite, static SPA | No server secrets needed: deployable on any static host |

**Why a static SPA and not SSR?** Every screen is behind a login and every
number comes from the database under row-level security. There is no secret
the browser must not see, so there is no server-side code to protect. A static
build is faster on tablets, cheaper to host, and has fewer moving parts.

**Why business logic in Postgres?** Issuing an invoice touches five tables in
one go: assign a gapless number, freeze customer and vehicle details, move
stock, link deposits, write the audit log. If any step fails, none may
happen. A Postgres function runs in a single transaction; a sequence of
browser calls cannot. It also means the rules hold whatever client calls them.

## 3. Multi-tenant strategy

- One **organization** = one garage business (tenant). Every business row
  carries `org_id NOT NULL`.
- A user belongs to organizations through **memberships** (`org_id`,
  `user_id`, `role`). One user can belong to several garages (SaaS-ready).
- **Row-level security is enabled on every table.** Read policies require an
  active membership in the row's organization *and* the permission to view
  that area.
- Relations between tenant rows use **composite foreign keys**
  `(org_id, x_id) → x(org_id, id)`. A vehicle of garage A can never be attached
  to a customer of garage B, even by a bug in a function.
- Financial tables (estimates, job cards, invoices, lines, payments, credit
  notes, stock, purchase orders, audit log) accept **no direct writes** from
  the browser. Writes go through `SECURITY DEFINER` functions that check
  membership and permission explicitly, then act.
- Internal helpers live in the `private` schema, which is not exposed by the
  API and has no execute grant for users.

**Branches.** `branches` belong to an organization. Documents, stock levels
and stock movements carry a `branch_id`. Customers, vehicles and the catalog
are shared across branches (a customer may visit any branch). The dashboard
and reports filter by branch. *Not built yet:* restricting a user to one
branch. It needs a `branch_id` on memberships plus policy changes; it is
listed in §11.

## 4. Roles and permissions

Roles: `owner`, `admin`, `manager`, `service_advisor`, `mechanic`,
`accountant`. Permissions are fine-grained strings stored in the
`role_permissions` table. The database checks them (`has_perm(org, perm)`);
the UI reads the same table to hide what the user cannot do, so the two can
never disagree.

| Permission | Owner | Admin | Manager | Advisor | Mechanic | Accountant |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| See financial figures | ✓ | ✓ | ✓ | | | ✓ |
| View invoices | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Create / edit draft invoices | ✓ | ✓ | ✓ | ✓ | | |
| Issue invoices | ✓ | ✓ | ✓ | ✓ | | |
| Cancel invoices | ✓ | ✓ | ✓ | | | |
| Record payments | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Void payments, refunds, credit notes | ✓ | ✓ | ✓ | | | ✓ |
| Estimates | ✓ | ✓ | ✓ | ✓ | | view |
| Job cards (all) | ✓ | ✓ | ✓ | ✓ | own only | view |
| Update progress on own job cards | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Customers & vehicles | ✓ | ✓ | ✓ | ✓ | view | view |
| Catalog & prices | ✓ | ✓ | ✓ | view | view | view |
| Stock adjustments | ✓ | ✓ | ✓ | | | |
| Suppliers & purchase orders | ✓ | ✓ | ✓ | view | | view |
| Appointments | ✓ | ✓ | ✓ | ✓ | view | |
| Inspections | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Reports | ✓ | ✓ | ✓ | | | ✓ |
| Audit log | ✓ | ✓ | ✓ | | | ✓ |
| Settings | ✓ | ✓ | | | | |
| Users | ✓ | ✓ | | | | |

A mechanic manages their job cards (status, diagnosis, work done) but cannot
change any amount. The exact matrix is the seed of `role_permissions` in the
first migration.

## 5. Data model

```
organizations ─┬─ branches
               ├─ memberships ── auth.users
               ├─ invitations
               ├─ tax_rates · payment_methods · document_sequences
               ├─ technicians (optionally linked to a user account)
               ├─ customers ── vehicles
               ├─ parts ── stock_levels (per branch) ── stock_movements
               ├─ services (labor library)
               ├─ suppliers ── supplier_parts (supplier prices)
               │            └─ purchase_orders ── purchase_order_lines
               ├─ estimates ─┐
               ├─ job_cards ─┼── doc_lines (one table, one parent each)
               ├─ invoices ──┤
               ├─ credit_notes┘
               ├─ payments (payment · deposit · refund)
               ├─ appointments
               ├─ inspections ── inspection_items
               ├─ outbound_messages (reminders and documents sent)
               └─ audit_log
```

### Documents and lines

Estimates, job cards, invoices and credit notes share **one line table**,
`doc_lines`, with exactly one parent column set (checked by a constraint).
A line has a `kind`: `part`, `labor`, `service` or `other`. For labor,
`quantity` is the number of hours and `unit_price` is the hourly rate.

Each line stores its computed amounts (gross, line discount, net, share of
the document discount, taxable amount, VAT, total). Stored amounts are what
was billed; they never depend on today's catalog price.

### Invoices

- A draft has no number. The number is assigned **when the invoice is
  issued**, from a per-organization counter locked for the transaction. This
  makes numbering gapless and sequential.
- At issue time, the customer's and vehicle's details are **copied into the
  invoice** (`customer_snapshot`, `vehicle_snapshot`). Editing a customer
  later never rewrites an issued invoice.
- An issued invoice is **immutable**. It is corrected with a credit note, or
  cancelled if nothing has been paid on it.
- Stored lifecycle: `draft` → `issued` → (`cancelled`). The displayed status
  is derived, never stored twice: `Draft`, `Sent`, `Unpaid`,
  `Partially paid`, `Paid`, `Overdue`, `Cancelled`, plus `Refund due` when
  the customer has paid more than they owe.
- `balance = total − credited − (payments + deposits − refunds)`.

### Payments, deposits, receipts, refunds

One `payments` table, `kind` = `payment`, `deposit` or `refund`. Each row has
amount, date, method, reference, user and notes, and its own receipt number.

- A **deposit** is recorded on an estimate or a job card before the invoice
  exists. When the invoice is created from that estimate or job card, the
  deposit is attached to it automatically and reduces the balance.
- A payment is never deleted; it is **voided** with a reason, by a user with
  permission. The receipt stays, marked void. The audit log keeps who and when.
- A payment cannot exceed the balance. Overpayment happens only when a credit
  note lowers the total after payment; the balance becomes negative and the
  screen offers a **refund**.

### Credit notes

Linked to one issued invoice. Two modes:

- **By lines**: pick invoice lines and quantities. Amounts are prorated from
  the original line, so a full credit equals the original exactly. Parts can
  be put back into stock.
- **By amount**: a goodwill reduction, entered including VAT, split into net
  and VAT with the chosen rate.

The total credited can never exceed the invoice total.

### Stock

Stock quantity lives in `stock_levels` (per part and branch) and moves only
through `stock_movements` (in, out, adjustment, inventory count, sale, sale
reversal, purchase receipt). Every movement records who, when, why and the
source document.

**Decision:** stock leaves when the **invoice is issued**, not when a part is
added to a job card. One exit point means a part is never counted twice when a
job card becomes an invoice. Cancelling an invoice or crediting parts with
"return to stock" puts them back. Stock may go below zero: blocking an invoice
because stock was not recorded would stop the garage from billing. Negative
stock appears first in the low-stock list.

### Tax (VAT)

- Rates are **data**, not code: `tax_rates` per organization. Onboarding
  proposes a standard rate that the garage confirms; it can be changed.
- If the garage is not VAT-registered, all rates are forced to 0 and
  documents are titled **Invoice** instead of **Tax Invoice**.
- The software does not claim compliance with any regulation. Tax settings
  must be checked with the garage's accountant or the tax authority.

### Money and rounding

Amounts are computed in **integer fils** (1 AED = 100 fils), never with
floating point:

1. `gross = qty × unit price`, rounded half-up to the fil.
2. `line discount = gross × line %`, rounded.
3. `net = gross − line discount`; `subtotal = Σ net`.
4. The document discount (percent or amount, capped at the subtotal) is
   allocated to lines in proportion to their net, remainders by largest
   fraction.
5. VAT is computed **per rate** on the taxable total of that rate, rounded
   once, then allocated to lines for display.
6. `total = subtotal − document discount + VAT`.

The same algorithm exists in TypeScript (`src/lib/totals.ts`, for instant
preview while typing) and in SQL (`private.calc_totals`, authoritative). A
test compares both on thousands of random documents.

## 6. Workflows

```
Customer → Vehicle → Estimate → Approved → Job Card → Repair → Invoice → Payment → Receipt → Vehicle history
```

- **Estimate → job card**: one click. Lines, customer, vehicle, mileage and
  deposits carry over.
- **Job card → invoice**: one click. Lines carry over, deposits are attached.
- **Estimate → invoice** directly, for jobs that need no job card.
- **New invoice** directly, for counter sales and quick jobs: search a
  customer (or create one inline), pick or add the vehicle, add lines, take
  payment, print. One screen.
- **Vehicle history** needs no extra entry: it is a view over estimates, job
  cards and invoices of that vehicle.

## 7. Documents

Estimate, Invoice / Tax Invoice, Payment Receipt, Refund Receipt, Credit
Note, Job Card, Inspection Report, Purchase Order.

Each document has a print route rendered in A4 with the garage branding
(name, logo, address, TRN, trade licence). Actions:

- **Print / Save as PDF**: the browser's print dialog, which saves to PDF on
  every current browser. No server PDF engine is claimed.
- **WhatsApp**: opens WhatsApp (app or web) with a prepared message to the
  customer's number. The user presses send. This is a real, working link,
  not an API integration, and is labelled as such.
- **Email**: opens the user's email app with a prepared message.

Every such action is logged in `outbound_messages` with `delivery = 'manual_link'`.
A future WhatsApp Business API adapter writes to the same table with
`delivery = 'api'` and delivery statuses from webhooks. No fake integration
exists in the product.

## 8. Internationalisation

English and Arabic. Strings are written in English in the code and wrapped in
`t()`. The Arabic dictionary maps them; a test fails if a string has no
Arabic entry. Arabic switches the document to `dir="rtl"`; layouts use
logical properties (`ms-`, `pe-`, `start-`) so they mirror correctly.
Numbers use Latin digits in both languages, as is usual for UAE business
documents. French can be added as a third dictionary.

## 9. Components (frontend)

```
src/
  routes/            file-based routes (one per screen)
  lib/               PURE modules: money, totals, plates, phone, search,
                     status, csv, i18n. No network, fully tested.
  api/               typed data access per domain (supabase-js)
  components/
    ui/              primitives: Button, Field, Dialog, Table, Badge, Empty…
    documents/       line editor shared by estimate / job card / invoice,
                     printable document layout
    pickers/         customer, vehicle, part, service search pickers
  app/               session, organization context, permissions
```

Rule borrowed from EcomPilot: **every calculation is in a pure module**, the
API layer only moves data. Every list distinguishes **loading**, **error**
and **empty**.

## 10. Testing

- `npm test` — pure modules (totals, plates, phones, search parsing, status,
  CSV, i18n coverage).
- `npm run test:db` — starts a throw-away local Postgres 16, applies a small
  Supabase compatibility layer and every migration, then runs the full
  business journey, tenant isolation and role permission checks against real
  SQL, and the TypeScript/SQL totals equivalence.
- `npm run test:e2e` — starts Postgres, PostgREST and a local auth stub, runs
  the app, and drives the full journey in a real browser at phone, tablet
  and desktop widths.

The local auth stub (`dev/`) exists only for development and tests. In
production, Supabase Auth issues the tokens.

## 11. Not built yet (deliberately)

Listed so nothing is mistaken for a working feature:

- **Photos** on inspections and job cards: needs Supabase Storage buckets and
  upload policies. The data model has room for it; the UI does not show a
  photo button.
- **Customer signature** on job cards and estimates.
- **WhatsApp Business API / SMS / email sending by the server.** Today,
  messages open in the user's own WhatsApp or email app (see §7).
- **Excel (.xlsx) files.** Import and export use CSV, which Excel opens and
  saves. PDF reports use the print dialog.
- **Restricting a user to a single branch.**
- **Server-generated PDF files** attached automatically to messages.
