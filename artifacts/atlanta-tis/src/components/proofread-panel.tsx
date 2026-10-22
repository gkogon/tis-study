/**
 * The study's internal consistency and traceability check, on the project page.
 *
 * Read-only by construction: the panel renders findings, what each one read,
 * and the source it was checked against, plus controls that RECORD a decision.
 * It offers nothing that edits the study.
 *
 * Polling, not streaming: this codebase has no SSE anywhere and compression is
 * mounted globally, so a terminal status stops a 60 s interval — the cadence
 * atlanta-live-status.tsx uses.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Info, Loader2, MessageSquare, RefreshCw, Scale } from "lucide-react";
import {
  closes,
  dispositionBody,
  fetchProofread,
  isFinished,
  isPending,
  isSuperseded,
  latestDisposition,
  offeredFor,
  orderFindings,
  recordDisposition,
  requestProofread,
  RULES_CHANGED_LINE,
  summarizeOpen,
  SUPERSEDED_NOTICE,
  withheldLine,
  withRecordedDecision,
  type EngineerDisposition,
  type OpenSummary,
  type ProofreadFindingT,
  type ProofreadRun,
} from "@/lib/proofread";

// The visual language of SEVERITY_CONFIG in tis-report-bits.tsx: red is what
// holds a study (major), amber is "say this out loud" (moderate), yellow is
// "worth knowing" (minor). A DISCLOSE is an instruction about the deliverable,
// not a fault, so it takes the amber of a moderate mitigation, not the red of a major one.
const TYPE_CONFIG: Record<ProofreadFindingT["type"], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  BLOCKER: { label: "Blocker", color: "text-red-600", icon: AlertCircle },
  DEFECT: { label: "Defect", color: "text-red-600", icon: AlertCircle },
  DISCLOSE: { label: "Disclose", color: "text-amber-600", icon: AlertTriangle },
  NOTE: { label: "Note", color: "text-yellow-600", icon: Info },
  UNVERIFIED: { label: "Unverified", color: "text-slate-600", icon: HelpCircle },
  CONTESTED: { label: "Contested", color: "text-purple-600", icon: Scale },
};

// Which of these a finding is offered, and which of them close it, is decided in
// one place: OFFERED in lib/proofread.ts. This is only how they read.
const DECISION_LABEL: Record<EngineerDisposition, string> = {
  FIXED: "Fixed",
  DISCLOSED: "Disclosed in the deliverable",
  WITHDRAWN: "Withdrawn on a source",
};

const POLL_MS = 60_000;

/**
 * The Datum chat's part of the panel, handed down from the project page while the
 * chat is on (undefined otherwise, and the panel is as it always was): the box at
 * the top, and what each card's "Ask about this" opens.
 */
type PanelChat = { onAsk: (f: ProofreadFindingT) => void; askBox: ReactNode };

export function ProofreadPanel({ projectId, chat }: { projectId: string; chat?: PanelChat }) {
  const [run, setRun] = useState<ProofreadRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why a decision did not stick (the check was run again). Its own state, not
  // `error`: the refetch it triggers clears `error` the moment it lands.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumping this re-runs the effect, which re-arms the interval. The effect
  // clears its own timer on a terminal status, so without this a re-run would
  // refetch exactly once and then never poll again.
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // A second press while one is in flight must not fire. `busy` disables the
  // buttons, but only once React has re-rendered — a press that lands before
  // that (two clicks in one task) still reaches the handler. Decisions are
  // appended to a log that cannot be edited, so a duplicate is permanent.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchProofread(projectId);
        if (cancelled) return;
        setRun(next);
        setError(null);
        if (!isPending(next.status) && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    timer.current = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [projectId, nonce]);

  // The request holds the connection for the length of a clause pass, so `busy`
  // stays true — and the button disabled — for all of it.
  const rerun = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await requestProofread(projectId);
      setError(null);
      setNonce((v) => v + 1); // re-arms the poll and refetches
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const triage = async (f: ProofreadFindingT, disposition: string) => {
    if (inFlight.current || !run?.runId) return;
    const runId = run.runId;
    const body = dispositionBody(disposition, () => window.prompt("Name the source this is withdrawn on:"));
    if (!body) return; // cancelled, or no source named: nothing to record
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await recordDisposition(projectId, runId, f.id, body);
      // The server has taken it. Show it at once (see withRecordedDecision): `busy` is released
      // below, and until the refetch lands this card would otherwise still offer the decision
      // just recorded. The refetch replaces it with the server's own record.
      setRun((prev) => (prev ? withRecordedDecision(prev, runId, f, body, new Date()) : prev));
      // Refetch through the effect, as "Run again" does: it re-arms the poll, and it drops a
      // result that arrives after the project has changed.
      setNonce((v) => v + 1);
    } catch (e) {
      // A 409: the run on screen is no longer the project's newest finished
      // run, and nothing was recorded. Refetch through the effect, which shows
      // the newest run and re-arms the poll if it is still being checked.
      if (isSuperseded(e)) {
        setNotice(SUPERSEDED_NOTICE);
        setNonce((v) => v + 1);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <ProofreadView
      run={run}
      error={error ?? notice}
      busy={busy}
      onRerun={() => void rerun()}
      onTriage={(f, d) => void triage(f, d)}
      onAsk={chat?.onAsk}
      askBox={chat?.askBox}
    />
  );
}

/**
 * The sentence above the findings. An ordinary study carries a DISCLOSE or a
 * NOTE or two — a clamped delay, a merged duplicate the deliverable does not
 * mention — and the protocol's gate turns on an open blocker, defect or
 * contested item alone, so a panel with only those says so plainly instead of
 * reading as an alarm. A defect is never shown here, only counted (`withheld`),
 * and summarizeOpen counts it as a hold, so a run carrying one never reaches
 * the quiet sentence or "Every item has a recorded decision". `incomplete`
 * keeps that sentence scoped: "no open blocker" is a claim about the clauses
 * that ran.
 */
function summaryLine(s: OpenSummary, incomplete: boolean): { text: string; alarm: boolean } | null {
  if (s.total === 0) return null;
  if (s.open === 0) return { text: "Every item has a recorded decision.", alarm: false };
  const rest: string[] = [];
  if (s.disclose > 0) rest.push(`${s.disclose} to state in the deliverable`);
  if (s.note > 0) rest.push(`${s.note} note${s.note === 1 ? "" : "s"}`);
  if (s.unverified > 0) rest.push(`${s.unverified} that could not be verified`);
  if (s.holds > 0) {
    return {
      text:
        `${s.holds} open item${s.holds === 1 ? "" : "s"} to resolve before this study is called complete.` +
        (rest.length ? ` Also: ${rest.join(", ")}.` : ""),
      alarm: true,
    };
  }
  return {
    text:
      `No open blocker or contested item${incomplete ? " in the clauses that ran" : ""}. ` +
      `For the deliverable and the record: ${rest.join(", ")}.`,
    alarm: false,
  };
}

function PanelHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 flex-wrap p-4 border-b">
      <div>
        <h2 className="text-sm font-semibold">Consistency check</h2>
        <p className="text-xs text-muted-foreground max-w-prose">
          An internal consistency and traceability check over this saved study: each item names the
          values it read and the source it was checked against. It does not change the study.
        </p>
      </div>
      {children}
    </header>
  );
}

