// Two synthetic "firm sample" TIS PDFs with known styling, for scanner and
// extractor checks. Every number here is asserted by verify-theme-scan.mjs.
import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const F = (fam, style) => path.resolve(here, "../../data/fonts", fam, `${style}.ttf`);

export const STYLES = {
  "blue-sans": { body: ["carlito", 11, "#222222"], heading: ["carlito", 16, "#1f4e79"], h2: ["carlito", 13, "#1f4e79"], margins: { top: 72, bottom: 72, left: 72, right: 72 }, size: "LETTER", tableHeaderFill: "#1f4e79", tableHeaderText: "#ffffff", rule: "#9dc3e6", h1Rule: true, numbering: "1.", footerText: "Page {n} of {N}", headerText: "Acme Traffic Engineering | Traffic Impact Study", band: "#1f4e79" },
  "serif-black": { body: ["liberation-serif", 12, "#000000"], heading: ["liberation-serif", 14, "#000000"], h2: ["liberation-serif", 12, "#000000"], margins: { top: 54, bottom: 54, left: 90, right: 90 }, size: "A4", tableHeaderFill: "#d9d9d9", tableHeaderText: "#000000", rule: "#000000", h1Rule: false, numbering: "1.0", footerText: "Riverside Consulting  -  {n}", headerText: null, band: null },
};

export async function makeSyntheticTis(styleName) {
  const s = STYLES[styleName];
  const doc = new PDFDocument({ size: s.size, margins: s.margins, bufferPages: true, compress: true });
  doc.registerFont("body", F(s.body[0], "Regular")); doc.registerFont("bold", F(s.body[0], "Bold"));
  doc.registerFont("h", F(s.heading[0], "Bold"));
  const chunks = []; doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width, H = doc.page.height, L = s.margins.left, R = W - s.margins.right;

  // Cover
  if (s.band) doc.rect(0, 0, W, 140).fill(s.band);
  doc.font("h").fontSize(30).fillColor(s.band ? "#ffffff" : s.heading[2]).text("TRAFFIC IMPACT STUDY", L, 60, { width: R - L });
  doc.font("body").fontSize(18).fillColor(s.body[2]).text("Maple Grove Mixed-Use Development", L, 300, { width: R - L });
  doc.font("body").fontSize(12).fillColor(s.body[2]).text("Prepared for: Maple Grove Partners LLC", L, 420).text("Prepared by: Acme Traffic Engineering", L, 440).text("March 2025", L, 460);

  const h1 = (n, t) => { doc.font("h").fontSize(s.heading[1]).fillColor(s.heading[2]).text(s.numbering === "1." ? `${n}. ${t}` : `${n}.0 ${t.toUpperCase()}`, L, doc.y, { width: R - L }); if (s.h1Rule) { const y = doc.y + 2; doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(s.heading[2]).stroke(); doc.y = y + 8; } else doc.y += 6; };
  const h2 = (n, t) => { doc.font("h").fontSize(s.h2[1]).fillColor(s.h2[2]).text(`${n} ${t}`, L, doc.y, { width: R - L }); doc.y += 4; };
  const para = () => { doc.font("body").fontSize(s.body[1]).fillColor(s.body[2]).text("The proposed development is expected to generate new vehicle trips during the weekday AM and PM peak hours. This section describes the methodology and the data used to estimate those trips, and summarises the resulting operations at each study intersection under existing and future conditions.", L, doc.y, { width: R - L, paragraphGap: 8 }); };
  const table = (caption) => {
    doc.font("bold").fontSize(s.body[1] - 1).fillColor(s.body[2]).text(caption, L, doc.y); doc.y += 4;
    const cols = [200, 100, 100], x0 = L, rowH = 18; let y = doc.y; const tw = cols.reduce((a, b) => a + b, 0);
    doc.rect(x0, y, tw, rowH).fill(s.tableHeaderFill);
    doc.font("bold").fontSize(9).fillColor(s.tableHeaderText); let x = x0; ["Intersection", "AM LOS", "PM LOS"].forEach((h, i) => { doc.text(h, x + 4, y + 5, { width: cols[i] - 8 }); x += cols[i]; });
    y += rowH;
    for (const row of [["Main St & 1st Ave", "B", "C"], ["Main St & 2nd Ave", "C", "D"], ["Oak Rd & Main St", "B", "B"]]) {
      doc.font("body").fontSize(9).fillColor(s.body[2]); x = x0; row.forEach((c, i) => { doc.text(c, x + 4, y + 5, { width: cols[i] - 8 }); x += cols[i]; });
      y += rowH; doc.moveTo(x0, y).lineTo(x0 + tw, y).lineWidth(0.5).strokeColor(s.rule).stroke();
    }
    doc.y = y + 10;
  };
  const chapters = [["Introduction", ["Project Description", "Study Area"]], ["Existing Conditions", ["Roadway Network", "Traffic Volumes"]], ["Trip Generation", ["Trip Generation Rates", "Pass-by Trips"]], ["Capacity Analysis", ["Level of Service", "Queuing"]], ["Conclusions and Recommendations", []]];
  chapters.forEach(([title, subs], i) => {
    doc.addPage(); h1(i + 1, title); para();
    subs.forEach((st, j) => { h2(`${i + 1}.${j + 1}`, st); para(); });
    if (i === 1 || i === 3) table(`Table ${i + 1}-1: Intersection Level of Service`);
  });
  // Running header/footer on interior pages
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    if (s.headerText) { doc.font("body").fontSize(8).fillColor("#666666").text(s.headerText, L, 30, { width: R - L, align: "right", lineBreak: false }); doc.moveTo(L, 44).lineTo(R, 44).lineWidth(0.5).strokeColor(s.heading[2]).stroke(); }
    doc.font("body").fontSize(8).fillColor("#666666").text(s.footerText.replace("{n}", String(i)).replace("{N}", String(range.count - 1)), L, H - 40, { width: R - L, align: "center", lineBreak: false });
    doc.page.margins.bottom = saved;
  }
  doc.end();
  return done;
}
