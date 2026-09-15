# Public TIS corpus

PDFs are downloaded by `node ./scripts/fetch-tis-corpus.mjs` and are gitignored — nothing copyrighted is committed. Each row is a publicly posted filing on a municipal or county planning portal (a development-review or council/board agenda attachment).

| name | url | firm | jurisdiction | why chosen |
|---|---|---|---|---|
| twisp-wa-2023 | https://cms5.revize.com/revize/twispwa/Traffic%20Impact%20Analysis%202023-0411.pdf | SCJ Alliance | Town of Twisp, WA | Word/Calibri 11 body, grey Segoe UI headings ("1" numbering), edge-bleeding gradient cover image over the upper 60 % of the page, rule-only zebra tables with no header fill, header with doc type/project (no page), footer "Firm  Date · Page N" |
| stafford-va-2024 | https://cdn.staffordcountyva.gov/Planning%20and%20Zoning/Development%20Review%20Meetings-Applications/2024%20April/Buc'ees%20of%20Stafford/3%20Traffic%20Impact%20Analysis%20Report.pdf | Kimley-Horn | Stafford County, VA | AcroPlot/Arial 10 body, white headings on crimson bands ("1." numbering), plain cover with colour bands, grid tables with crimson header fill drawn as 0.48 pt filled rects, footer page number in a crimson block, no running header |
| fairfax-va-2025 | https://www.fairfaxva.gov/files/assets/city/v/1/development/documents/projects/davies-property/may-2025-transportation-impact-study.pdf | Gorove Slade | City of Fairfax, VA | Word/Arial 10 body, green headings, plain cover, page number in the HEADER ("Page N" right) with a header rule, footer carries address/website only, tables ruled |
| mansfield-ct-2021 | https://mansfield.civicweb.net/document/30394/10_Traffic%20Impact%20Study.pdf?handle=BD0D29DFACA8477BB45D351B8D0E08C8 | McMahon Associates | Town of Mansfield, CT | Distiller/Palatino Linotype 11 serif body, black bold headings (no numbering), rule-only tables with no header fill, three-line right-aligned header, bare centred page number in the footer, cover with colour bands and logo |
| buncombe-nc-2023 | https://media.buncombenc.gov/common/planning/calendar-files/adjustment-board/2023-09-13/theone/tia.pdf | Gannett Fleming | Buncombe County, NC | Word/Cambria 11 serif body, blue headings with roman-numeral numbering, grid tables with blue header fill, right-aligned header with rule, footer logo + bare page number, plain cover |
| dallas-tx-2022 | https://dallascityhall.com/government/meetings/DCH%20Documents/plan-commission/05-19-22-plansandplats/Z212-165_Traffic_Impact_Study.pdf | Kimley-Horn (Dallas) | City of Dallas, TX | AcroPlot/Arial 10 body, black unnumbered headings, page number in the HEADER ("Page N" right, beside the logo), footer is a crimson address band with no page, grid tables with grey header fill, page-sized cover-art image (red corner shapes) |
| dc-2019 | https://dgs.dc.gov/sites/default/files/dc/sites/dgs/publication/attachments/1601%20W%20St%20-%20Bus%20Terminal%20TIS%20Report.pdf | AMT LLC | District of Columbia (DGS) | Distiller/Tahoma 10 body, black italic-underlined headings, cover dominated by a map image, header with logo + project block, footer "Page N of M" (bold numbers), grid tables |

## Coverage

| criterion | covered by |
|---|---|
| serif body | mansfield-ct-2021 (Palatino), buncombe-nc-2023 (Cambria) |
| sans body | twisp-wa-2023, stafford-va-2024, fairfax-va-2025, dallas-tx-2022, dc-2019 |
| Calibri / Word export | twisp-wa-2023 (Calibri, Word 365); fairfax-va-2025 and buncombe-nc-2023 are Word exports with other body faces |
| InDesign export | **not covered** — see below |
| full-bleed cover art | dallas-tx-2022 (a page-sized cover-art image, extracted as the `image` background); twisp-wa-2023 (gradient image bleeding to the top, left and right edges over the upper 60 % of the page) |
| plain cover | fairfax-va-2025, stafford-va-2024, buncombe-nc-2023 |
| page numbers in a header | fairfax-va-2025, dallas-tx-2022 |
| page numbers in a footer | twisp-wa-2023, stafford-va-2024, mansfield-ct-2021, buncombe-nc-2023, dc-2019 |
| coloured headings | fairfax-va-2025 (green), buncombe-nc-2023 (blue), stafford-va-2024 (white on crimson band) |
| black headings | mansfield-ct-2021, dallas-tx-2022, dc-2019 |
| grid tables | stafford-va-2024, dallas-tx-2022, buncombe-nc-2023, dc-2019 |
| rule-only tables | twisp-wa-2023, mansfield-ct-2021 |

**InDesign export — uncovered.** Every firm-produced TIS found on a public planning portal in this search (about twenty vetted candidates across WA, VA, TX, NC, FL, CT, CA, DC and PA) was a Word export, an AcroPlot/PDF-XChange print, a Distiller print, or a Bluebeam staple. The only InDesign files found were a landscape transportation-plan appendix (Fehr & Peers, 18 pages, tabloid) and a 52 MB, 307-page campus master-plan TIS — neither is a representative firm TIS. Rejected on inspection: Miami-Dade/Langan (scanned cover, image-only figures after page 12), Buncombe/Mattern & Craig (two-column Times body with a DocuSign banner on every page), Pennoni (a "changes highlighted" revision with yellow highlight rects), Hallandale Beach (server answers HEAD with 404).
