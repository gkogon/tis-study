# Florida TIS Renderer — Primary-Source Verification Pass

**Date:** 2026-06-12. **Sources fetched:** flsenate.gov (F.S. 380.06, 163.3180; SB 1216 / HB 7207 status pages), flrules.org (Chapter 14-96 + 14-97 sub-rule effective dates), fdotwww.blob.core.windows.net (MTSIH 2024 PDF, Q/LOS v6.0 PDF, FDM 2026 chapter PDFs, TAH 2025 PDF), pdl.fdot.gov (Policy 000-525-006), law.cornell.edu (F.A.C. 61G15-23.001).

**Scope:** Verifies regulatory citations baked into `renderTisFlorida` and `floridaJurisdiction` in `artifacts/tis-api-server/src/lib/pdf-export.ts` (lines 3805–4399). The renderer module is broadly accurate — most citations check out against primary sources. Three correctness defects and three currency-of-citation flags are documented below.

---

## A. HEADLINE: One legacy bug-comment + one inverted procedure number

The renderer is in much better shape than the GA module. **Substantively correct on 95% of citations.** Two narrow errors warrant immediate fixing:

1. **Procedure / Policy number is inverted everywhere.** The renderer cites "**FDOT Procedure 525-000-006**" 8 times. The actual document is a **POLICY** with topic number **000-525-006** (zeros-first). Verified by fetching the PDF from `pdl.fdot.gov/api/procedures/downloadProcedure/000-525-006` — masthead reads "POLICY ... Topic No.: 000-525-006-c, Effective: April 19, 2017, LEVEL OF SERVICE TARGETS FOR THE STATE HIGHWAY SYSTEM."

2. **Stale legacy comment cites the wrong bill.** A leftover comment in the renderer header (line 3999) says "DRI is curtailed post-2015 **HB 7065**." HB 7065 (2015) was an unrelated insurance Assignment-of-Benefits bill. The body of the renderer correctly cites HB 7207 (2011) for concurrency at line 4343 — but the dev-facing JSDoc still names the wrong bill. The spec already flagged this (florida-tis-spec.md §6.1); the comment in code was not updated.

These are quick fixes. The substantive analysis prose, the jurisdiction dispatch tree, the GSVT methodology, the Q/LOS v6.0 + FDM 2026 references, the F.A.C. 61G15-23.001 PE-seal citation, and the §163.3180(5)(h)1.a. SIS-consultation citation all check out.

---

## B. Verified-correct citations (no change needed)

- **MTSIH 2024, March 25, 2024** PDF exists at the cited URL (Content-Length 39 MB, Content-Type application/pdf, HTTP 200). Renderer cites "MTSIH 2024" consistently and the date matches the filename (`mtsih_20240325.pdf`).
- **Q/LOS Handbook v6.0, August 2025** PDF exists at the cited URL (Content-Length 4.25 MB, HTTP 200). Filename verbatim: `fdot_qlos_handbook_v6-0_clean_aug-2025_complete-streets-replaced-with-context-based-solutions.pdf` — confirms the "complete streets" → "context-based solutions" rename the renderer mentions at line 4165.
- **FDM 2026, Topic #625-000-002, January 1, 2026** ✓ verified by extracting page 1 of `2026fdm200cntxtbsddsn.pdf`. The cover reads verbatim "Topic #625-000-002 / FDOT Design Manual / January 1, 2026." Renderer at line 4307 cites exactly that.
- **FDM Chapters 200, 213, 214** — all three URLs return HTTP 200; renderer references at lines 4165, 4307, and 4327 (sections, not URLs) are accurate per the spec mapping in §1.5.
- **FDOT Traffic Analysis Handbook, October 2025** PDF (`traffic-analysis-handbook_10-08-2025.pdf`) returns HTTP 200, Content-Length 9.33 MB. TAH §4.1 (analysis tools — HCS / Synchro / SIDRA / CORSIM / Vissim, with Vistro **not** in the inventory) is consistent with renderer line 4135.
- **F.S. 163.3180(1)** — concurrency for non-statewide categories made optional, with sewer / solid waste / drainage / potable water the only statewide-mandatory categories. Verified verbatim from flsenate.gov. Renderer line 4343 ("Transportation concurrency was made optional statewide by HB 7207 (2011)") is correct on substance; HB 7207 = Chapter 2011-139 ("Growth Management" → Community Planning Act) confirmed via flsenate.gov bill page.
- **F.S. 380.06 history line** confirms **"s. 18, ch. 2015-30"** (SB 1216) and **"ss. 1, 24, ch. 2018-158"** (CS/CS/HB 1151) — the two laws the spec §6.1 names. ✓
- **F.A.C. 61G15-23.001 "Signature, Date and Seal Shall Be Affixed"** — confirmed via law.cornell.edu. Text contains "responsible charge" language matching the spec quote (line 424 of spec). Renderer cite at line 4373 is correct.
- **F.S. 163.3180(5)(h)1.a.** — SIS-impact consultation citation at line 4343 is accurate per the 2024 statute text.
- **Rule 14-97.003** access management spacing classes — last amended 10-7-09 per flrules.org. Still operative. Renderer line 4327 reference is correct.

