// Shared synthetic corporate theme, factored out of verify-theme-render.mjs
// so other checks (verify-leg-volumes-render.mjs) can exercise the themed
// rendering path (report-theme, not the default PDFKit layout) without
// needing a real extracted corpus theme on disk.
//
// syntheticTheme(DEFAULT_THEME) returns the exact StoredTheme-shaped object
// verify-theme-render.mjs has always built inline as SYNTH.
export function syntheticTheme(D) {
  return {
    version: 2,
    theme: {
      ...D, id: "firm-synth",
      page: { size: "LETTER", orientation: "portrait", margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      fonts: { body: { family: "carlito", requested: "Calibri", exact: false }, heading: { family: "liberation-serif", requested: "Times New Roman", exact: false } },
      headings: [{ ...D.headings[0], style: { font: "heading", size: 15, color: "#1f3a5f", bold: true }, case: "title", numbering: "1.", rule: { color: "#1f3a5f", width: 0.75, gap: 2 } }, { ...D.headings[1], style: { font: "heading", size: 12, color: "#1f3a5f", bold: true }, numbering: "1." }, D.headings[2]],
      palette: { primary: "#1f3a5f", accent: "#c0392b", text: "#222222", muted: "#666666", rule: "#bbbbbb" },
      table: { ...D.table, header: { fill: "#1f3a5f", color: "#ffffff", bold: true, size: 9 }, rules: { color: "#bbbbbb", width: 0.5, mode: "grid" } },
      header: { segments: [{ align: "left", text: "{{firm.name}}" }, { align: "right", text: "{{documentType}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: { color: "#1f3a5f", width: 0.5 }, height: 40 },
      footer: { segments: [{ align: "center", text: "Page {{page}} of {{pages}}" }], style: { font: "body", size: 8, color: "#666666" }, rule: null, height: 40 },
      cover: { background: { kind: "none" }, bands: [{ y0: 0, y1: 120, color: "#1f3a5f" }], logo: null, elements: [{ role: "documentType", x: 72, y: 300, w: 468, align: "left", style: { font: "heading", size: 28, color: "#1f3a5f", bold: true } }, { role: "projectName", x: 72, y: 350, w: 468, align: "left", style: { font: "body", size: 16, color: "#222222" } }], hasMetaBlock: false },
      charts: { series: ["#1f3a5f", "#c0392b"] },
      // Chapter-numbered captions ("Figure 5-2: …") in the sample's caption style, above the plot.
      figure: { caption: { position: "above", style: { font: "body", size: 9, color: "#1f3a5f", bold: true } }, label: "Figure", numbering: "chapter", separator: ": " },
      synonyms: { "trip-generation": "Site Trip Generation" },
    },
    source: { pages: 10, fontsSeen: [], extractedAt: "2026-09-14T00:00:00Z", warnings: [] },
  };
}
