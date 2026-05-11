import { useState, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTrafficSummary,
  useGetInefficiencyRankings,
  useGetZoneBreakdown,
  useGetTurnDistribution,
  useGetSignalTimingDistribution,
  useGetPeakHourLoad,
  useGetRecommendations,
  useListIntersections,
  useGetOptimizedScenario,
  getGetTrafficSummaryQueryKey,
  getGetInefficiencyRankingsQueryKey,
  getGetZoneBreakdownQueryKey,
  getGetTurnDistributionQueryKey,
  getGetSignalTimingDistributionQueryKey,
  getGetPeakHourLoadQueryKey,
  getGetRecommendationsQueryKey,
  getListIntersectionsQueryKey,
  getGetOptimizedScenarioQueryKey,
} from "@workspace/api-client-react";
import { CSVLink } from "react-csv";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, ChevronDown, Sun, Moon, Printer, Download, Map as MapIcon, Table2, TrendingUp, AlertTriangle,
  ArrowRight, Clock, ArrowUp, CornerUpLeft, CornerUpRight, Sparkles, Activity, ShieldCheck, FileText, ParkingSquare
} from "lucide-react";
import { Link } from "wouter";

import { IntersectionMap } from "../components/intersection-map";
import { OptimizationMap } from "../components/optimization-map";
import { RankingsTable } from "../components/rankings-table";
import { IntersectionDrawer } from "../components/intersection-drawer";
import { SignalSearch } from "../components/signal-search";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};

const CHART_COLOR_LIST = [
  CHART_COLORS.blue,
  CHART_COLORS.purple,
  CHART_COLORS.green,
  CHART_COLORS.red,
  CHART_COLORS.pink,
];

const SEVERITY_COLORS = {
  low: CHART_COLORS.green,
  moderate: "#eab308", // amber-500
  high: CHART_COLORS.purple,
  critical: CHART_COLORS.red,
};

const DATA_SOURCES = ["App DB", "GDOT API", "StreetLight Data"];

