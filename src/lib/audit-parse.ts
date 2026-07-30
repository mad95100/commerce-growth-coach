// Extrait le premier bloc JSON d'un texte libre renvoyé par le modèle.
export function extractJsonBlock(text: string): string | undefined {
  if (!text) return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  const slice = candidate.slice(start, end + 1);
  try {
    JSON.parse(slice);
    return slice;
  } catch {
    return undefined;
  }
}
