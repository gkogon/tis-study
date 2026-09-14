/**
 * `?signal=<signalId>` ↔ the OPEN intersection study.
 *
 * Opening a signal's full-screen study (a map click, a capacity-table row, a
 * deep link) puts its id in the URL so that back / forward and shareable
 * links work: opening pushes one history entry, Close / Escape / the back
 * button pop it, and a page load with `?signal=` opens the study as soon as
 * a report with that row is present. The URL is bound to the open study
 * only — the studio's SELECTION (the map's ring, the Signal tab) is the
 * page's own state and outlives Close.
 *
 * Shared by the pages that mount `IntersectionStudy` (`/tis`, `/demo`) so the
 * two behave identically. The page keeps the open study in its own state and
 * hands the hook a setter; the hook owns the URL side:
 *
 *   - URL → state: whenever `?signal=` changes (or the report lands), the
 *     setter receives the id when the report has that row, else null.
 *   - state → URL (`syncUrl`): the page calls it after opening or closing
 *     itself. Whether THIS page pushed the `?signal=` entry is stamped on
 *     that entry's `history.state` (PUSHED_MARK) — not remembered in a ref —
 *     so it survives Back → Forward: Close on a re-entered pushed entry still
 *     pops it (one history entry per open, never a duplicate), while a deep
 *     link that was never pushed is replaced instead.
 */
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import type { TisReport } from "@workspace/tis-api-client-react";

/** Stamped on the history entry this page pushed for an open study. */
export const PUSHED_MARK = "signalStudyPushed";

function pushedMarkOn(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as Record<string, unknown>)[PUSHED_MARK] === true;
}

export function useSignalStudyUrl(opts: {
  /** The page's own path (`/tis`, `/demo`); the query string is appended to it. */
  basePath: string;
  /** The report whose rows a `?signal=` may name; null before one is on screen. */
  report: TisReport | null;
  /** Receives the URL's open study (validated against the report) or null. */
  setOpenSignalId: (id: string | null) => void;
}): { urlSignalId: string | null; syncUrl: (id: string | null) => void } {
  const { basePath, report } = opts;
  const search = useSearch();
  const [, navigate] = useLocation();
  const urlSignalId = useMemo(() => new URLSearchParams(search).get("signal"), [search]);

  // The setter is read through a ref so the URL → state effect keys on the
  // URL and the report alone.
  const setOpen = useRef(opts.setOpenSignalId);
  setOpen.current = opts.setOpenSignalId;

  // URL → state: the URL is the source of truth for the open study once a
  // report is on screen.
  useEffect(() => {
    if (!report) return;
    const id = urlSignalId && report.affectedIntersections.some((r) => r.signalId === urlSignalId) ? urlSignalId : null;
    setOpen.current(id);
  }, [urlSignalId, report]);

  const withSignal = (id: string | null) => `${basePath}${id ? `?signal=${encodeURIComponent(id)}` : ""}`;
  function syncUrl(id: string | null) {
    if (id) {
      if (urlSignalId === id) return;
      if (urlSignalId) {
        // Another signal while a study is open: replace, keeping the entry's
        // pushed mark so Close still pops what this page pushed.
        navigate(withSignal(id), { replace: true, state: pushedMarkOn(window.history.state) ? { [PUSHED_MARK]: true } : null });
      } else {
        navigate(withSignal(id), { state: { [PUSHED_MARK]: true } });
      }
    } else if (urlSignalId) {
      if (pushedMarkOn(window.history.state)) window.history.back();
      else navigate(withSignal(null), { replace: true });
    }
  }

  return { urlSignalId, syncUrl };
}