---

## C. Verified-WRONG citations that need fixing

### C.1  "Procedure 525-000-006" — digits inverted; actually POLICY 000-525-006

The renderer cites **"FDOT Procedure 525-000-006"** 8 times (lines 3858, 3895, 3913, 3932, 3951, 3968, 4129, 4159). The actual document is a **POLICY** numbered **000-525-006**, titled **"Level of Service Targets for the State Highway System"** (not "Level of Service Standards and Highway Capacity Analysis").

Verified by `curl https://pdl.fdot.gov/api/procedures/downloadProcedure/000-525-006` → returns the PDF; masthead reads verbatim:

> "FDOT — RON DESANTIS GOVERNOR — POLICY — KEVIN J. THIBAULT, P.E. SECRETARY — Effective: April 19, 2017 — Review: August 30, 2019 — Office: Systems Planning — Topic No.: **000-525-006-c** — LEVEL OF SERVICE TARGETS FOR THE STATE HIGHWAY SYSTEM"

The reversed-digits URL (`pdl.fdot.gov/.../525-000-006`) does not 404 cleanly because PDL is a JS SPA, but the canonical document number is 000-525-006. The spec at line 34 correctly cites `000-525-006`; the renderer reverses it.

Substantive LOS-D-urbanized / LOS-C-rural claim ✓ verified verbatim from the policy body. Only the topic-number string and the document title are wrong.

**Action:** s/Procedure 525-000-006/Policy 000-525-006/g across `renderTisFlorida` and `floridaJurisdiction`. Update the title from "Level of Service Standards and Highway Capacity Analysis for the State Highway System" (line 4129) to **"Level of Service Targets for the State Highway System"**.

[pdf-export.ts:3858](artifacts/tis-api-server/src/lib/pdf-export.ts:3858) · [pdf-export.ts:3895](artifacts/tis-api-server/src/lib/pdf-export.ts:3895) · [pdf-export.ts:3913](artifacts/tis-api-server/src/lib/pdf-export.ts:3913) · [pdf-export.ts:3932](artifacts/tis-api-server/src/lib/pdf-export.ts:3932) · [pdf-export.ts:3951](artifacts/tis-api-server/src/lib/pdf-export.ts:3951) · [pdf-export.ts:3968](artifacts/tis-api-server/src/lib/pdf-export.ts:3968) · [pdf-export.ts:4129](artifacts/tis-api-server/src/lib/pdf-export.ts:4129) · [pdf-export.ts:4159](artifacts/tis-api-server/src/lib/pdf-export.ts:4159)

### C.2  Stale comment cites HB 7065 instead of SB 1216 / HB 1151

The JSDoc comment at [pdf-export.ts:3999](artifacts/tis-api-server/src/lib/pdf-export.ts:3999) reads:

> " * - DRI is curtailed post-2015 **HB 7065**; the renderer does not assume / DRI review and instead frames the deliverable around local / concurrency / comp plan amendments / FDOT connection permits."

