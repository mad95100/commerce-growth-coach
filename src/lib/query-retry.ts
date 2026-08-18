/**
 * QUAND REDEMANDER, ET QUAND S'ARRÊTER.
 *
 * Fonctions pures, à part du routeur, pour qu'elles soient TESTABLES : la
 * politique de nouvel essai décide combien de temps un marchand regarde une page
 * qui ne dit rien, et c'est trop important pour vivre dans une lambda anonyme
 * qu'aucun contrôle ne peut atteindre.
 */

/**
 * Codes qui ne changeront pas si l'on redemande.
 *
 * 400 la requête est malformée · 401 la session est finie · 403 la politique
 * d'accès refuse · 404 la ressource n'existe pas · 406 PostgREST n'a pas trouvé
 * la ligne unique demandée · 409 le conflit est réel · 422 les données sont
 * refusées.
 *
 * Aucun de ces cas ne s'arrange en une seconde. Les rejouer n'ajoute que du
 * silence à un échec déjà connu.
 *
 * 408 (délai dépassé) et 429 (trop de demandes) sont volontairement ABSENTS :
 * ce sont des refus temporaires, et redemander est exactement la bonne réponse.
 */
const CODES_DEFINITIFS = new Set([400, 401, 403, 404, 406, 409, 422]);

/**
 * Le code HTTP porté par une erreur, quelle que soit la bibliothèque qui l'a
 * levée.
 *
 * Supabase pose `status`, certains clients posent `statusCode`, d'autres
 * enveloppent une `Response`. On lit ce qui est présent plutôt que d'imposer une
 * forme — une erreur dont on ne sait rien ne doit pas être classée par défaut
 * dans la catégorie qui empêche de réessayer.
 */
export function codeHttp(erreur: unknown): number | null {
  if (!erreur || typeof erreur !== "object") return null;
  const e = erreur as Record<string, unknown>;

  for (const clé of ["status", "statusCode", "code"] as const) {
    const brut = e[clé];
    const n = typeof brut === "string" ? Number(brut) : brut;
    // `code` de PostgREST est souvent un identifiant textuel (« PGRST116 ») :
    // `Number` en fait `NaN`, et le contrôle ci-dessous l'écarte.
    if (typeof n === "number" && Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }

  const réponse = e.response;
  if (réponse && typeof réponse === "object") {
    const s = (réponse as Record<string, unknown>).status;
    if (typeof s === "number" && Number.isInteger(s) && s >= 100 && s <= 599) return s;
  }

  return null;
}

/**
 * Vrai quand redemander ne peut rien changer.
 *
 * UNE ERREUR INCONNUE EST TRAITÉE COMME PASSAGÈRE. C'est le choix prudent : une
 * coupure réseau ne porte aucun code, et c'est précisément le cas où un nouvel
 * essai est utile. Se tromper dans ce sens coûte une seconde ; se tromper dans
 * l'autre priverait le produit de sa tolérance aux vraies intermittences.
 */
export function estDefinitive(erreur: unknown): boolean {
  const code = codeHttp(erreur);
  return code !== null && CODES_DEFINITIFS.has(code);
}

/**
 * Délai avant le nouvel essai, en millisecondes.
 *
 * Croissance exponentielle depuis 400 ms, PLAFONNÉE à 2 s. Le défaut de la
 * bibliothèque monte jusqu'à trente secondes : sur un écran que le marchand
 * regarde, une attente pareille est indiscernable d'une panne.
 */
export function delaiAvantNouvelEssai(nombreEchecs: number): number {
  return Math.min(400 * 2 ** nombreEchecs, 2000);
}
