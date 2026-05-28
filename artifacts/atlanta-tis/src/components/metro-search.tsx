/**
 * Lightweight metro-name search box with keyboard-navigable autocomplete.
 *
 * Used on /cities and on the home coverage grid. Filters the 300-metro
 * registry by case-insensitive substring match on metro shortName, longName,
 * or state name. Picking a result navigates to /cities/<slug>.
 *
 * Pure client-side filter — no API call. The METROS array is ~5KB at runtime,
 * cheap to scan on every keystroke.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { METROS, STATE_NAMES, type MetroCoverage } from "../data/metro-coverage";

type Result = { metro: MetroCoverage; stateName: string };

function searchMetros(q: string, limit = 8): Result[] {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return [];
  const out: Result[] = [];
  for (const m of METROS) {
    const stateName = STATE_NAMES[m.state] ?? m.state;
    const hay = `${m.shortName} ${m.longName} ${m.state} ${stateName}`.toLowerCase();
    if (hay.includes(needle)) {
      out.push({ metro: m, stateName });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function MetroSearch({
  placeholder = "Search metros — try 'Phoenix', 'CA', 'Manchester'",
  className = "",
  testid = "metro-search",
}: { placeholder?: string; className?: string; testid?: string }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchMetros(q), [q]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Keep active index in range when results change
  useEffect(() => { setActive(0); }, [q]);

  function pick(r: Result): void {
    setQ("");
    setOpen(false);
    navigate(`/cities/${r.metro.slug}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) pick(r);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`} data-testid={testid}>
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => q.length > 0 && setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label="Search metros"
          autoComplete="off"
          spellCheck={false}
          className="w-full pl-10 pr-4 py-2.5 text-sm bg-background border border-border focus:border-foreground/40 focus:outline-none placeholder:text-muted-foreground/70 font-mono"
          data-testid={`${testid}-input`}
        />
        {q.length > 0 && (
          <button
            type="button"
            onClick={() => { setQ(""); setOpen(false); inputRef.current?.focus(); }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground font-mono text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 border border-border bg-background shadow-lg max-h-96 overflow-y-auto"
          role="listbox"
          data-testid={`${testid}-results`}
        >
          {results.map((r, i) => (
            <button
              key={r.metro.code}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              className={
                "w-full grid grid-cols-12 gap-3 px-4 py-2.5 text-left items-baseline border-b border-border/40 last:border-b-0 " +
                (i === active ? "bg-accent" : "hover:bg-accent/60")
              }
              data-testid={`${testid}-result-${r.metro.slug}`}
            >
              <span className="col-span-6 text-sm font-medium text-foreground truncate">
                {r.metro.shortName}
              </span>
              <span className="col-span-4 text-xs text-muted-foreground truncate">
                {r.stateName} {r.metro.country && r.metro.country !== "US" ? `· ${r.metro.country}` : ""}
              </span>
              <span className="col-span-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {r.metro.signals.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && q.length > 0 && results.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          No metro matches "{q}". Try a state code (e.g. CA, TX) or a partial name.
        </div>
      )}
    </div>
  );
}