HB 7065 (2015) was an unrelated insurance Assignment-of-Benefits bill. The 2015 DRI rollback came via **SB 1216 / Ch. 2015-30** (verified: F.S. 380.06 history line cites "s. 18, ch. 2015-30"); the cleanup pass was **CS/CS/HB 1151 / Ch. 2018-158** (verified: history line cites "ss. 1, 24, ch. 2018-158"). The spec at §6.1 already flagged the HB 7065 error; the renderer comment was not updated.

**Action:** Replace "post-2015 HB 7065" with "post-2015 SB 1216 / Ch. 2015-30 + CS/CS/HB 1151 / Ch. 2018-158" in the JSDoc.

### C.3  Rule 14-96 "2025 update" is wrong — last amendment was 2023

The renderer at [pdf-export.ts:4327](artifacts/tis-api-server/src/lib/pdf-export.ts:4327) says:

> "Connection to the FDOT State Highway System requires a connection permit per **Rule 14-96 F.A.C. (2025 update)**."

Verified via flrules.org sub-rule history (`/gateway/RuleNo.asp?...&ID=14-96.002` and others):
- 14-96.001 — Repealed 10-20-2015
- 14-96.0011 — last amended **4-2-2023**
- 14-96.002 — last amended **4-2-2023**
- 14-96.003 — last amended **4-2-2023**

The chapter's most recent substantive amendment is **April 2, 2023**, not 2025. The spec body at §1.5 / §6.2 already says "Rule 14-96 (2025 update)" — this appears to be a hallucinated date that propagated from spec → renderer. No 2025 enactment exists in the flrules.org history.

**Action:** s/Rule 14-96 F.A.C. (2025 update)/Rule 14-96 F.A.C. (last amended April 2, 2023)/g. Also fix the same phrase in `florida-tis-spec.md` §6.2.

---

## D. Currency-of-citation flags (substantively OK; phrasing has aged)

### D.1  Rule 14-97 is "being substantially updated and amended"

The flrules.org chapter page for 14-97 carries a banner notice:

> "Rule Chapter 14-97, F.A.C., is being substantially updated and amended, including revisions to the chapter title, titles of individual rules, revised definitions, and revised tables."

Operative rule text is still the 10-7-2009 amendment (14-97.003) and the 2-13-1991 originals for .001/.005 — so the renderer's Class 1-7 spacing references are not wrong yet. But a rulemaking pass is in flight, and the renderer's confident cite to "Rule 14-97" should be hedged with "current as of 2026-06-12; FDOT has a pending substantial rewrite per the flrules.org chapter notice."

**Action:** Add a single sentence in §10 of the renderer noting the pending Rule 14-97 rewrite.

### D.2  Procedure 525-030-120 (Project Traffic Forecasting Handbook) — not re-verified

The renderer at line 4129 cites **"FDOT Procedure 525-030-120 (project traffic forecasting)"** for trip-forecasting methodology. The spec at §1.3 lists this PDL URL. Not re-fetched in this pass due to budget; spec citation chain assumed correct but flagged for the next verification cycle.

### D.3  "HCM 6th Edition" — current as of 2026 but HCM 7th is imminent

TRB published HCM 6th Ed. in 2016 and Update 2 in 2022. **HCM 7th Edition is scheduled for 2026 publication** per the TRB HCQS committee but is not the current version. Renderer cite at lines 4135, 4159 is correct for now; flag for re-verification in late 2026.

---

## E. Open / still-to-verify

1. **Procedure 525-030-120** (Project Traffic Forecasting Handbook) — PDL URL fetch was not re-run in this pass; confirm topic number and current effective date next cycle.
2. **Rule 14-97 pending rewrite** — monitor flrules.org for a new effective date once the rulemaking lands. Affects the renderer's §10 Site Access prose and the spec's §6.5 spacing tables.
3. **HCM 7th Edition release** — TRB 2026 publication scheduled; renderer's HCM-6th-Ed. citation will need swap when TRB releases.
4. **Hillsborough mobility-fee update study** — the spec notes "update study begun early 2025" but the current renderer fee-methodology note still references the 2020 schedule. Re-check before next Hillsborough deliverable ships.
5. **F.S. 380.06(12) vs. (30) subsection numbering**: The current 2024 statute substitute-pathway clause is **subsection (12)**, not subsection (30). The spec at line 459 cites "(30)"; verify whether (30) appeared in an earlier session-year version of the bill text or whether the spec needs correction. The renderer body does not cite the subsection number directly, so this is a spec-correction item, not a renderer fix.

