import { useMemo, useEffect } from "react";
import { useGetIntersection, getGetIntersectionQueryKey, IntersectionChange } from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowRight, Activity, Clock, Car, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

interface IntersectionDrawerProps {
  intersectionId: string | null;
  onClose: () => void;
  onNavigate?: (id: string) => void;
  siblings?: string[];
  signalChanges?: IntersectionChange[];
  isDark?: boolean;
}

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};

const SEVERITY_COLORS = {
  low: "#009118",
  moderate: "#eab308",
  high: "#795EFF",
  critical: "#A60808",
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-background border border-border rounded-md p-2 shadow-md text-xs">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}:</span>
          <span className="font-semibold">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function IntersectionDrawer({ intersectionId, onClose, onNavigate, siblings, signalChanges, isDark }: IntersectionDrawerProps) {
  const { data, isLoading, isFetching } = useGetIntersection(intersectionId || "", {
    query: {
      enabled: !!intersectionId,
      queryKey: getGetIntersectionQueryKey(intersectionId || "")
    }
  });

  const isOpen = !!intersectionId;
  const loading = isLoading || isFetching;

  // Sibling navigation
  const siblingIndex = useMemo(
    () => (intersectionId && siblings ? siblings.indexOf(intersectionId) : -1),
    [intersectionId, siblings]
  );
  const hasNav = !!onNavigate && !!siblings && siblings.length > 1 && siblingIndex >= 0;
  const prevId = hasNav && siblingIndex > 0 ? siblings![siblingIndex - 1]! : null;
  const nextId = hasNav && siblingIndex < siblings!.length - 1 ? siblings![siblingIndex + 1]! : null;

  // Per-signal optimization change (after retiming)
  const change = useMemo(
    () => (intersectionId && signalChanges ? signalChanges.find((c) => c.id === intersectionId) ?? null : null),
    [intersectionId, signalChanges]
  );

  // Keyboard shortcuts: ← / → to shuffle through signals.
  // Skip when user is typing in a form field or holding a modifier.
  useEffect(() => {
    if (!isOpen || !hasNav) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          t.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === "ArrowLeft" && prevId) {
        e.preventDefault();
        onNavigate!(prevId);
      } else if (e.key === "ArrowRight" && nextId) {
        e.preventDefault();
        onNavigate!(nextId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, hasNav, prevId, nextId, onNavigate]);

  const tileUrl = isDark 
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const signalData = data?.intersection?.signalTiming ? [
    { name: 'N/S Green', value: data.intersection.signalTiming.nsGreen, color: CHART_COLORS.green },
    { name: 'E/W Green', value: data.intersection.signalTiming.ewGreen, color: CHART_COLORS.blue },
    { name: 'Protected Left', value: data.intersection.signalTiming.protectedLeft, color: CHART_COLORS.purple },
    { name: 'All Red', value: data.intersection.signalTiming.allRed, color: CHART_COLORS.red },
  ] : [];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md md:max-w-lg overflow-y-auto p-0 flex flex-col">
        {loading || !data ? (
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2" />
            <div className="mt-8 space-y-4">
              <Skeleton className="h-48 w-full" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
              <Skeleton className="h-48 w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="bg-muted/30 border-b p-6 pt-10">
              {hasNav && (
                <div className="flex items-center justify-between mb-3 -mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!prevId}
                    onClick={() => prevId && onNavigate!(prevId)}
                    aria-label="Previous signal"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="ml-1 text-xs">Prev</span>
                  </Button>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    Signal {siblingIndex + 1} of {siblings!.length}
                    <span className="hidden sm:inline ml-1.5 opacity-60">· use ← →</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!nextId}
                    onClick={() => nextId && onNavigate!(nextId)}
                    aria-label="Next signal"
                  >
                    <span className="mr-1 text-xs">Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
              <div className="flex justify-between items-start mb-2">
                <SheetTitle className="text-xl tracking-tight leading-tight">{data.intersection.name}</SheetTitle>
              </div>
              <SheetDescription className="flex items-center gap-2 mb-4">
                <span>{data.intersection.zone} Zone</span>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span>ID: {data.intersection.id}</span>
              </SheetDescription>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background border rounded-lg p-3">
                  <div className="text-[11px] text-muted-foreground mb-1 font-medium flex items-center gap-1.5"><Activity className="w-3 h-3"/> Score</div>
                  <div className="text-xl font-bold" style={{ color: SEVERITY_COLORS[data.intersection.severity as keyof typeof SEVERITY_COLORS] || CHART_COLORS.blue }}>
                    {data.intersection.inefficiencyScore}
                  </div>
                </div>
                <div className="bg-background border rounded-lg p-3">
                  <div className="text-[11px] text-muted-foreground mb-1 font-medium flex items-center gap-1.5"><Clock className="w-3 h-3"/> Delay</div>
                  <div className="text-xl font-bold">{data.intersection.avgDelaySeconds}s</div>
                </div>
                <div className="bg-background border rounded-lg p-3">
                  <div className="text-[11px] text-muted-foreground mb-1 font-medium flex items-center gap-1.5"><Car className="w-3 h-3"/> Daily Vol</div>
                  <div className="text-xl font-bold">{data.intersection.trafficVolume.total.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-8 flex-1">
              
              {/* Mini Map */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Location</h4>
                <div className="h-40 rounded-lg overflow-hidden border">
                  <MapContainer 
                    center={[data.intersection.latitude, data.intersection.longitude]} 
                    zoom={15} 
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                    dragging={false}
                    scrollWheelZoom={false}
                  >
                    <TileLayer url={tileUrl} />
                    <CircleMarker
                      center={[data.intersection.latitude, data.intersection.longitude]}
                      radius={8}
                      pathOptions={{
                        fillColor: SEVERITY_COLORS[data.intersection.severity as keyof typeof SEVERITY_COLORS],
                        fillOpacity: 0.8,
                        color: isDark ? "#111" : "#fff",
                        weight: 2,
                      }}
                    />
                  </MapContainer>
                </div>
              </div>

              {/* Recommendation */}
              {data.recommendation && (
                <div>
                  <h4 className="text-sm font-semibold mb-3">Optimization Recommendation</h4>
                  <div className="border rounded-lg p-4 bg-primary/5 border-primary/20 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                    
                    <div className="flex justify-between items-start mb-3">
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400 border-green-200 dark:border-green-800">
                        Est. Reduction: {data.recommendation.estimatedDelayReductionSeconds}s
                      </Badge>
                    </div>
                    
                    <div className="mb-3 flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Bottleneck movement:</span>
                      <Badge variant="outline" className="px-1.5 py-0 h-4 text-[10px] font-medium">
                        {data.recommendation.targetMovement}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-background border rounded p-2 text-xs">
                        <span className="text-muted-foreground block mb-1">{data.recommendation.targetPhase}</span>
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className="line-through opacity-70">{data.recommendation.currentPhaseSeconds}s</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="text-primary">{data.recommendation.suggestedPhaseSeconds}s</span>
                        </div>
                      </div>
                      <div className="bg-background border rounded p-2 text-xs">
                        <span className="text-muted-foreground block mb-1">Cycle Length</span>
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className="line-through opacity-70">{data.recommendation.currentCycleLength}s</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="text-primary">{data.recommendation.suggestedCycleLength}s</span>
                        </div>
                      </div>
                    </div>
                    
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{data.recommendation.rationale}</p>
                  </div>
                </div>
              )}

              {/* After Optimization (per-signal simulation result) */}
              {change && (
                <div>
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400" />
                    After Optimization
                  </h4>
                  <div className="border rounded-lg p-4 bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900/40">
                    {(() => {
                      const scoreDelta = change.scoreBefore - change.scoreAfter;
                      const vcDelta = change.worstVcBefore - change.worstVcAfter;
                      const movementChanged = change.worstMovementBefore !== change.worstMovementAfter;
                      const noTimingChange =
                        change.nsGreenBefore === change.nsGreenAfter &&
                        change.ewGreenBefore === change.ewGreenAfter &&
                        change.protectedLeftBefore === change.protectedLeftAfter &&
                        change.cycleLengthBefore === change.cycleLengthAfter;

                      const sevColorBefore = SEVERITY_COLORS[change.severityBefore as keyof typeof SEVERITY_COLORS];
                      const sevColorAfter = SEVERITY_COLORS[change.severityAfter as keyof typeof SEVERITY_COLORS];

                      return (
                        <>
                          {noTimingChange ? (
                            <p className="text-[12px] text-muted-foreground italic mb-3">
                              This signal is already operating well — the algorithm leaves its timing unchanged.
                            </p>
                          ) : (
                            <p className="text-[12px] text-muted-foreground mb-3 leading-relaxed">
                              Predicted result if this signal is retimed to the suggestion above and re-scored
                              through the same pipeline.
                            </p>
                          )}

                          <div className="grid grid-cols-2 gap-2.5 mb-3">
                            {/* Severity */}
                            <div className="bg-background border rounded p-2.5">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                                Severity
                              </div>
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                <span className="capitalize" style={{ color: sevColorBefore }}>
                                  {change.severityBefore}
                                </span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                <span className="capitalize" style={{ color: sevColorAfter }}>
                                  {change.severityAfter}
                                </span>
                              </div>
                            </div>

                            {/* Score */}
                            <div className="bg-background border rounded p-2.5">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                                Score
                              </div>
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                <span>{change.scoreBefore}</span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                <span>{change.scoreAfter}</span>
                                {scoreDelta > 0 && (
                                  <span className="ml-auto text-[10px] font-semibold text-green-700 dark:text-green-400 tabular-nums">
                                    −{scoreDelta.toFixed(0)}
                                  </span>
                                )}
                                {scoreDelta < 0 && (
                                  <span className="ml-auto text-[10px] font-semibold text-red-700 dark:text-red-400 tabular-nums">
                                    +{Math.abs(scoreDelta).toFixed(0)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Worst v/c */}
                            <div className="bg-background border rounded p-2.5">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                                Worst v/c
                              </div>
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                <span>{change.worstVcBefore.toFixed(2)}</span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                <span>{change.worstVcAfter.toFixed(2)}</span>
                                {vcDelta > 0.005 && (
                                  <span className="ml-auto text-[10px] font-semibold text-green-700 dark:text-green-400 tabular-nums">
                                    −{vcDelta.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Bottleneck movement */}
                            <div className="bg-background border rounded p-2.5">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                                Bottleneck
                              </div>
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                {movementChanged ? (
                                  <>
                                    <span>{change.worstMovementBefore}</span>
                                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                    <span className="text-green-700 dark:text-green-400">
                                      {change.worstMovementAfter}
                                    </span>
                                  </>
                                ) : (
                                  <span>{change.worstMovementAfter}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {!noTimingChange && (
                            <>
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                                Signal Timing Changes
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] bg-background border rounded p-3">
                                {([
                                  ["N/S Green", change.nsGreenBefore, change.nsGreenAfter],
                                  ["E/W Green", change.ewGreenBefore, change.ewGreenAfter],
                                  ["Protected Left", change.protectedLeftBefore, change.protectedLeftAfter],
                                  ["Cycle Length", change.cycleLengthBefore, change.cycleLengthAfter],
                                ] as const).map(([label, before, after]) => {
                                  const delta = after - before;
                                  const deltaColor = delta > 0
                                    ? "#009118"
                                    : delta < 0
                                    ? "#A60808"
                                    : "transparent";
                                  return (
                                    <div key={label} className="flex items-center justify-between gap-2">
                                      <span className="text-muted-foreground">{label}</span>
                                      <span className="flex items-center gap-1.5">
                                        <span className="opacity-70">{before}s</span>
                                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                        <span className="font-medium">{after}s</span>
                                        {delta !== 0 && (
                                          <span
                                            className="text-[10px] font-semibold tabular-nums w-7 text-right"
                                            style={{ color: deltaColor }}
                                          >
                                            {delta > 0 ? "+" : ""}
                                            {delta}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Signal Timing Pie */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Current Signal Phase</h4>
                <div className="flex items-center border rounded-lg p-4 bg-background">
                  <div className="h-[140px] w-[140px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={signalData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={30}
                          outerRadius={55}
                          cornerRadius={2}
                          paddingAngle={2}
                          isAnimationActive={false}
                          stroke="none"
                        >
                          {signalData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 pl-4 space-y-2">
                    {signalData.map((phase) => (
                      <div key={phase.name} className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: phase.color }} />
                          <span className="text-muted-foreground">{phase.name}</span>
                        </div>
                        <span className="font-medium">{phase.value}s</span>
                      </div>
                    ))}
                    <div className="pt-2 mt-2 border-t flex justify-between items-center text-xs font-semibold">
                      <span>Total Cycle</span>
                      <span>{data.intersection.signalTiming.cycleLength}s</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hourly Load Area Chart */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Load Profile (24h)</h4>
                <div className="h-48 border rounded-lg p-4 bg-background">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.hourlyLoad} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorThrough" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorLeft" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.purple} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={CHART_COLORS.purple} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} interval={3} />
                      <YAxis tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} />
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
                      <Area type="monotone" dataKey="throughVehicles" name="Through" stroke={CHART_COLORS.blue} fill="url(#colorThrough)" isAnimationActive={false} />
                      <Area type="monotone" dataKey="turningVehicles" name="Turning (L+R)" stroke={CHART_COLORS.purple} fill="url(#colorLeft)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
