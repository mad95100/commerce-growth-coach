/**
 * L'ANNEAU DE SCORE, Y COMPRIS QUAND IL N'Y A PAS DE SCORE.
 *
 * LE DÉFAUT QUE CE COMPOSANT DOIT RENDRE IMPOSSIBLE. La page de rapport
 * passait `audit.score ?? 0` : une boutique dont on n'avait pas pu noter assez
 * d'axes s'affichait donc **0/100, en rouge** — le verdict le plus dur du
 * produit, rendu sur un sujet dont nous n'avions rien dit. C'est l'exacte
 * symétrie de « Conversion 100/100 » : là on flattait le vide, ici on le
 * condamne. Les deux viennent du même geste, remplacer une absence par un
 * nombre.
 *
 * Le composant accepte donc `null` et le montre pour ce qu'il est : un anneau
 * neutre, sans arc rempli, et « non noté » à la place du chiffre. Un lecteur
 * qui verrait un zéro rouge en tirerait une conclusion ; devant « non noté »,
 * il cherche pourquoi — et le rapport le lui dit juste à côté.
 */
export function ScoreRing({ score, size = 128 }: { score: number | null; size?: number }) {
  const stroke = size < 80 ? 6 : 10;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const noté = score !== null && Number.isFinite(score);
  const clamped = noté ? Math.max(0, Math.min(100, score)) : 0;
  const offset = circ - (clamped / 100) * circ;
  /*
    LES COULEURS VIENNENT DU THÈME, PLUS DU FICHIER.

    Elles étaient écrites en dur pour un fond sombre : un ambre à 0.78 de
    clarté, un vert à 0.78, et surtout une piste `oklch(1 0 0 / 0.1)` — du
    BLANC translucide, invisible sur du papier. Sur fond clair, l'anneau
    n'avait donc plus de piste, et son arc criait plus fort que le montant
    récupérable, qui est pourtant le sujet de la carte.

    Elles reprennent les jetons sémantiques : la sévérité s'y lit de la même
    façon que partout ailleurs dans le produit, et un changement de palette
    n'oublie plus ce composant.
  */
  const color = !noté
    ? "var(--color-border)"
    : clamped < 40
      ? "var(--color-destructive)"
      : clamped < 70
        ? "var(--color-warning)"
        : "var(--color-success)";
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--color-secondary)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={noté ? offset : circ}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 800ms ease" }}
        />
      </svg>
      <div className="absolute text-center">
        {noté ? (
          <>
            <div className="font-display font-bold leading-none" style={{ fontSize: size / 3.5 }}>
              {clamped}
            </div>
            {size >= 96 && (
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                /100
              </div>
            )}
          </>
        ) : (
          <div
            className="px-1 font-medium uppercase leading-tight tracking-wide text-muted-foreground"
            style={{ fontSize: Math.max(9, size / 12) }}
          >
            non noté
          </div>
        )}
      </div>
    </div>
  );
}
