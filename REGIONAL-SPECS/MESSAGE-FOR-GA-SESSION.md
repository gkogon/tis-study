# Message for the GA renderTisGeorgia session

(send_message tool is blocked in auto-mode — paste this into the GA session when convenient. Source: parallel session that ran the primary-source verification pass against rules.sos.ga.gov, the SRTA HB 297 page, and the GTEA/ATL page on 2026-06-12.)

---

Primary-source verification pass on the GA DRI module — three headline findings worth picking up before you ship §11-§13:

1. **GRTA was dissolved by HB 297, signed 2026-05-12** (30 days ago). Successor is the **Georgia Transportation Efficiency Authority (GTEA)** — formed by recasting the ATL. DRI review function transfers wholesale; in-process DRIs grandfathered; GRTA Xpress fleet folded into GTEA. The current renderer references "GRTA" ~12× and needs a GTEA rename with a transition note. Sources: srta.ga.gov/grta/ + atltransit.ga.gov.

2. **The "eight non-expedited review criteria" citation is wrong.** Renderer says (pdf-export.ts:3210) "Per GA DCA Chapter 110-12-3, DRI submittals must address the eight non-expedited review criteria below." Chapter 110-12-3 has 7 rules (.01–.07) and **does not articulate any "eight non-expedited review criteria"** — verified directly against rules.sos.ga.gov/gac/110-12-3. The 8 criteria live in a GRTA (now GTEA) **DRI Review Procedures** document, not a DCA rule. Same provenance for the "6-mile AOI" (pdf-export.ts:3305) and the "7-percent rule" (pdf-export.ts:723) — neither is in DCA rules; both are procedures-document figures.

3. **For ARC-region DRIs the controlling chapter is 110-12-7, not 110-12-3.** Renderer doesn't mention it. Chapter 110-12-7 (Alternative Requirements: Atlanta Regional Commission) identifies **three expedited-eligibility categories** instead of non-expedited criteria: (a) Livable Centers Initiative, (b) Transit-Oriented Development, (c) projects <1,000 daily trips. Verified at rules.sos.ga.gov/gac/110-12-7.

Verified-correct (no change): O.C.G.A. § 50-8-7.1(b) authorizing statute; 30-day Regional Commission review window (Rule 110-12-3-.02); Rule 110-12-3-.05(1)(a) threshold table.

Both DCA chapters still reference "GRTA" verbatim as of today — rules haven't been amended for HB 297 yet. Honest renderer phrasing: "GRTA (now GTEA per HB 297, 2026-05-12; DCA rule text not yet amended)."

Full deliverable with verbatim quotes, file:line callouts, suggested renderer changes, and open follow-ups: `REGIONAL-SPECS/georgia-dri-deep-dive.md` (in your worktree).

Still open and could use your eyes: locating the current GRTA/GTEA DRI Review Procedures PDF; verbatim GTEA name in HB 297 bill text on legis.ga.gov; current status of ARC's Air Quality Benchmark rubric; ARC's 1.3–1.7 jobs/housing target source. The deep-dive doc lists these in §D.
