/**
 * `?signal=<signalId>` ↔ the open intersection study.
 *
 * Selecting a signal (a map click, a capacity-table row, the studio's Signal
 * tab) opens that signal's full-screen study, and the selection lives in the
 * URL so that back / forward and deep links work: opening pushes one history
 * entry, Close / Escape / the back button pop it, and a page load with
 * `?signal=` opens the study as soon as a report with that row is present.
 *
 * Shared by the pages that mount `IntersectionStudy` (`/tis`, `/demo`) so the
 * two behave identically. The page keeps the selection in its own state
 * (`/tis` inside the scenario, `/demo` on its own) and hands the hook a
 * setter; the hook owns the URL side:
 *
 *   - URL → state: whenever `?signal=` changes (or the report lands), the
 *     setter receives the id when the report has that row, else null.
 *   - state → URL (`syncUrl`): the page calls it after changing the selection
 *     itself. `pushed` remembers whether THIS page pushed the `?signal=` entry,
 *     so Close pops it (one history entry per open) rather than piling up; a
 *     deep link that was never pushed is replaced instead.
 */
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import type { TisReport } from "@workspace/tis-api-client-react";

export function useSignalStudyUrl(opts: {
  /** The page's own path (`/tis`, `/demo`); the query string is appended to it. */
  basePath: string;
  /** The report whose rows a `?signal=` may name; null before one is on screen. */
  report: TisReport | null;
  /** Receives the URL's selection (validated against the report) or null. */
  setSelectedSignalId: (id: string | null) => void;
}): { urlSignalId: string | null; syncUrl: (id: string | null) => void } {
  const { basePath, report } = opts;
  const search = useSearch();
  const [, navigate] = useLocation();
  const urlSignalId = useMemo(() => new URLSearchParams(search).get("signal"), [search]);

  // The setter is read through a ref so the URL → state effect keys on the
  // URL and the report alone, exactly like the inline version it replaced.
  const setSelected = useRef(opts.setSelectedSignalId);
  setSelected.current = opts.setSelectedSignalId;

  // URL → state: the URL is the source of truth for the open study once a
  // report is on screen.
  useEffect(() => {
    if (!report) return;
    const id = urlSignalId && report.affectedIntersections.some((r) => r.signalId === urlSignalId) ? urlSignalId : null;
    setSelected.current(id);
  }, [urlSignalId, report]);

  const pushed = useRef(false);
  useEffect(() => { if (!urlSignalId) pushed.current = false; }, [urlSignalId]);

  const withSignal = (id: string | null) => `${basePath}${id ? `?signal=${encodeURIComponent(id)}` : ""}`;
  function syncUrl(id: string | null) {
    if (id) {
      if (urlSignalId === id) return;
      navigate(withSignal(id), { replace: !!urlSignalId });
      if (!urlSignalId) pushed.current = true;
    } else if (urlSignalId) {
      if (pushed.current) { pushed.current = false; window.history.back(); }
      else navigate(withSignal(null), { replace: true });
    }
  }

  return { urlSignalId, syncUrl };
}