/**
 * Everything the panel draws, as a pure function of the run it was handed. The
 * stateful wrapper above owns the fetching and the timers; keeping the markup
 * here lets the copy guard render it for each status and read what it shows.
 */
export function ProofreadView({
  run,
  error,
  busy,
  onRerun,
  onTriage,
  onAsk,
  askBox,
}: {
  run: ProofreadRun | null;
  error: string | null;
  busy: boolean;
  onRerun: () => void;
  onTriage: (f: ProofreadFindingT, disposition: string) => void;
  /** Set while the Datum chat is on: each card then carries "Ask about this", which hands it its finding. */
  onAsk?: (f: ProofreadFindingT) => void;
  /** The Datum chat's box for a question about the study as a whole, drawn at the top. */
  askBox?: ReactNode;
}) {
  if (!run) {
    // Still loading: nothing yet. Failed to load: say so — a panel that vanishes
    // on an error looks exactly like a study with no check.
    if (!error) return null;
    return (
      <section className="border rounded-lg" data-testid="panel-proofread">
        <PanelHeader />
        <div className="p-4 text-xs text-red-600">Could not load the check ({error}). Trying again every minute.</div>
      </section>
    );
  }

  // The result — findings and what the clauses covered — is shown only for a
  // finished run. See the note above the findings.
  const finished = isFinished(run.status);
  const ran = run.coverage.filter((c) => c.status === "ran");
  const notRun = run.coverage.filter((c) => c.status === "not-run");
  // A clause that ran but judged only part of the record says so here. Rendering
  // it beside the findings is the difference between "nothing found" and
  // "nothing found in the part I could read".
  const partial = run.coverage.filter((c) => c.status === "ran" && !!c.note);
  // No clause having run is the limit of "incomplete": an empty coverage (a study whose
  // record lacks the fields) or twelve clauses that all could not run found nothing
  // because nothing was looked at, which is not the same as nothing being there.
  const incomplete = ran.length === 0 || notRun.length > 0 || partial.length > 0;
  // Findings the server did not send (a DEFECT, routed to the software team).
  // Any at all, and the run is not clear: no "nothing flagged", no green check.
  const withheld = run.withheld > 0 ? run.withheld : 0;
  const summary = finished ? summaryLine(summarizeOpen(run.findings, run.dispositions, withheld), incomplete) : null;

  return (
    <section className="border rounded-lg" data-testid="panel-proofread">
      <PanelHeader>
        <button
          onClick={onRerun}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted disabled:opacity-50"
          data-testid="button-proofread-rerun"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}{" "}
          {run.status === "none" ? "Run the check" : "Run again"}
        </button>
      </PanelHeader>

      <div className="p-4 space-y-3">
        {askBox}

        {error && <div className="text-xs text-red-600">{error}</div>}

        {isPending(run.status) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking this study…
          </div>
        )}

        {run.status === "failed" && (
          <div className="text-xs text-amber-700">
            The check did not finish. The study itself is unaffected — run it again when convenient.
          </div>
        )}

        {/* A study that was never checked must not render as clean. "none" is
            not a result; conflating it with "nothing found" is the false-coverage
            failure the protocol forbids. */}
        {run.status === "none" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HelpCircle className="w-4 h-4" />
            This study has not been checked yet. Run the check to see what can be verified from the saved record.
          </div>
        )}

        {/* Findings are rendered only for a finished run. Between the runner's
            two write steps a row is `running` with findings already stored but
            dispositions not yet carried forward — normally milliseconds, up to a
            lease after a crash — and triaging in that window races the carry. A
            run that FAILED after that first write is in the same state for good,
            so "finished" is the gate, not merely "not pending". */}
        {finished && run.findings.length === 0 && withheld === 0 && ran.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HelpCircle className="w-4 h-4" />
            No clause could run on this study, so nothing was checked.
          </div>
        )}

        {finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            {incomplete ? (
              <Info className="w-4 h-4 text-muted-foreground" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            )}
            Nothing flagged in the clauses that could run.
          </div>
        )}

        {summary && (
          <p
            className={`text-sm ${summary.alarm ? "text-red-600 font-medium" : "text-foreground"}`}
            data-testid="proofread-summary"
          >
            {summary.text}
          </p>
        )}

        {finished && withheld > 0 && (
          <p className="text-sm text-red-600" data-testid="proofread-withheld">
            {withheldLine(withheld)}
          </p>
        )}

        {/* A RULES_VERSION change stops the carry-forward on purpose, so every
            earlier decision is open again: say why, once, on a finished run. */}
        {finished && run.rulesChanged === true && (
          <p className="text-xs text-muted-foreground" data-testid="proofread-rules-changed">
            {RULES_CHANGED_LINE}
          </p>
        )}

        {finished && orderFindings(run.findings).map((f) => {
          const cfg = TYPE_CONFIG[f.type] ?? { label: f.type, color: "text-slate-600", icon: HelpCircle };
          const Icon = cfg.icon;
          const disposed = latestDisposition(run.dispositions, f.id);
          const closed = closes(f.type, disposed?.disposition);
          const offered = offeredFor(f.type);
          const noun = f.type === "CONTESTED" ? "contested item" : cfg.label.toLowerCase();
          return (
            <div key={f.id} className="border rounded-lg p-4 space-y-3" data-testid={`finding-${f.clauseId}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Icon className={`w-4 h-4 mt-0.5 ${cfg.color}`} />
                  <div>
                    <div className="text-sm font-semibold">{f.title}</div>
                    <div className="text-xs text-muted-foreground">§{f.section} · {f.clauseId}</div>
                  </div>
                </div>
                <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
              </div>

              <p className="text-sm">{f.detail}</p>

              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                <li>Checked against: {f.sourceLabel}</li>
                {f.readPaths.slice(0, 6).map((p, i) => (
                  <li key={`${p.path}:${i}`}>
                    {p.path} = {String(p.value)}
                  </li>
                ))}
                {f.readPaths.length > 6 && <li>and {f.readPaths.length - 6} more values</li>}
                <li>Suggested: {f.remedy}</li>
              </ul>

              {disposed && (
                <div className="text-xs text-muted-foreground">
                  Recorded: <span className="font-medium">{disposed.disposition}</span>
                  {disposed.sourceLabel ? ` — ${disposed.sourceLabel}` : ""} on{" "}
                  {new Date(disposed.createdAt).toLocaleString()}
                  {!closed && `. That does not close a ${noun}; it stays open.`}
                </div>
              )}

              {/* A contested item is a licensed engineer's decision. That role does
                  not exist yet, so nothing an engineer can record closes it. */}
              {f.type === "CONTESTED" && (
                <div className="text-xs text-muted-foreground">
                  Awaiting the sealing engineer's ruling. A contested item stays open until the engineer rules.
                </div>
              )}

              {!closed && offered.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {offered.map((d) => (
                    <button
                      key={d}
                      onClick={() => onTriage(f, d)}
                      disabled={busy}
                      className="px-2 py-1 text-xs rounded-md border hover:bg-muted disabled:opacity-50"
                      data-testid={`button-disposition-${d.toLowerCase()}`}
                    >
                      {DECISION_LABEL[d]}
                    </button>
                  ))}
                </div>
              )}

              {onAsk && (
                <div>
                  <button
                    type="button"
                    onClick={() => onAsk(f)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border hover:bg-muted"
                    data-testid="button-ask-datum"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Ask about this
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {finished && partial.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <div className="font-medium">Checked in part only</div>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {partial.map((c) => (
                <li key={c.clauseId}>
                  §{c.section} {c.clauseId} — {c.note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {finished && notRun.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {notRun.length} clause{notRun.length === 1 ? "" : "s"} could not run on this study
            </summary>
            <ul className="list-disc pl-5 mt-2 space-y-0.5">
              {notRun.map((c) => (
                <li key={c.clauseId}>
                  §{c.section} {c.clauseId} — {c.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
