/**
 * Applied trip-generation rate rows — shared by every regional renderer.
 *
 * "Does rate × size equal the trips you claim?" is the first check a reviewing
 * PE performs. The report used to print the trip TOTALS and a provenance TAG
 * ("Public data — SANDAG 2002 …") while never printing the rate itself, which
 * made that check impossible from the PDF alone. A reviewer who cannot
 * reproduce the arithmetic reads the output as inaccurate, even when the
 * numbers are right — so this is an auditability fix, not a numbers fix.
 *
 * Lives in its own leaf module because both pdf-export.ts and its sibling
 * pdf-export-carolinas.ts need it, and pdf-export.ts already imports the
 * Carolinas renderers (importing back the other way would close a cycle).
 *
 * Nothing here changes a computed value. Rendering only.
 */

/** Row shape the `rows()` / `carRows()` table helpers consume. */
export type LabelledRow = [string, string];

/**
 * Build the "rate applied" rows for a trip-generation payload.
 *
 * Returns an EMPTY array when the payload carries no rates. Studies stored
 * before `dailyRate`/`amRate`/`pmRate`/`variableSource` shipped re-render
 * through this same path (`/projects/:id/pdf`), and must stay byte-identical
 * rather than sprouting blank or "—" rows.
 */
export function appliedRateRows(tg: any): LabelledRow[] {
  const rows: LabelledRow[] = [];
  const unit = tg?.unitShort ?? tg?.unit ?? "unit";
  const size = Number(tg?.size);
  const sizeLabel = Number.isFinite(size) ? `${trimNum(size)} ${unit}` : null;

  const add = (label: string, rate: unknown) => {
    const n = Number(rate);
    if (!Number.isFinite(n)) return;
    rows.push([
      label,
      sizeLabel
        ? `${n.toFixed(2)} trips per ${unit} × ${sizeLabel}`
        : `${n.toFixed(2)} trips per ${unit}`,
    ]);
  };

  add("Daily rate applied", tg?.dailyRate);
  add("AM peak rate applied", tg?.amRate);
  add("PM peak rate applied", tg?.pmRate);

  const src = typeof tg?.variableSource === "string" ? tg.variableSource.trim() : "";
  if (src) rows.push(["Rate source", src]);

  return rows;
}

/** Compact number for the size label: 280 not 280.00, 4.5 stays 4.5. */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
