import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Vérification du paramètre `hmac` que Shopify joint à chaque requête OAuth.
 *
 * Sans elle, le seul élément qui authentifie un retour d'autorisation est notre
 * `state` signé. Shopify exige cette vérification et la refuser est bloquant
 * pour une validation d'app.
 *
 * Procédure documentée par Shopify (« Implement authorization code grant
 * manually », étape « Verify the installation request ») :
 *  1. retirer `hmac` de la chaîne de requête — et `signature`, sa forme héritée ;
 *  2. trier les paramètres restants par ordre alphabétique, sous la forme
 *     `nom=valeur` ;
 *  3. les joindre par `&` ;
 *  4. calculer un HMAC-SHA256 de ce message avec le client secret de l'app ;
 *  5. comparer le résultat hexadécimal à la valeur de `hmac`.
 *
 * La documentation précise que la liste des paramètres peut évoluer : on ne
 * code donc aucun nom en dur, on traite ce qui arrive.
 *
 * POURQUOI DEUX CANONICALISATIONS. La documentation ne tranche pas si le
 * message est construit sur les valeurs décodées ou sur leur forme
 * percent-encodée. Le cas concret est `host`, encodé en base64 : son
 * remplissage `=` voyage en `%3D`. Nous n'avons aucun vecteur de test
 * reproductible — l'exemple publié par Shopify contient un gabarit `{shop}` —
 * ni la possibilité d'observer un vrai retour d'autorisation depuis cet
 * environnement. Se tromper de forme rejetterait *toutes* les connexions, de
 * façon définitive et sans diagnostic possible pour l'utilisateur.
 *
 * On accepte donc la signature si elle correspond à l'une des deux formes. La
 * propriété de sécurité est intacte : sans le client secret, produire un
 * digest valide pour l'une ou l'autre reste infaisable. Deux cibles au lieu
 * d'une ne change rien à cette impossibilité.
 */

/** Forme d'un nom d'hôte de boutique, telle que Shopify la spécifie. */
const SHOP_HOSTNAME = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Un digest SHA-256 en hexadécimal : 64 caractères. */
const HEX_DIGEST = /^[0-9a-f]{64}$/i;

/**
 * Vérifie que `shop` est bien un nom d'hôte de boutique Shopify.
 * Contrôle exigé par Shopify : ce paramètre sert à construire des URL d'API.
 */
export function isValidShopHostname(shop: string): boolean {
  return SHOP_HOSTNAME.test(shop.trim().toLowerCase());
}

/** Comparaison à temps constant d'un digest attendu et d'une valeur hexadécimale reçue. */
function matchesDigest(expected: Buffer, receivedHex: string): boolean {
  if (!HEX_DIGEST.test(receivedHex)) return false;
  const received = Buffer.from(receivedHex, "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

function sign(message: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(message, "utf8").digest();
}

/**
 * `true` si la requête est authentiquement signée par Shopify.
 *
 * @param search chaîne de requête, ou `URLSearchParams` déjà analysée
 * @param secret client secret de l'app Shopify
 */
export function verifyShopifyHmac(search: URLSearchParams | string, secret: string): boolean {
  if (!secret) return false;

  const params = new URLSearchParams(search);
  const received = params.get("hmac");
  if (!received) return false;

  params.delete("hmac");
  params.delete("signature");

  const entries = [...params.entries()];
  if (entries.length === 0) return false;

  const decoded = entries
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
  const encoded = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");

  // Les deux messages coïncident dès qu'aucune valeur n'a besoin d'être encodée,
  // ce qui est le cas courant : on ne signe alors qu'une fois.
  if (matchesDigest(sign(decoded, secret), received)) return true;
  return decoded !== encoded && matchesDigest(sign(encoded, secret), received);
}