const INTERVAL_OPTIONS = [
  { label: "Off", ms: 0 },
  { label: "Every 30s", ms: 30 * 1000 },
  { label: "Every 60s", ms: 60 * 1000 },
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: "6px",
        padding: "10px 14px",
        border: "1px solid #e0e0e0",
        color: "#1a1a1a",
        fontSize: "13px",
      }}
    >
      <div style={{ marginBottom: "6px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
        {payload.length === 1 && payload[0].color && payload[0].color !== "#ffffff" && (
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: payload[0].color, flexShrink: 0 }} />
        )}
        {label}
      </div>
      {payload.map((entry: any, index: number) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
          {payload.length > 1 && entry.color && entry.color !== "#ffffff" && (
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: entry.color, flexShrink: 0 }} />
          )}
          <span style={{ color: "#444" }}>{entry.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600 }}>
            {typeof entry.value === "number" ? entry.value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: any) {
  if (!payload || payload.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 16px", fontSize: "13px" }}>
      {payload.map((entry: any, index: number) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: entry.color, flexShrink: 0 }} />
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function formatNumber(value: number, type: "currency" | "percent" | "compact" | "standard"): string {
  switch (type) {
    case "currency": return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
    case "percent": return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100);
    case "compact": return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    case "standard": return new Intl.NumberFormat("en-US").format(value);
  }
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [isDark, setIsDark] = useState(false);
  const [autoRefreshMs, setAutoRefreshMs] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const [selectedIntersectionId, setSelectedIntersectionId] = useState<string | null>(null);

  // Queries
  const summaryQ = useGetTrafficSummary();
  const rankingsQ = useGetInefficiencyRankings();
  const zoneQ = useGetZoneBreakdown();
  const turnDistQ = useGetTurnDistribution();
  const signalQ = useGetSignalTimingDistribution();
  const peakHourQ = useGetPeakHourLoad();
  const recsQ = useGetRecommendations();
  const mapQ = useListIntersections();
  const optimizedQ = useGetOptimizedScenario();

  const loading = summaryQ.isLoading || rankingsQ.isLoading || zoneQ.isLoading || turnDistQ.isLoading || signalQ.isLoading || peakHourQ.isLoading || recsQ.isLoading || mapQ.isLoading || optimizedQ.isLoading ||
                  summaryQ.isFetching || rankingsQ.isFetching || zoneQ.isFetching || turnDistQ.isFetching || signalQ.isFetching || peakHourQ.isFetching || recsQ.isFetching || mapQ.isFetching || optimizedQ.isFetching;

  const dataUpdatedAt = summaryQ.dataUpdatedAt;
  const lastRefreshed = dataUpdatedAt
    ? (() => {
        const d = new Date(dataUpdatedAt);
        const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
        const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `${time} on ${date}`;
      })()
    : null;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (!optimizedQ.data) return;
    if (window.location.hash === "#after-optimization") {
      requestAnimationFrame(() => {
        document
          .getElementById("after-optimization")
          ?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
      });
    }
  }, [optimizedQ.data]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (loading) {
      setIsSpinning(true);
      return;
    }
    const t = setTimeout(() => setIsSpinning(false), 600);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (autoRefreshMs === 0) return;
    const interval = setInterval(() => {
      handleRefresh();
    }, autoRefreshMs);
    return () => clearInterval(interval);
  }, [autoRefreshMs]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetTrafficSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInefficiencyRankingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetZoneBreakdownQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTurnDistributionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSignalTimingDistributionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPeakHourLoadQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecommendationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListIntersectionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOptimizedScenarioQueryKey() });
  };

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";
  const buttonBg = isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2";
  const buttonFg = isDark ? "#c8c9cc" : "#4b5563";

  return (
    <div className="min-h-[100dvh] bg-background px-5 py-4 pt-[32px] pb-[32px] pl-[24px] pr-[24px]">
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="pt-2">
            <h1 className="font-bold text-[32px] tracking-tight">Atlanta Traffic Inefficiency Analyzer</h1>
            <p className="text-muted-foreground mt-1.5 text-[14px]">Rush-hour transportation analytics for signalized intersections — calibrated to AM/PM peak demand</p>
            
            {DATA_SOURCES.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[12px] text-muted-foreground shrink-0">
                  Data Sources:
                </span>
                {DATA_SOURCES.map((source) => (
                  <span
                    key={source}
                    className="text-[12px] font-bold rounded px-2 py-0.5 truncate print:!bg-[rgb(229,231,235)] print:!text-[rgb(75,85,99)]"
                    title={source}
                    style={{
                      maxWidth: "20ch",
                      backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgb(229, 231, 235)",
                      color: isDark ? "#c8c9cc" : "rgb(75, 85, 99)",
                    }}
                  >
                    {source}
                  </span>
                ))}
              </div>
            )}
            
            {lastRefreshed && <p className="text-[12px] text-muted-foreground mt-3">Last refresh: {lastRefreshed}</p>}
          </div>
          
          <div className="flex items-center gap-3 pt-2 print:hidden">
            <Link
              href="/live-traffic"
              data-testid="link-live-traffic"
              className="flex items-center gap-1.5 px-3 h-[26px] text-[12px] font-medium rounded-[6px] bg-gradient-to-r from-emerald-600 to-amber-600 text-white hover:from-emerald-700 hover:to-amber-700 transition-all shadow-sm"
              title="Live Atlanta traffic colors (Apple-Maps style)"
            >
              <Activity className="w-3.5 h-3.5" />
              Live Traffic
            </Link>
            <Link
              href="/tomorrow"
              data-testid="link-tomorrow"
              className="flex items-center gap-1.5 px-3 h-[26px] text-[12px] font-medium rounded-[6px] bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 transition-all shadow-sm"
              title="Predict tomorrow's traffic"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Predict Tomorrow
            </Link>
            <Link
              href="/backtest"
              data-testid="link-backtest"
              className="flex items-center gap-1.5 px-3 h-[26px] text-[12px] font-medium rounded-[6px] bg-gradient-to-r from-slate-700 to-slate-900 text-white hover:from-slate-800 hover:to-black transition-all shadow-sm"
              title="Audit-grade backtest credibility report"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Backtest Report
            </Link>
            <Link
              href="/parking"
              data-testid="link-parking"
              className="flex items-center gap-1.5 px-3 h-[26px] text-[12px] font-medium rounded-[6px] bg-gradient-to-r from-sky-600 to-cyan-600 text-white hover:from-sky-700 hover:to-cyan-700 transition-all shadow-sm"
              title="Metro-Atlanta parking pressure map"
            >
              <ParkingSquare className="w-3.5 h-3.5" />
              Parking
            </Link>
            <Link
              href="/exec-summary"
              data-testid="link-exec-summary"
              className="flex items-center gap-1.5 px-3 h-[26px] text-[12px] font-medium rounded-[6px] bg-gradient-to-r from-stone-600 to-stone-800 text-white hover:from-stone-700 hover:to-stone-900 transition-all shadow-sm"
              title="Printable one-page executive summary"
            >
              <FileText className="w-3.5 h-3.5" />
              Exec Summary
            </Link>
            <div className="relative" ref={dropdownRef}>
              <div
                className="flex items-center rounded-[6px] overflow-hidden h-[26px] text-[12px]"
                style={{ backgroundColor: buttonBg, color: buttonFg }}
              >
                <button onClick={handleRefresh} disabled={loading} className="flex items-center gap-1 px-2 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <div className="w-px h-4 shrink-0" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }} />
                <button onClick={() => setDropdownOpen((o) => !o)} className="flex items-center justify-center px-1.5 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              {dropdownOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-popover border border-border rounded-md shadow-md z-50 py-1">
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">Auto-refresh</div>
                  {INTERVAL_OPTIONS.map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => { setAutoRefreshMs(opt.ms); setDropdownOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center justify-between"
                    >
                      <span>{opt.label}</span>
                      {autoRefreshMs === opt.ms && <div className="w-2 h-2 rounded-full bg-green-500" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <button
              onClick={() => window.print()}
              disabled={loading}
              className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: buttonBg, color: buttonFg }}
              aria-label="Export as PDF"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsDark((d) => !d)}
              className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors"
              style={{ backgroundColor: buttonBg, color: buttonFg }}
              aria-label="Toggle dark mode"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6 print:hidden">
          <SignalSearch
            intersections={mapQ.data || []}
            signalChanges={optimizedQ.data?.signalChanges}
            onSelect={setSelectedIntersectionId}
          />
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          <Card>
            <CardContent className="p-5 flex flex-col justify-center">
              <p className="text-sm text-muted-foreground font-medium mb-1">Intersections Monitored</p>
              {loading ? <Skeleton className="h-8 w-20" /> : (
                <p className="text-3xl font-bold" style={{ color: CHART_COLORS.blue }}>
                  {formatNumber(summaryQ.data?.intersectionCount || 0, "standard")}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex flex-col justify-center">
              <p className="text-sm text-muted-foreground font-medium mb-1">Total Daily Vehicles</p>
              {loading ? <Skeleton className="h-8 w-28" /> : (
                <p className="text-3xl font-bold" style={{ color: CHART_COLORS.blue }}>
                  {formatNumber(summaryQ.data?.totalDailyVehicles || 0, "standard")}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex flex-col justify-center">
              <p className="text-sm text-muted-foreground font-medium mb-1">Turning Movements / Hr</p>
              {loading ? <Skeleton className="h-8 w-24" /> : (
                <p className="text-3xl font-bold" style={{ color: CHART_COLORS.blue }}>
                  {formatNumber(summaryQ.data?.totalTurningMovementsPerHour || 0, "standard")}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex flex-col justify-center">
              <p className="text-sm text-muted-foreground font-medium mb-1">Avg Inefficiency</p>
              {loading ? <Skeleton className="h-8 w-16" /> : (
                <p className="text-3xl font-bold" style={{ color: CHART_COLORS.blue }}>
                  {summaryQ.data?.averageInefficiency?.toFixed(1) || "0.0"}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex flex-col justify-center">
              <p className="text-sm text-muted-foreground font-medium mb-1">Critical Intersections</p>
              {loading ? <Skeleton className="h-8 w-16" /> : (
                <div className="flex items-center gap-2">
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.red }}>
                    {summaryQ.data?.criticalCount || 0}
                  </p>
                  {(summaryQ.data?.criticalCount || 0) > 0 && (
                    <AlertTriangle className="w-5 h-5" style={{ color: CHART_COLORS.red }} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-primary/20 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
            <CardContent className="p-5 flex flex-col justify-center h-full">
              <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">Worst Intersection</p>
              {loading ? (
                <>
                  <Skeleton className="h-5 w-32 mb-1" />
                  <Skeleton className="h-6 w-16" />
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold truncate" title={summaryQ.data?.worstIntersectionName}>
                    {summaryQ.data?.worstIntersectionName || "N/A"}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 rounded-sm px-1.5 py-0">
                      Score: {summaryQ.data?.worstIntersectionScore || 0}
                    </Badge>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Row: Map & Rankings */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
          {/* Map */}
          <Card className="lg:col-span-8 flex flex-col">
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapIcon className="w-4 h-4 text-muted-foreground" />
                Atlanta Metro Live Map
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 relative min-h-[520px] rounded-b-lg overflow-hidden border-t">
              {loading && !mapQ.data ? (
                <div className="absolute inset-0 bg-muted/20 flex items-center justify-center z-10">
                  <Skeleton className="w-full h-full rounded-none" />
                </div>
              ) : (
                <IntersectionMap 
                  intersections={mapQ.data || []} 
                  onSelect={setSelectedIntersectionId} 
                  isDark={isDark}
                />
              )}
            </CardContent>
          </Card>

          {/* Rankings Bar Chart */}
          <Card className="lg:col-span-4 flex flex-col">
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                Worst Inefficiency Scores
              </CardTitle>
              {!loading && rankingsQ.data && rankingsQ.data.length > 0 && (
                <CSVLink data={rankingsQ.data} filename="inefficiency-rankings.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: buttonBg, color: buttonFg }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="p-5 pt-0 flex-1 flex flex-col">
              {loading ? <Skeleton className="w-full h-full min-h-[400px]" /> : (
                <div className="flex-1 min-h-[450px]">
                  <ResponsiveContainer width="100%" height="100%" debounce={0}>
                    <BarChart data={rankingsQ.data || []} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridColor} />
                      <XAxis type="number" hide />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        tick={{ fontSize: 11, fill: tickColor }} 
                        stroke={tickColor}
                        width={120}
                        tickFormatter={(val) => val.length > 15 ? val.substring(0, 15) + '...' : val}
                      />
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                      <Bar 
                        dataKey="inefficiencyScore" 
                        name="Inefficiency Score"
                        radius={[0, 4, 4, 0]}
                        isAnimationActive={false}
                        onClick={(data) => {
                          if (data && data.id) setSelectedIntersectionId(data.id);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {(rankingsQ.data || []).map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={SEVERITY_COLORS[entry.severity as keyof typeof SEVERITY_COLORS] || CHART_COLORS.blue} 
                            fillOpacity={0.85}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2 text-center">Click bars to view details</p>
            </CardContent>
          </Card>
        </div>

        {/* Middle Row: Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {/* Peak Hour Area Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  24-Hour Load Profile
                </CardTitle>
                <CardDescription className="text-xs mt-1">Aggregated congestion vs all turning-movement volume</CardDescription>
              </div>
              {!loading && peakHourQ.data && peakHourQ.data.length > 0 && (
                <CSVLink data={peakHourQ.data} filename="peak-hour-load.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: buttonBg, color: buttonFg }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="p-5 pt-2">
              {loading ? <Skeleton className="w-full h-[300px]" /> : (
                <ResponsiveContainer width="100%" height={300} debounce={0}>
                  <ComposedChart data={peakHourQ.data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradientCongestion" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} interval={2} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ stroke: tickColor, strokeDasharray: '3 3' }} />
                    <Legend content={<CustomLegend />} wrapperStyle={{ paddingTop: '10px' }} />
                    <Area 
                      yAxisId="left" 
                      type="monotone" 
                      dataKey="congestionIndex" 
                      name="Congestion Index" 
                      stroke={CHART_COLORS.blue} 
                      fill="url(#gradientCongestion)" 
                      strokeWidth={2} 
                      isAnimationActive={false} 
                    />
                    <Line 
                      yAxisId="right" 
                      type="monotone" 
                      dataKey="turningVehicles" 
                      name="Turning Vol (L+R)" 
                      stroke={CHART_COLORS.purple} 
                      strokeWidth={2} 
                      dot={false} 
                      activeDot={{ r: 4 }} 
                      isAnimationActive={false} 
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Movement Type Pie Chart */}
          <Card>
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Movement Mix</CardTitle>
                <CardDescription className="text-xs mt-1">Share of through, left, and right movements</CardDescription>
              </div>
              {!loading && turnDistQ.data && turnDistQ.data.length > 0 && (
                <CSVLink data={turnDistQ.data} filename="movement-mix.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: buttonBg, color: buttonFg }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="p-5 pt-0">
              {loading ? <Skeleton className="w-full h-[300px]" /> : (
                <div className="flex flex-col h-[300px]">
                  <ResponsiveContainer width="100%" height="100%" debounce={0}>
                    <PieChart>
                      <Pie 
                        data={turnDistQ.data || []} 
                        dataKey="totalVehicles" 
                        nameKey="label" 
                        cx="50%" 
                        cy="45%" 
                        innerRadius={60}
                        outerRadius={90} 
                        cornerRadius={2} 
                        paddingAngle={2} 
                        isAnimationActive={false} 
                        stroke="none"
                      >
                        {(turnDistQ.data || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend below pie manually since it's a donut */}
                  <div className="flex flex-wrap justify-center gap-3 mt-auto">
                    {(turnDistQ.data || []).map((entry, index) => (
                      <div key={index} className="flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CHART_COLOR_LIST[index % CHART_COLOR_LIST.length] }} />
                        <span className="text-muted-foreground">{entry.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Movement-Specific Sections: Straight, Left, Right */}
        <div className="mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">Movement-Specific Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-1">Per-movement volumes and the intersections where each movement type is the binding constraint</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {(["through", "left", "right"] as const).map((key) => {
            const meta = ({
              through: {
                label: "Straight Ahead",
                sub: "Through movements (NB+SB+EB+WB)",
                icon: <ArrowUp className="w-5 h-5" />,
                color: CHART_COLORS.blue,
                matcher: (s: string) => /through|thru/i.test(s),
                emptyMsg: "Even at peak rush-hour demand, no signals are through-bottlenecked — dedicated through lanes on both N/S and E/W approaches keep capacity ahead of demand.",
              },
              left: {
                label: "Left Turns",
                sub: "Protected left-turn movements",
                icon: <CornerUpLeft className="w-5 h-5" />,
                color: CHART_COLORS.purple,
                matcher: (s: string) => /left/i.test(s),
                emptyMsg: "No signals are bottlenecked on left turns.",
              },
              right: {
                label: "Right Turns",
                sub: "Right-turn movements (with RTOR credit)",
                icon: <CornerUpRight className="w-5 h-5" />,
                color: CHART_COLORS.green,
                matcher: (s: string) => /right/i.test(s),
                emptyMsg: "No signals are constrained by right turns — RTOR (right-on-red) provides ample release across the network.",
              },
            } as const)[key];

            const dist = turnDistQ.data?.find((d) => d.movement === key);
            const totalAll = (turnDistQ.data || []).reduce((s, d) => s + d.totalVehicles, 0);
            const sharePct = dist && totalAll > 0 ? Math.round((dist.totalVehicles / totalAll) * 1000) / 10 : 0;
            const bottlenecks = (rankingsQ.data || [])
              .filter((r) => meta.matcher(r.worstMovement || ""))
              .slice(0, 5);

            return (
              <Card key={key} className="relative overflow-hidden flex flex-col">
                <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: meta.color }} />
                <CardHeader className="pb-3 pl-6">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                    >
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base">{meta.label}</CardTitle>
                      <CardDescription className="text-xs mt-0.5 truncate">{meta.sub}</CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className="ml-auto shrink-0"
                      style={{ borderColor: `${meta.color}55`, color: meta.color, backgroundColor: `${meta.color}10` }}
                    >
                      {sharePct}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pl-6 flex-1 flex flex-col">
                  {loading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                          <p className="text-[11px] uppercase text-muted-foreground tracking-wider mb-1">Total / hr</p>
                          <p className="text-2xl font-bold" style={{ color: meta.color }}>
                            {formatNumber(dist?.totalVehicles || 0, "compact")}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatNumber(dist?.totalVehicles || 0, "standard")} vph
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase text-muted-foreground tracking-wider mb-1">Avg / signal</p>
                          <p className="text-2xl font-bold">
                            {formatNumber(dist?.avgPerIntersection || 0, "standard")}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">vph per intersection</p>
                        </div>
                      </div>
                      <div className="border-t pt-3 flex-1">
                        <p className="text-[11px] font-medium uppercase text-muted-foreground tracking-wider mb-2">
                          Bottleneck signals ({bottlenecks.length})
                        </p>
                        {bottlenecks.length === 0 ? (
                          <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-3 text-[11px] text-green-800 dark:text-green-300 leading-relaxed">
                            {meta.emptyMsg}
                          </div>
                        ) : (
                          <ul className="space-y-1">
                            {bottlenecks.map((b) => (
                              <li
                                key={b.id}
                                className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                                onClick={() => setSelectedIntersectionId(b.id)}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium">{b.name}</p>
                                  <p className="text-[10px] text-muted-foreground truncate">{b.zone} · {b.worstMovement}</p>
                                </div>
                                <Badge
                                  className="shrink-0 font-semibold"
                                  style={{ backgroundColor: meta.color, color: "#fff", border: "none" }}
                                >
                                  {b.inefficiencyScore}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Zone Breakdown */}
          <Card>
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Zone Analysis</CardTitle>
              {!loading && zoneQ.data && zoneQ.data.length > 0 && (
                <CSVLink data={zoneQ.data} filename="zone-breakdown.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: buttonBg, color: buttonFg }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="p-5 pt-2">
              {loading ? <Skeleton className="w-full h-[300px]" /> : (
                <ResponsiveContainer width="100%" height={300} debounce={0}>
                  <ComposedChart data={zoneQ.data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="zone" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                    <Legend content={<CustomLegend />} />
                    <Bar yAxisId="left" dataKey="totalTurningMovements" name="Turning Movements" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="avgInefficiency" name="Avg Inefficiency" stroke={CHART_COLORS.pink} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Signal Timing Stacked Bar */}
          <Card>
            <CardHeader className="px-5 pt-5 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Signal Phase Breakdown</CardTitle>
              {!loading && signalQ.data && signalQ.data.length > 0 && (
                <CSVLink data={signalQ.data} filename="signal-timing.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: buttonBg, color: buttonFg }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent className="p-5 pt-2">
              {loading ? <Skeleton className="w-full h-[300px]" /> : (
                <ResponsiveContainer width="100%" height={300} debounce={0}>
                  <BarChart data={(signalQ.data || []).slice(0, 15)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} tickFormatter={(val) => val.split(' & ')[0] || val} />
                    <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                    <Legend content={<CustomLegend />} />
                    <Bar dataKey="nsGreen" name="N/S Green" stackId="a" fill={CHART_COLORS.green} fillOpacity={0.8} isAnimationActive={false} />
                    <Bar dataKey="ewGreen" name="E/W Green" stackId="a" fill={CHART_COLORS.blue} fillOpacity={0.8} isAnimationActive={false} />
                    <Bar dataKey="protectedLeft" name="Protected Left" stackId="a" fill={CHART_COLORS.purple} fillOpacity={0.8} isAnimationActive={false} />
                    <Bar dataKey="allRed" name="All Red" stackId="a" fill={CHART_COLORS.red} fillOpacity={0.8} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Area: Detail Table & Recommendations */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="px-5 pt-5 pb-2 border-b">
              <CardTitle className="text-base flex items-center gap-2">
                <Table2 className="w-4 h-4 text-muted-foreground" />
                Intersection Detail Table
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading && !rankingsQ.data ? (
                <div className="p-5 space-y-3">
                  <Skeleton className="h-10 w-full" />
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                <RankingsTable data={rankingsQ.data || []} onRowClick={setSelectedIntersectionId} />
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col h-full max-h-[600px]">
            <CardHeader className="px-5 pt-5 pb-2 border-b">
              <CardTitle className="text-base flex items-center gap-2">
                Recommendations
              </CardTitle>
              <CardDescription className="text-xs">Optimizations for worst performers</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto flex-1">
              {loading ? (
                <div className="p-5 space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="border rounded-md p-4 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ))}
                </div>
              ) : recsQ.data && recsQ.data.length > 0 ? (
                <div className="p-4 space-y-4">
                  {recsQ.data.map((rec) => (
                    <div 
                      key={rec.intersectionId} 
                      className="border rounded-lg p-4 bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => setSelectedIntersectionId(rec.intersectionId)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-semibold text-sm">{rec.intersectionName}</h4>
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-200 dark:border-green-800 shrink-0 ml-2">
                          -{rec.estimatedDelayReductionSeconds}s delay
                        </Badge>
                      </div>
                      
                      <div className="mb-2 flex items-center gap-1.5 text-[11px]">
                        <span className="text-muted-foreground">Bottleneck:</span>
                        <Badge variant="outline" className="px-1.5 py-0 h-4 text-[10px] font-medium">
                          {rec.targetMovement}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-3 bg-background border rounded-md p-2 text-xs">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground mb-1">{rec.targetPhase}</span>
                          <div className="flex items-center gap-1 font-medium">
                            <span>{rec.currentPhaseSeconds}s</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <span className="text-primary">{rec.suggestedPhaseSeconds}s</span>
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground mb-1">Cycle Length</span>
                          <div className="flex items-center gap-1 font-medium">
                            <span>{rec.currentCycleLength}s</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <span className="text-primary">{rec.suggestedCycleLength}s</span>
                          </div>
                        </div>
                      </div>
                      
                      <p className="text-[13px] text-muted-foreground leading-relaxed">{rec.rationale}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  No recommendations available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ==================== POST-OPTIMIZATION SCENARIO ==================== */}
        <div id="after-optimization" className="mt-12 pt-10 border-t-2 border-dashed border-border scroll-mt-4">
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[11px] font-bold tracking-wider uppercase rounded px-2 py-0.5"
                style={{ backgroundColor: CHART_COLORS.green, color: "#fff" }}
              >
                Simulation
              </span>
              <h2 className="text-[24px] font-bold tracking-tight">After Optimization</h2>
            </div>
            <p className="text-muted-foreground text-[14px] max-w-3xl">
              Same metro, same algorithm, same rush-hour demand — but every signal in the network
              has been retimed to its algorithmic suggestion. Each intersection is then re-scored
              through the identical pipeline so the comparison is apples-to-apples.
            </p>
            <p className="text-muted-foreground text-[12px] max-w-3xl mt-2 italic">
              Note: average Webster delay barely moves because longer cycles trade some uniform
              delay for less spillback — the real win is in <span className="not-italic font-medium">capacity
              recovered at the binding constraint</span> (worst-movement v/c down ~14%) and
              hundreds of signals leaving the high/critical bands. Eliminating gridlock is more
              valuable than shaving 1s off the network average.
            </p>
          </div>

          {/* Hero comparison card */}
          <Card className="mb-6">
            <CardContent className="p-6">
              {loading || !optimizedQ.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {(() => {
                    const c = optimizedQ.data.comparison;
                    const scoreDelta = c.avgInefficiencyBefore - c.avgInefficiencyAfter;
                    const scorePct = (scoreDelta / c.avgInefficiencyBefore) * 100;
                    const critDelta = c.criticalBefore - c.criticalAfter;
                    const critPct = c.criticalBefore > 0 ? (critDelta / c.criticalBefore) * 100 : 0;
                    const highDelta = c.highBefore - c.highAfter;
                    const highPct = c.highBefore > 0 ? (highDelta / c.highBefore) * 100 : 0;
                    return (
                      <>
                        <div>
                          <p className="text-[12px] text-muted-foreground font-medium mb-1">Avg Inefficiency</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                              {c.avgInefficiencyAfter.toFixed(1)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              from {c.avgInefficiencyBefore.toFixed(1)}
                            </span>
                          </div>
                          <p className="text-[12px] mt-1" style={{ color: scoreDelta > 0 ? CHART_COLORS.green : CHART_COLORS.red }}>
                            {scoreDelta > 0 ? "▼" : "▲"} {Math.abs(scoreDelta).toFixed(1)} pts ({scorePct.toFixed(0)}% better)
                          </p>
                        </div>
                        <div>
                          <p className="text-[12px] text-muted-foreground font-medium mb-1">Critical Signals</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                              {formatNumber(c.criticalAfter, "standard")}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              from {formatNumber(c.criticalBefore, "standard")}
                            </span>
                          </div>
                          <p className="text-[12px] mt-1" style={{ color: CHART_COLORS.green }}>
                            ▼ {formatNumber(critDelta, "standard")} fewer ({critPct.toFixed(0)}% drop)
                          </p>
                        </div>
                        <div>
                          <p className="text-[12px] text-muted-foreground font-medium mb-1">High-Stress Signals</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                              {formatNumber(c.highAfter, "standard")}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              from {formatNumber(c.highBefore, "standard")}
                            </span>
                          </div>
                          <p className="text-[12px] mt-1" style={{ color: CHART_COLORS.green }}>
                            ▼ {formatNumber(highDelta, "standard")} fewer ({highPct.toFixed(0)}% drop)
                          </p>
                        </div>
                        <div>
                          <p className="text-[12px] text-muted-foreground font-medium mb-1">Bottleneck Signals Eliminated</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                              {formatNumber(c.bottlenecksEliminated, "standard")}
                            </span>
                            <span className="text-sm text-muted-foreground">signals</span>
                          </div>
                          <p className="text-[12px] mt-1 text-muted-foreground">
                            moved out of high / critical bands
                            {" · "}avg worst v/c
                            <span style={{ color: CHART_COLORS.green, fontWeight: 600 }}>
                              {" "}-{(c.avgWorstVcReductionPct ?? 0).toFixed(1)}%
                            </span>
                          </p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* KPI strip mirroring the top of the dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <Card>
              <CardContent className="p-5 flex flex-col justify-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Intersections Monitored</p>
                {loading ? <Skeleton className="h-8 w-20" /> : (
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                    {formatNumber(optimizedQ.data?.summary.intersectionCount || 0, "standard")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col justify-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Total Daily Vehicles</p>
                {loading ? <Skeleton className="h-8 w-28" /> : (
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                    {formatNumber(optimizedQ.data?.summary.totalDailyVehicles || 0, "standard")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col justify-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Turning Movements / Hr</p>
                {loading ? <Skeleton className="h-8 w-24" /> : (
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                    {formatNumber(optimizedQ.data?.summary.totalTurningMovementsPerHour || 0, "standard")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col justify-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Avg Inefficiency</p>
                {loading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                    {optimizedQ.data?.summary.averageInefficiency?.toFixed(1) || "0.0"}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col justify-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Critical Intersections</p>
                {loading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                    {formatNumber(optimizedQ.data?.summary.criticalCount || 0, "standard")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col justify-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Avg Delay (sec)</p>
                {loading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.green }}>
                    {optimizedQ.data?.summary.averageDelaySeconds?.toFixed(1) || "0.0"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Map + Worst Inefficiency Scores side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MapIcon className="w-4 h-4" /> Improvement Map
                </CardTitle>
                <CardDescription>
                  Each signal colored by its inefficiency-score drop. Click any dot to see the
                  exact timing changes (N/S green, E/W green, protected left, cycle length) and
                  the v/c improvement.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0" style={{ height: 480 }}>
                {loading || !optimizedQ.data ? (
                  <Skeleton className="h-[480px] w-full" />
                ) : (
                  <OptimizationMap
                    changes={optimizedQ.data.signalChanges}
                    isDark={isDark}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Top 30 Worst After Retiming
                </CardTitle>
                <CardDescription>Even the worst remaining signals are far less stressed than before.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {loading || !optimizedQ.data ? (
                  <Skeleton className="h-[400px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart
                      data={optimizedQ.data.rankings.slice(0, 30).map((r, idx) => ({ ...r, rank: idx + 1 }))}
                      layout="vertical"
                      margin={{ top: 5, right: 25, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: tickColor }} />
                      <YAxis
                        type="category"
                        dataKey="rank"
                        width={32}
                        tick={{ fontSize: 11, fill: tickColor }}
                        tickFormatter={(v) => `#${v}`}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="inefficiencyScore" name="Inefficiency Score" radius={[0, 4, 4, 0]}>
                        {optimizedQ.data.rankings.slice(0, 30).map((r, idx) => (
                          <Cell key={idx} fill={SEVERITY_COLORS[r.severity]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Movement Mix + Severity counts side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Movement Mix (unchanged)</CardTitle>
                <CardDescription>
                  Demand doesn't change — only signal capacity does. Mix shown for completeness.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {loading || !optimizedQ.data ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={optimizedQ.data.turnDistribution}
                        dataKey="totalVehicles"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={(e: any) => `${e.label}: ${formatNumber(e.totalVehicles, "compact")}`}
                      >
                        {optimizedQ.data.turnDistribution.map((_, idx) => (
                          <Cell key={idx} fill={CHART_COLOR_LIST[idx % CHART_COLOR_LIST.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Severity Distribution
                </CardTitle>
                <CardDescription>Count of signals in each severity band — before vs after.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                {loading || !optimizedQ.data ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        { band: "Low",      Before: optimizedQ.data.comparison.lowBefore,      After: optimizedQ.data.comparison.lowAfter },
                        { band: "Moderate", Before: optimizedQ.data.comparison.moderateBefore, After: optimizedQ.data.comparison.moderateAfter },
                        { band: "High",     Before: optimizedQ.data.comparison.highBefore,     After: optimizedQ.data.comparison.highAfter },
                        { band: "Critical", Before: optimizedQ.data.comparison.criticalBefore, After: optimizedQ.data.comparison.criticalAfter },
                      ]}
                      margin={{ top: 5, right: 25, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="band" tick={{ fontSize: 12, fill: tickColor }} />
                      <YAxis tick={{ fontSize: 11, fill: tickColor }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend content={<CustomLegend />} />
                      <Bar dataKey="Before" fill={CHART_COLORS.red} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="After" fill={CHART_COLORS.green} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Movement-Specific Breakdown — bottleneck shifts after retiming */}
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            Movement-Specific Bottlenecks (After)
          </h3>
          <p className="text-[13px] text-muted-foreground mb-4 max-w-3xl">
            With more green time given to lefts, the binding constraint at many signals shifts to
            through or right movements. The cards below count which movement is now the bottleneck
            at each signal.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
            {[
              { label: "Through", icon: ArrowUp, key: "Through" },
              { label: "Left", icon: CornerUpLeft, key: "Left" },
              { label: "Right", icon: CornerUpRight, key: "Right" },
            ].map(({ label, icon: Icon, key }) => {
              const matches = optimizedQ.data?.rankings.filter((r) =>
                r.worstMovement.includes(key),
              ) ?? [];
              const totalRanked = optimizedQ.data?.rankings.length ?? 0;
              const sharePct = totalRanked > 0 ? (matches.length / totalRanked) * 100 : 0;
              return (
                <Card key={label}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Icon className="w-4 h-4" /> {label} bottleneck
                    </CardTitle>
                    <CardDescription>
                      {loading
                        ? "—"
                        : `${matches.length} of top ${totalRanked} (${sharePct.toFixed(0)}%)`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 pb-4">
                    {loading || !optimizedQ.data ? (
                      <Skeleton className="h-40 w-full mx-4" />
                    ) : matches.length === 0 ? (
                      <div className="px-4 text-sm text-muted-foreground">
                        No {label.toLowerCase()} bottlenecks in the top {totalRanked} after optimization.
                      </div>
                    ) : (
                      <div className="max-h-[200px] overflow-y-auto px-2">
                        {matches.slice(0, 8).map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setSelectedIntersectionId(r.id)}
                            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted text-left text-[12px]"
                          >
                            <div className="flex flex-col min-w-0">
                              <span className="truncate font-medium">{r.name}</span>
                              <span className="text-muted-foreground text-[11px]">
                                {r.zone} · {r.worstMovement}
                              </span>
                            </div>
                            <Badge
                              style={{ backgroundColor: SEVERITY_COLORS[r.severity], color: "#fff" }}
                              className="text-[10px] shrink-0 ml-2"
                            >
                              {r.inefficiencyScore.toFixed(0)}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
        {/* ==================== END POST-OPTIMIZATION ==================== */}

      </div>

      <IntersectionDrawer 
        intersectionId={selectedIntersectionId} 
        onClose={() => setSelectedIntersectionId(null)}
        onNavigate={setSelectedIntersectionId}
        siblings={(rankingsQ.data || []).map((r) => r.id)}
        signalChanges={optimizedQ.data?.signalChanges}
        isDark={isDark}
      />
    </div>
  );
}
