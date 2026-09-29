/**
 * Document totals: lines, discounts and VAT.
 *
 * THIS ALGORITHM EXISTS TWICE: here (instant preview while typing) and in SQL
 * (`private.calc_totals`, which is authoritative and stored). A database test
 * compares the two on thousands of random documents. Change both or neither.
 *
 * Everything is computed in integer fils with BigInt. Rounding is half-up
 * (all operands are non-negative). Steps:
 *   1. gross     = qty × unit price
 *   2. line disc = gross × line %
 *   3. net       = gross − line disc;          subtotal = Σ net
 *   4. doc disc  = subtotal × % | min(amount, subtotal), allocated to lines in
 *                  proportion to net (largest remainder, ties → earlier line)
 *   5. taxable   = net − allocated doc disc
 *   6. VAT per rate on Σ taxable of that rate, rounded once, then allocated to
 *      the lines of that rate the same way
 *   7. total     = subtotal − doc disc + VAT
 */

export type DiscountType = "percent" | "amount" | null;

export interface LineInput {
  quantity: number; // > 0, at most 2 decimals (hours for labor)
  unitPrice: number; // AED, >= 0, at most 2 decimals
  discountPct: number; // 0..100, at most 2 decimals
  taxRate: number; // percent, e.g. 5
}

export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
  docDiscount: number;
  taxable: number;
  vat: number;
  total: number;
}

export interface VatGroup {
  rate: number;
  taxable: number;
  vat: number;
}

export interface Totals {
  lines: LineAmounts[];
  gross: number;
  lineDiscounts: number;
  subtotal: number;
  docDiscount: number;
  taxable: number;
  vatTotal: number;
  total: number;
  vatBreakdown: VatGroup[];
}

const b = BigInt;

function roundDiv(a: bigint, d: bigint): bigint {
  // Half-up for non-negative operands.
  return (2n * a + d) / (2n * d);
}

function scaled(value: number, factor: number): bigint {
  return b(Math.round(value * factor));
}

/**
 * Splits `amount` across `weights` proportionally. The parts always sum to
 * `amount` exactly. Leftover fils go to the largest fractional remainders;
 * ties go to the earlier line so the result is deterministic.
 */
export function allocate(amount: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum === 0n || amount === 0n) return weights.map(() => 0n);
  const base = weights.map((w) => (amount * w) / sum);
  const rems = weights.map((w, i) => ({ i, r: (amount * w) % sum }));
  let left = amount - base.reduce((s, x) => s + x, 0n);
  rems.sort((x, y) => (x.r === y.r ? x.i - y.i : x.r > y.r ? -1 : 1));
  for (const { i } of rems) {
    if (left <= 0n) break;
    base[i] += 1n;
    left -= 1n;
  }
  return base;
}

export function computeTotals(
  lines: LineInput[],
  discountType: DiscountType = null,
  discountValue = 0,
  options: { vatRegistered?: boolean } = {},
): Totals {
  const vatRegistered = options.vatRegistered ?? true;
  const rows = lines.map((l) => {
    const qtyC = scaled(Math.max(0, l.quantity), 100);
    const price = scaled(Math.max(0, l.unitPrice), 100);
    const dbp = scaled(Math.min(100, Math.max(0, l.discountPct || 0)), 100);
    const gross = roundDiv(qtyC * price, 100n);
    const discount = roundDiv(gross * dbp, 10000n);
    const rateBp = vatRegistered ? scaled(Math.max(0, l.taxRate || 0), 100) : 0n;
    return { gross, discount, net: gross - discount, rateBp };
  });

  const subtotal = rows.reduce((s, r) => s + r.net, 0n);
  let docDiscount = 0n;
  if (discountType === "percent") {
    const pbp = scaled(Math.min(100, Math.max(0, discountValue || 0)), 100);
    docDiscount = roundDiv(subtotal * pbp, 10000n);
  } else if (discountType === "amount") {
    const amt = scaled(Math.max(0, discountValue || 0), 100);
    docDiscount = amt < subtotal ? amt : subtotal;
  }

  const alloc = allocate(
    docDiscount,
    rows.map((r) => r.net),
  );
  const taxable = rows.map((r, i) => r.net - alloc[i]);
  const vat = rows.map(() => 0n);

  const groupOrder: bigint[] = [];
  for (const r of rows) if (!groupOrder.includes(r.rateBp)) groupOrder.push(r.rateBp);
  const vatBreakdown: VatGroup[] = [];
  for (const rate of groupOrder) {
    const idx = rows.map((r, i) => (r.rateBp === rate ? i : -1)).filter((i) => i >= 0);
    const groupTaxable = idx.reduce((s, i) => s + taxable[i], 0n);
    const groupVat = roundDiv(groupTaxable * rate, 10000n);
    const parts = allocate(
      groupVat,
      idx.map((i) => taxable[i]),
    );
    idx.forEach((i, k) => (vat[i] = parts[k]));
    vatBreakdown.push({
      rate: Number(rate) / 100,
      taxable: Number(groupTaxable) / 100,
      vat: Number(groupVat) / 100,
    });
  }

  const vatTotal = vat.reduce((s, v) => s + v, 0n);
  const f = (x: bigint) => Number(x) / 100;
  return {
    lines: rows.map((r, i) => ({
      gross: f(r.gross),
      discount: f(r.discount),
      net: f(r.net),
      docDiscount: f(alloc[i]),
      taxable: f(taxable[i]),
      vat: f(vat[i]),
      total: f(taxable[i] + vat[i]),
    })),
    gross: f(rows.reduce((s, r) => s + r.gross, 0n)),
    lineDiscounts: f(rows.reduce((s, r) => s + r.discount, 0n)),
    subtotal: f(subtotal),
    docDiscount: f(docDiscount),
    taxable: f(subtotal - docDiscount),
    vatTotal: f(vatTotal),
    total: f(subtotal - docDiscount + vatTotal),
    vatBreakdown,
  };
}

/**
 * Balance of an invoice. Positive: the customer owes the garage. Negative: the
 * garage owes the customer (a credit note after payment) — a refund is due.
 */
export function invoiceBalance(p: {
  total: number;
  credited: number;
  paid: number; // payments + deposits, not voided
  refunded: number;
}): number {
  const fils = (x: number) => Math.round(x * 100);
  return (fils(p.total) - fils(p.credited) - fils(p.paid) + fils(p.refunded)) / 100;
}
