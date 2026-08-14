/**
 * Normalisation d'un domaine de boutique Shopify.
 *
 * Module pur, sans dépendance : il vivait dans le fichier des fonctions
 * serveur, ce qui obligeait à charger le middleware d'authentification et le
 * client Supabase pour tester une simple transformation de chaîne.
 */

export function normalizeShop(shopInput: string): string {
  const cleaned = shopInput
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");

  // L'adresse que l'utilisateur a sous les yeux dans l'admin Shopify moderne est
  // `admin.shopify.com/store/<handle>`. La coller renvoyait « Domaine Shopify
  // invalide » sans dire quoi saisir à la place : on en extrait le handle.
  const adminUrl = cleaned.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (adminUrl) return `${adminUrl[1]}.myshopify.com`;

  const raw = cleaned.replace(/\/.*$/, "");
  if (raw.endsWith(".myshopify.com")) return raw;
  // Accept plain handle (e.g. "myshop") and turn into myshop.myshopify.com
  if (/^[a-z0-9][a-z0-9-]*$/.test(raw)) return `${raw}.myshopify.com`;
  throw new Error(
    `Domaine Shopify non reconnu : « ${shopInput.trim()} ». Attendu : monshop.myshopify.com, le nom court monshop, ou l'adresse admin.shopify.com/store/monshop.`,
  );
}
