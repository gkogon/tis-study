/**
 * Numbered, hairline-ruled section header — the recurring motif that
 * makes the marketing pages read like a TIS report (§01, §02…) rather
 * than a stack of identical SaaS modules. Left aligned, mono, restrained.
 */
export function Marker({
  n, label, accent = "blue",
}: {
  n: string;
  label: string;
  /** `amber` for dark grounds — blue-700 sits under 3:1 on near-black. */
  accent?: "blue" | "amber";
}) {
  return (
    <div className="flex items-baseline gap-3 mb-7">
      <span className={`font-mono text-xs tabular-nums font-semibold ${accent === "amber" ? "text-amber-400" : "text-blue-700"}`}>
        §{n}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <span aria-hidden className="flex-1 h-px bg-border" />
    </div>
  );
}

/**
 * The LOS A–F color scale as a thin strip — the traffic engineer's
 * native color language (HCM Exhibit 19-8). Used as a brand motif on
 * section edges and dark bands.
 */
export function LosScaleStrip() {
  const colors = [
    "bg-green-500", "bg-green-500", "bg-amber-400",
    "bg-amber-500", "bg-red-500", "bg-red-600",
  ];
  return (
    <div className="flex items-stretch h-1.5 w-full" aria-hidden>
      {colors.map((c, i) => <div key={i} className={`flex-1 ${c}`} />)}
    </div>
  );
}
