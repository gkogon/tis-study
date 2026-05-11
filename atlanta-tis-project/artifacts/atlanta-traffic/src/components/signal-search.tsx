import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, MapPin } from "lucide-react";
import { IntersectionSummary, IntersectionChange } from "@workspace/api-client-react";

interface SignalSearchProps {
  intersections: IntersectionSummary[];
  signalChanges?: IntersectionChange[];
  onSelect: (id: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "#009118",
  moderate: "#eab308",
  high: "#795EFF",
  critical: "#A60808",
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
};

// Cap for the generic name/id search. When the query matches one or more
// neighborhoods, we DO NOT apply this cap — every light in the matching
// neighborhood(s) is surfaced (the dropdown is scrollable).
const NAME_RESULT_CAP = 12;

export function SignalSearch({ intersections, signalChanges, onSelect }: SignalSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build a quick lookup: id -> change
  const changesById = useMemo(() => {
    const m = new Map<string, IntersectionChange>();
    if (signalChanges) for (const c of signalChanges) m.set(c.id, c);
    return m;
  }, [signalChanges]);

  // The full set of zones present in the data (computed once per intersections
  // change). Sorted alphabetically and case-preserved.
  const allZones = useMemo(() => {
    const set = new Set<string>();
    for (const it of intersections) set.add(it.zone);
    return Array.from(set).sort();
  }, [intersections]);

  // Zones whose name contains the query (case-insensitive substring). Requires
  // at least 2 chars so single-letter typos don't accidentally match all zones.
  const matchedZones = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [] as string[];
    return allZones.filter((z) => z.toLowerCase().includes(q));
  }, [query, allZones]);

  // When zones match, surface EVERY light in those zones (no cap). Sort by
  // zone (alphabetical), then severity (worst first), then score (desc).
  const zoneSignals = useMemo(() => {
    if (matchedZones.length === 0) return [] as IntersectionSummary[];
    const zoneSet = new Set(matchedZones);
    const sigs = intersections.filter((it) => zoneSet.has(it.zone));
    sigs.sort((a, b) => {
      if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
      const sevDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (sevDiff !== 0) return sevDiff;
      return b.inefficiencyScore - a.inefficiencyScore;
    });
    return sigs;
  }, [matchedZones, intersections]);

  // Pre-group signals by zone once so the render loop can read each group via
  // O(1) Map lookup instead of an O(n) `filter` per zone (matters when the
  // query matches many neighborhoods).
  const signalsByZone = useMemo(() => {
    const m = new Map<string, IntersectionSummary[]>();
    for (const s of zoneSignals) {
      const list = m.get(s.zone);
      if (list) list.push(s);
      else m.set(s.zone, [s]);
    }
    return m;
  }, [zoneSignals]);

  // Per-zone counts so the section header can read "Buckhead — 94 signals".
  const zoneCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [zone, list] of signalsByZone) m.set(zone, list.length);
    return m;
  }, [signalsByZone]);

  // Generic name/id matches (existing behavior, capped) — used when no
  // neighborhood matches the query.
  const nameResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as IntersectionSummary[];
    const matches: IntersectionSummary[] = [];
    for (const it of intersections) {
      if (
        it.name.toLowerCase().includes(q) ||
        it.id.toLowerCase().includes(q) ||
        it.zone.toLowerCase().includes(q)
      ) {
        matches.push(it);
        if (matches.length > 200) break;
      }
    }
    matches.sort((a, b) => {
      const sevDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (sevDiff !== 0) return sevDiff;
      return b.inefficiencyScore - a.inefficiencyScore;
    });
    return matches.slice(0, NAME_RESULT_CAP);
  }, [query, intersections]);

  // The flat list the user navigates with ↑/↓/Enter. When a neighborhood
  // matches, this is every light in that neighborhood (uncapped); otherwise
  // it's the top-12 name/id matches.
  const flatResults = matchedZones.length > 0 ? zoneSignals : nameResults;

  // Reset highlight when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [flatResults]);

  // Click outside closes dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keyboard: ⌘/Ctrl+K to focus, ↓↑ to navigate, Enter to pick, Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Guard against empty result set (length-1 would become -1).
      setActiveIdx((i) => Math.max(0, Math.min(i + 1, flatResults.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flatResults[activeIdx];
      if (pick) selectResult(pick.id);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  function selectResult(id: string) {
    onSelect(id);
    setOpen(false);
    setQuery("");
  }

  function highlight(text: string, q: string) {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 dark:bg-yellow-700/40 text-foreground rounded-sm px-0.5">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  const showDropdown = open && (query.trim().length > 0);
  const isNeighborhoodMode = matchedZones.length > 0;

  // For grouped rendering in neighborhood mode: track the running flat-index
  // so highlight/selection still works correctly across group headers.
  let runningIdx = 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search 7,393 signals — try a name, ID, or a neighborhood like 'Buckhead'"
          className="w-full h-10 pl-10 pr-20 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Search signals or neighborhoods"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          data-testid="input-signal-search"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-12 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 h-5 rounded border bg-muted text-[10px] font-mono text-muted-foreground pointer-events-none">
          ⌘K
        </kbd>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 mt-1.5 z-[100] bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {flatResults.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No signals match <span className="font-medium text-foreground">"{query}"</span>.
              <div className="text-xs mt-1">Try a neighborhood like "Buckhead" or "Sandy Springs", or part of a signal name.</div>
            </div>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/30 flex justify-between">
                <span data-testid="text-result-summary">
                  {isNeighborhoodMode
                    ? `${flatResults.length} signal${flatResults.length === 1 ? "" : "s"} in ${matchedZones.length === 1 ? matchedZones[0] : `${matchedZones.length} neighborhoods`}`
                    : `${flatResults.length} match${flatResults.length === 1 ? "" : "es"}`}
                </span>
                <span className="opacity-70">↑↓ navigate · ↵ open</span>
              </div>
              <ul role="listbox" className="max-h-[420px] overflow-y-auto">
                {isNeighborhoodMode
                  ? matchedZones.map((zone) => (
                      <div key={zone}>
                        <div
                          className="sticky top-0 z-[1] px-3 py-1.5 bg-muted/80 backdrop-blur-sm border-b text-[11px] font-semibold flex items-center gap-1.5"
                          data-testid={`header-zone-${zone}`}
                        >
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          <span>{highlight(zone, query)}</span>
                          <span className="text-muted-foreground font-normal">
                            — {zoneCounts.get(zone) ?? 0} signal{(zoneCounts.get(zone) ?? 0) === 1 ? "" : "s"}
                          </span>
                        </div>
                        {(signalsByZone.get(zone) ?? []).map((r) => {
                          const idx = runningIdx++;
                          return renderResultRow(r, idx);
                        })}
                      </div>
                    ))
                  : nameResults.map((r, i) => renderResultRow(r, i))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );

  function renderResultRow(r: IntersectionSummary, i: number) {
    const ch = changesById.get(r.id);
    const drop = ch ? ch.scoreBefore - ch.scoreAfter : 0;
    const sevColor = SEVERITY_COLORS[r.severity] ?? "#666";
    const isActive = i === activeIdx;
    return (
      <li
        key={r.id}
        role="option"
        aria-selected={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => selectResult(r.id)}
        onMouseEnter={() => setActiveIdx(i)}
        className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm border-b last:border-b-0 ${
          isActive ? "bg-muted" : "hover:bg-muted/60"
        }`}
        data-testid={`row-signal-${r.id}`}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: sevColor }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{highlight(r.name, query)}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <MapPin className="w-2.5 h-2.5" />
            <span>{highlight(r.zone, query)}</span>
            <span className="opacity-50">·</span>
            <span className="capitalize">{r.severity}</span>
            <span className="opacity-50">·</span>
            <span className="font-mono opacity-70">{highlight(r.id, query)}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">
            Score
          </div>
          {ch ? (
            <div className="flex items-center gap-1.5 text-[12px] tabular-nums leading-tight">
              <span className="opacity-70">{ch.scoreBefore}</span>
              <span className="text-muted-foreground text-[10px]">→</span>
              <span className="font-semibold">{ch.scoreAfter}</span>
              {drop > 0 && (
                <span className="text-[10px] font-semibold text-green-700 dark:text-green-400">
                  −{drop.toFixed(0)}
                </span>
              )}
            </div>
          ) : (
            <div className="text-[12px] font-semibold tabular-nums" style={{ color: sevColor }}>
              {r.inefficiencyScore.toFixed(0)}
            </div>
          )}
        </div>
      </li>
    );
  }
}