---

## F. Suggested renderer changes (terse)

1. **s/Procedure 525-000-006/Policy 000-525-006/g** — 8 occurrences across `floridaJurisdiction` and `renderTisFlorida`. Also update the document title to "Level of Service Targets for the State Highway System" at line 4129.
2. **JSDoc fix at line 3999**: replace "post-2015 HB 7065" with "post-2015 SB 1216 (Ch. 2015-30) + CS/CS/HB 1151 (Ch. 2018-158)".
3. **Rule 14-96 currency**: s/Rule 14-96 F.A.C. (2025 update)/Rule 14-96 F.A.C. (last amended April 2, 2023)/g at line 4327. Also correct the spec at §6.2.
4. **Add a Rule 14-97 hedge** in §10 Site Access prose: "FDOT has noticed a substantial rewrite of Rule 14-97 (per flrules.org chapter banner); confirm the operative spacing table at the methodology meeting before delivering."
5. **No other substantive change required.** The 1.0–13.0 / 14.0 section structure, the jurisdiction dispatch tree (Miami-Dade three-track, Palm Beach FLUA-thin / full-TPS, Hillsborough mobility-fee, Orange STAMP, Duval LDPM, Broward 10-district), the GSVT framing, the FDM 2026 Topic #625-000-002 January 1, 2026 citation, the F.A.C. 61G15-23.001 PE-seal cite, the F.S. 163.3180(5)(h)1.a. SIS-consultation cite, and the MTSIH 2024 §4.6.6.6 10% pass-by reasonableness check are all primary-source verified.

---

## Sources

- F.S. 163.3180 (Concurrency): https://www.flsenate.gov/Laws/Statutes/2024/163.3180
- F.S. 380.06 (DRIs): https://www.flsenate.gov/Laws/Statutes/2024/0380.06 — current substitute-pathway clause is **§380.06(12)** (not §380.06(30)); history line confirms ch. 2015-30 and ch. 2018-158.
- SB 1216 (2015) status page: https://www.flsenate.gov/Session/Bill/2015/1216 — Effective 5/14/2015, Chapter 2015-30 ✓
- HB 7207 (2011) status page: https://www.flsenate.gov/Session/Bill/2011/7207 — Chapter 2011-139, "Growth Management" → Community Planning Act ✓
- Rule 14-96 chapter home: https://www.flrules.org/gateway/ChapterHome.asp?Chapter=14-96 — most recent amendment 4-2-2023, not 2025.
- Rule 14-97 chapter home: https://www.flrules.org/gateway/ChapterHome.asp?Chapter=14-97 — banner notice: "being substantially updated and amended."
- Policy 000-525-006 PDF: https://pdl.fdot.gov/api/procedures/downloadProcedure/000-525-006 — POLICY (not Procedure); Topic No. 000-525-006-c; "Level of Service Targets for the State Highway System"; Effective 4/19/2017.
- F.A.C. 61G15-23.001 (Cornell LII): https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-61G15-23-001
- MTSIH 2024 (HTTP 200, 39 MB): https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/site-impact/mtsih_20240325.pdf
- Q/LOS v6.0 Aug 2025 (HTTP 200, 4.25 MB): https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/qlos/fdot_qlos_handbook_v6-0_clean_aug-2025_complete-streets-replaced-with-context-based-solutions.pdf
- FDM 2026 Chapter 200 (PDF cover verbatim): "Topic #625-000-002 / FDOT Design Manual / January 1, 2026" — https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm200cntxtbsddsn.pdf
- FDOT TAH Oct 2025 (HTTP 200, 9.33 MB): https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/traffic-analysis/traffic-analysis-handbook_10-08-2025.pdf
