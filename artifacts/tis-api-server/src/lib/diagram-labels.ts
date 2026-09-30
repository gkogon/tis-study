/**
 * The two street labels of a turning-movement diagram, from an intersection
 * name "A & B & C": the first street labels one axis and every other street
 * the other, joined with " / ". Authority names list every street at a
 * junction (CDOT's "Idlewild Rd & Monroe Rd & Rama Rd", Raleigh's "Fox Rd. &
 * Malone Ct. & Sumner Blvd."), so taking only the second part dropped the
 * third street from the diagram.
 */
export function diagramStreetLabels(name: string | null | undefined): [string, string] {
  const parts = String(name ?? "").split(/\s*&\s*/);
  return [parts[0] ?? "", parts.slice(1).join(" / ")];
}
