/**
 * UAE phone numbers. People type them in many ways: 050 123 4567,
 * +971 50 123 4567, 00971501234567, 971-50-1234567. All must match.
 */

export function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * International form without "+", as wa.me expects: 971501234567.
 * Local UAE numbers starting with 0 get the 971 prefix. Returns null when the
 * number is too short to be dialled.
 */
export function toInternational(phone: string | null | undefined): string | null {
  let d = digitsOnly(phone);
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `971${d.slice(1)}`;
  else if (d.length === 9 && d.startsWith("5")) d = `971${d}`;
  return d.length >= 8 ? d : null;
}

/**
 * Key used to search a phone number: its last 9 digits. The same key is
 * derived in SQL from the stored number (generated column `phone_key`).
 * Returns null when the query holds fewer than 7 digits (too ambiguous).
 */
export function phoneSearchKey(q: string): string | null {
  const d = digitsOnly(q);
  if (d.length < 7) return null;
  return d.slice(-9);
}

/** "+971 50 123 4567" for display; raw input when not recognisable. */
export function formatPhone(phone: string | null | undefined): string {
  const intl = toInternational(phone);
  if (!intl || !intl.startsWith("971") || intl.length !== 12) return phone ?? "";
  return `+971 ${intl.slice(3, 5)} ${intl.slice(5, 8)} ${intl.slice(8)}`;
}

export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const intl = toInternational(phone);
  if (!intl) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(email: string | null | undefined, subject: string, body: string): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
