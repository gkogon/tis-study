/**
 * Live Atlanta-metro status strip. Pulls from the analyzer service
 * (api-server on 8081 in dev, same-origin in prod) and renders a
 * compact dashboard of:
 *   - Active GDOT 511 incidents in the metro bounding box
 *   - Highest-importance closure alerts
 *   - Camera count + a hand-picked map link
 *   - Last refresh time
 *
 * Polled every 60 s. Quietly degrades to a static "No live data" line
 * if the analyzer is unreachable or the GDOT key is missing.
 */
import { useEffect, useState } from "react";
import {
  Activity, AlertTriangle, Camera, RadioTower, Clock, ExternalLink,
} from "lucide-react";

type Incident = {
  id: number | string;
  title?: string;
  description?: string;
  roadway?: string;
  type?: string;
  severity?: string;
  startTime?: string;
};

type IncidentBundle = {
  fetchedAt: string;
  totalFetched?: number;
  inMetro?: number;
  snapped?: number;
  incidents?: Incident[];
  method?: string;
};

type Alert = {
  id: number;
  message: string;
  highImportance: boolean;
  startTime: string | null;
  endTime: string | null;
};

type AlertBundle = { alerts: Alert[]; fetchedAt: string };

type CameraBundle = {
  fetchedAt: string;
  totalStatewide: number;
  cameras: Array<{ id: number; roadway: string; location: string; views: { url: string }[] }>;
};

export function AtlantaLiveStatus() {
  const [incidents, setIncidents] = useState<IncidentBundle | null>(null);
  const [alerts, setAlerts] = useState<AlertBundle | null>(null);
  const [cameras, setCameras] = useState<CameraBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [i, a, c] = await Promise.all([
          fetch("/api/atlanta/live-incidents").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/atlanta/alerts").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/atlanta/cameras").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        setIncidents(i);
        setAlerts(a);
        setCameras(c);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // If everything is null AND we have an error, the analyzer is down.
  const allEmpty = !incidents && !alerts && !cameras;
  if (allEmpty && error) {
    return (
      <div className="text-xs text-muted-foreground border rounded-md p-3 inline-flex items-center gap-2">
        <RadioTower className="w-3.5 h-3.5" />
        Live GDOT feed unavailable
      </div>
    );
  }

  const incidentCount = incidents?.inMetro ?? incidents?.incidents?.length ?? 0;
  const highImportanceAlerts = (alerts?.alerts ?? []).filter((a) => a.highImportance);
  const totalAlerts = alerts?.alerts?.length ?? 0;
  const cameraCount = cameras?.cameras?.length ?? 0;
  const sampleCamera = cameras?.cameras?.[0];

  const fetchedAt =
    incidents?.fetchedAt ?? alerts?.fetchedAt ?? cameras?.fetchedAt ?? null;

  return (
    <section className="border rounded-xl bg-background overflow-hidden">
      <header className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap bg-muted/30">
        <div className="inline-flex items-center gap-2 text-sm font-semibold">
          <RadioTower className="w-4 h-4 text-blue-600" />
          Live Atlanta metro · GDOT 511 NaviGAtor
        </div>
        {fetchedAt && (
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            updated {new Date(fetchedAt).toLocaleTimeString()}
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
        <Tile
          icon={Activity}
          label="Active incidents"
          value={incidentCount}
          sub={`${incidents?.snapped ?? 0} snapped to signals`}
          tone={incidentCount > 30 ? "warn" : incidentCount > 0 ? "ok" : "muted"}
        />
        <Tile
          icon={AlertTriangle}
          label="High-priority alerts"
          value={highImportanceAlerts.length}
          sub={`${totalAlerts} total`}
          tone={highImportanceAlerts.length > 0 ? "bad" : "ok"}
        />
        <Tile
          icon={Camera}
          label="Cameras"
          value={cameraCount}
          sub={cameras ? `of ${cameras.totalStatewide} statewide` : "loading…"}
          tone="muted"
        />
        <Tile
          icon={RadioTower}
          label="Source"
          value={incidents?.method === "v2" ? "v2 API" : incidents?.method === "legacy" ? "scrape" : "—"}
          sub={incidents?.method === "v2" ? "live key" : "fallback"}
          tone={incidents?.method === "v2" ? "ok" : "warn"}
        />
      </div>

      {(highImportanceAlerts.length > 0 || (incidents?.incidents?.length ?? 0) > 0) && (
        <div className="px-5 py-3 border-t space-y-2 text-sm">
          {highImportanceAlerts.slice(0, 2).map((a) => (
            <div key={a.id} className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-red-600 shrink-0" />
              <span className="text-foreground">{a.message}</span>
            </div>
          ))}
          {(incidents?.incidents ?? []).slice(0, 3).map((i) => (
            <div key={i.id} className="flex items-start gap-2 text-muted-foreground">
              <Activity className="w-3.5 h-3.5 mt-0.5 text-blue-600 shrink-0" />
              <span>
                <strong className="text-foreground">{i.roadway ?? "—"}</strong>{" · "}
                {i.title ?? i.description?.slice(0, 100) ?? "Incident"}
              </span>
            </div>
          ))}
          {sampleCamera && sampleCamera.views?.[0]?.url && (
            <a
              href={sampleCamera.views[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline pt-1"
              data-testid="link-live-camera"
            >
              <Camera className="w-3 h-3" />
              View live camera on {sampleCamera.roadway}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  icon: Icon, label, value, sub, tone,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  sub: string;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  const toneCls =
    tone === "bad" ? "text-red-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "ok" ? "text-emerald-600" :
    "text-foreground";
  return (
    <div className="px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={"text-2xl font-bold tabular-nums mt-0.5 " + toneCls}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
