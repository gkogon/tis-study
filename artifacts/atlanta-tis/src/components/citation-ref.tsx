/**
 * Inline footnote marker rendered next to a key number in the TIS report.
 * Hovering surfaces the short citation; the full bibliography entry is
 * rendered in the methodology appendix at the end of the report.
 */
import { CITATIONS } from "../lib/tis-citations";

type CitationKey = keyof typeof CITATIONS;

export function CitationRef({ tags }: { tags: CitationKey[] }) {
  const labels = tags.map((t) => CITATIONS[t].shortLabel).join(" • ");
  return (
    <sup
      title={labels}
      className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 ml-0.5 cursor-help"
      data-testid="citation-ref"
    >
      [{tags.map((t) => CITATIONS[t].tag).join(",")}]
    </sup>
  );
}
