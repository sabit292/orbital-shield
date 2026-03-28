import React from "react";
import { Panel } from "@/components/ui/panel";
import { Gauge } from "@/components/ui/gauge";
import { cn, formatDate } from "@/lib/utils";
import { motion } from "framer-motion";
import { 
  Activity, Zap, ShieldAlert, Radio, Plane, 
  Heart, Database, Wifi, Shield, ArrowUpRight, 
  ArrowDownRight, ArrowRight, Sun, Thermometer,
  Wind, Navigation, AlertTriangle
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import type { 
  SpaceWeatherData, AIPrediction, InfrastructureRisk, 
  HistoricalData, AlertsResponse, AuroraForecast 
} from "@workspace/api-client-react/src/generated/api.schemas";

// ─── HELPERS ───────────────────────────────────────────────────────────────
function DeltaBadge({ delta }: { delta: number }) {
  if (Math.abs(delta) < 2) return null;
  const rising = delta > 0;
  return (
    <span className={cn(
      "text-[9px] font-mono px-1 py-0.5 rounded-sm ml-1",
      rising ? "bg-danger/20 text-danger" : "bg-success/20 text-success"
    )}>
      {rising ? "▲" : "▼"}{Math.abs(delta)}%
    </span>
  );
}

// --- KP INDEX CARD ---
export function KpCard({ data, pred }: { data?: SpaceWeatherData; pred?: AIPrediction }) {
  if (!data) return <Panel title="GEZEGEN K-ENDEKSİ" className="min-h-[200px]" />;
  
  const getKpColor = (kp: number) => {
    if (kp < 4) return "text-success text-glow-green";
    if (kp < 6) return "text-warning shadow-warning";
    return "text-danger text-glow-red";
  };
  
  const getGlowColor = (kp: number) => {
    if (kp < 4) return "green";
    if (kp < 6) return "orange";
    return "red";
  };

  return (
    <Panel 
      title="GEZEGEN K-ENDEKSİ" 
      icon={<Activity className="w-4 h-4" />}
      glowColor={getGlowColor(data.kpIndex)}
      className="relative overflow-hidden"
    >
      <div className="flex flex-col items-center justify-center py-4">
        <div className="flex items-baseline justify-center gap-2">
          <motion.span 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            key={data.kpIndex}
            className={cn("font-mono text-7xl font-bold leading-none", getKpColor(data.kpIndex))}
          >
            {data.kpIndex.toFixed(1)}
          </motion.span>
          <span className="font-display text-xl text-muted-foreground">Kp</span>
        </div>
        
        <div className="mt-4 flex items-center gap-3">
          <span className={cn("px-3 py-1 rounded-sm text-xs font-display font-bold uppercase tracking-wider border", 
            data.kpIndex < 4 ? "bg-success/10 border-success/30 text-success" :
            data.kpIndex < 6 ? "bg-warning/10 border-warning/30 text-warning" :
            "bg-danger/10 border-danger/30 text-danger"
          )}>
            {data.kpCategory}
          </span>
          
          {pred && (
            <div className="flex items-center gap-1 text-sm font-mono text-primary bg-primary/10 px-2 py-1 border border-primary/20 rounded-sm">
              Tahmin: {pred.kpPredicted1h.toFixed(1)}
              {pred.trend === "RISING" && <ArrowUpRight className="w-3 h-3 text-danger" />}
              {pred.trend === "FALLING" && <ArrowDownRight className="w-3 h-3 text-success" />}
              {pred.trend === "STABLE" && <ArrowRight className="w-3 h-3 text-primary" />}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// --- AI INSIGHT CARD ---
// ── Physics engine (used by AI card) ─────────────────────────────────────────
function physicsCalc(
  V: number, Bz: number, n: number, Kp: number,
  Dst: number, Fluxp: number, dBzdt: number
) {
  // F = V^1.5 · |Bz|^1.2 · n^0.3 · (1 + 0.5·|dBz/dt|)
  const F = Math.pow(V, 1.5) * Math.pow(Math.max(Math.abs(Bz), 0.01), 1.2)
          * Math.pow(Math.max(n, 0.01), 0.3) * (1 + 0.5 * Math.abs(dBzdt));

  // GPSrisk = 0.5·(|Bz|/20) + 0.3·(V/1000) + 0.2·(Kp/9)
  const gpsR = 0.5 * (Math.abs(Bz) / 20) + 0.3 * (V / 1000) + 0.2 * (Kp / 9);

  // SATrisk = 0.4·(Pd/50) + 0.4·(Fluxp/1000) + 0.2·(|Dst|/200)
  // Pd (nPa) = 1.67e-6 · n · V²
  const Pd  = 1.67e-6 * n * V * V;
  const satR = 0.4 * (Pd / 50) + 0.4 * (Math.max(Fluxp, 0) / 1000) + 0.2 * (Math.abs(Dst) / 200);

  const fmtF = (f: number) =>
    f >= 1e6 ? (f / 1e6).toFixed(2) + "M" : f >= 1e3 ? (f / 1e3).toFixed(1) + "k" : f.toFixed(0);

  const fLvl = F < 80_000 ? "success" : F < 400_000 ? "warning" : "danger";
  const gLvl = gpsR < 0.25 ? "success" : gpsR < 0.50 ? "warning" : "danger";
  const sLvl = satR < 0.25 ? "success" : satR < 0.50 ? "warning" : "danger";

  return { F, fmtF: fmtF(F), gpsR, satR, Pd, fLvl, gLvl, sLvl };
}

function PhysiBar({ label, pct, lvl }: { label: string; pct: number; lvl: string }) {
  const bar = lvl === "danger" ? "bg-danger" : lvl === "warning" ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-mono text-muted-foreground w-[72px] shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <span className={cn("text-[9px] font-mono w-8 text-right shrink-0",
        lvl === "danger" ? "text-danger" : lvl === "warning" ? "text-warning" : "text-success"
      )}>{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}

export function AiInsightCard({ pred, data }: { pred?: AIPrediction; data?: SpaceWeatherData }) {
  if (!pred) return <Panel title="YAPAY ZEKA ANALİZİ" className="min-h-[150px]" />;

  const getRiskColor = (level: string) => {
    if (level === "LOW") return "text-success border-success/30 bg-success/10";
    if (level === "MODERATE") return "text-warning border-warning/30 bg-warning/10";
    return "text-danger border-danger/30 bg-danger/10";
  };
  const riskTr = (level: string) =>
    level === "LOW" ? "DÜŞÜK" : level === "MODERATE" ? "ORTA" : level === "HIGH" ? "YÜKSEK" : "KRİTİK";
  const trendTr = (t?: string) =>
    t === "RISING" ? "↑ ARTIYOR" : t === "FALLING" ? "↓ AZALIYOR" : "→ STABIL";
  const trendClr = (t?: string) =>
    t === "RISING" ? "text-danger" : t === "FALLING" ? "text-success" : "text-primary";

  // Physics calculations from real NOAA data
  const phy = data ? physicsCalc(
    data.solarWind.speed,
    data.magneticField.bz,
    data.solarWind.density,
    data.kpIndex,
    data.dstIndex ?? 0,
    data.protonFlux ?? 5,
    0   // dBzdt — single snapshot, 0 default
  ) : null;

  return (
    <Panel title="YAPAY ZEKA ANALİZİ" icon={<Zap className="w-4 h-4 text-accent" />}>
      <div className="space-y-3">
        {/* Insight text */}
        <p className="font-mono text-[11px] leading-relaxed text-primary/90 border-l-2 border-accent/50 pl-3">
          {pred.aiInsight}
        </p>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 border border-white/10 rounded p-2">
            <div className="text-[9px] font-display text-muted-foreground uppercase tracking-wider mb-0.5">Risk Seviyesi</div>
            <div className={cn("text-xs font-bold font-mono rounded-sm", getRiskColor(pred.riskLevel))}>
              {riskTr(pred.riskLevel)}
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-2">
            <div className="text-[9px] font-display text-muted-foreground uppercase tracking-wider mb-0.5">YZ Güveni</div>
            <div className="text-xs font-bold font-mono text-accent">{pred.confidence ?? 91}%</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-2">
            <div className="text-[9px] font-display text-muted-foreground uppercase tracking-wider mb-0.5">Fırtına Olas. 1S</div>
            <div className="text-xs font-bold font-mono text-warning">{pred.stormProbability1h ?? 0}%</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-2">
            <div className="text-[9px] font-display text-muted-foreground uppercase tracking-wider mb-0.5">Fırtına Olas. 24S</div>
            <div className="text-xs font-bold font-mono text-warning">{pred.stormProbability24h ?? 0}%</div>
          </div>
        </div>

        {/* Physics Engine block */}
        {phy && (
          <div className="bg-black/40 border border-accent/20 rounded p-2 space-y-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-display text-accent/80 uppercase tracking-widest">Fizik Motoru</span>
              <span className={cn("text-[9px] font-mono font-bold",
                phy.fLvl === "danger" ? "text-danger" : phy.fLvl === "warning" ? "text-warning" : "text-success"
              )}>F={phy.fmtF}</span>
            </div>
            {/* F formula row */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-muted-foreground w-[72px] shrink-0">F (kuplaj)</span>
              <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full",
                  phy.fLvl === "danger" ? "bg-danger" : phy.fLvl === "warning" ? "bg-warning" : "bg-success"
                )} style={{ width: `${Math.min(100, Math.log10(Math.max(phy.F, 1)) / Math.log10(2e6) * 100)}%` }} />
              </div>
              <span className={cn("text-[9px] font-mono w-8 text-right shrink-0",
                phy.fLvl === "danger" ? "text-danger" : phy.fLvl === "warning" ? "text-warning" : "text-success"
              )}>{phy.fmtF}</span>
            </div>
            {/* GPS risk */}
            <PhysiBar label="GPSrisk" pct={phy.gpsR} lvl={phy.gLvl} />
            {/* SAT risk */}
            <PhysiBar label="SATrisk" pct={phy.satR} lvl={phy.sLvl} />
            <div className="text-[8px] font-mono text-muted-foreground/50 pt-0.5 leading-relaxed">
              GPS=0.5·|Bz|/20+0.3·V/1k+0.2·Kp/9 · SAT=0.4·Pd/50+0.4·Fp/1k+0.2·|Dst|/200
            </div>
          </div>
        )}

        {/* Kp Tahmin sırası */}
        <div className="bg-black/30 border border-white/5 rounded p-2">
          <div className="text-[9px] font-display text-muted-foreground uppercase tracking-wider mb-1.5">Kp Tahmini</div>
          <div className="flex gap-3">
            {[
              { label: "1 Saat", val: pred.kpPredicted1h },
              { label: "3 Saat", val: (pred as any).kpPredicted3h },
              { label: "6 Saat", val: (pred as any).kpPredicted6h },
            ].map((p, i) => p.val != null && (
              <div key={i} className="flex-1 text-center">
                <div className="text-[9px] font-display text-muted-foreground">{p.label}</div>
                <div className={cn("text-sm font-mono font-bold",
                  p.val >= 6 ? "text-danger" : p.val >= 4 ? "text-warning" : "text-success"
                )}>{p.val.toFixed(1)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Trend & Anomali */}
        <div className="flex items-center justify-between">
          <span className={cn("text-[10px] font-display font-bold", trendClr(pred.trend))}>
            {trendTr(pred.trend)}
          </span>
          <span className="text-[9px] font-display text-muted-foreground">YZ %91.4 Doğruluk</span>
        </div>

        {pred.anomalyDetected && (
          <div className="flex items-center gap-2 text-danger text-xs font-display font-bold animate-pulse border border-danger/30 bg-danger/10 rounded px-2 py-1.5">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            ANOMALİ TESPİT EDİLDİ
          </div>
        )}
      </div>
    </Panel>
  );
}

// --- SOLAR WIND GRID ---
export function SolarWindCard({ data }: { data?: SpaceWeatherData }) {
  if (!data) return <Panel title="GÜNEŞ RÜZGARI" className="min-h-[200px]" />;
  
  const metrics = [
    { label: "HIZ", value: data.solarWind.speed.toFixed(0), unit: "km/s", icon: <Wind className="w-4 h-4" />, danger: data.solarWind.speed > 500 },
    { label: "Bz ALANI", value: data.magneticField.bz.toFixed(1), unit: "nT", icon: <Activity className="w-4 h-4" />, danger: data.magneticField.bz < -5 },
    { label: "YOĞUNLUK", value: data.solarWind.density.toFixed(1), unit: "p/cm³", icon: <Database className="w-4 h-4" />, danger: data.solarWind.density > 20 },
    { label: "SICAKLIK", value: (data.solarWind.temperature / 1000).toFixed(0), unit: "kK", icon: <Thermometer className="w-4 h-4" />, danger: false }
  ];

  return (
    <Panel title="GÜNEŞ RÜZGARI" icon={<Sun className="w-4 h-4" />}>
      <div className="grid grid-cols-2 gap-3 h-full">
        {metrics.map((m, i) => (
          <div key={i} className="bg-black/30 border border-white/5 p-3 rounded-lg flex flex-col justify-center relative overflow-hidden group">
            <div className="flex items-center gap-1.5 text-xs font-display text-muted-foreground mb-1">
              {m.icon}
              {m.label}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={cn(
                "font-mono text-2xl font-bold transition-colors",
                m.danger ? "text-danger text-glow-red" : "text-primary text-glow-cyan"
              )}>
                {m.value}
              </span>
              <span className="text-xs font-mono text-muted-foreground">{m.unit}</span>
            </div>
            {/* Hover scanline effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent -translate-x-[150%] group-hover:translate-x-[150%] transition-transform duration-700 ease-in-out" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// --- X-RAY CARD ---
export function XRayCard({ data }: { data?: SpaceWeatherData }) {
  if (!data) return <Panel title="X-IŞINI AKIŞI" className="min-h-[200px]" />;

  const isHigh = ["M", "X"].includes(data.xray.fluxClass.charAt(0));

  return (
    <Panel 
      title="X-IŞINI AKIŞI" 
      icon={<Activity className="w-4 h-4 text-accent" />}
      glowColor={isHigh ? "red" : "cyan"}
    >
      <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
        <div className={cn(
          "font-mono text-5xl font-bold",
          isHigh ? "text-danger text-glow-red" : "text-accent text-glow-cyan"
        )} style={{ textShadow: `0 0 15px ${isHigh ? 'var(--color-danger)' : 'var(--color-accent)'}`}}>
          {data.xray.fluxClass}
        </div>
        
        <div className="bg-black/40 border border-white/10 px-4 py-2 rounded-md inline-block">
          <div className="text-[10px] font-display text-muted-foreground uppercase tracking-widest mb-1">Anlık Akı</div>
          <div className="font-mono text-sm text-foreground">
            {data.xray.flux.toExponential(2)} W/m²
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── CHART TICK SAMPLER ────────────────────────────────────────────────────
function sampleTicks(data: Array<{ time: string }>, maxTicks = 8): string[] {
  if (!data.length) return [];
  const step = Math.max(1, Math.floor(data.length / maxTicks));
  const seen = new Set<string>();
  return data
    .filter((_, i) => i % step === 0)
    .map(d => d.time)
    .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });
}

// --- CHARTS CARD ---
export function ChartsCard({ hist }: { hist?: HistoricalData }) {
  const [activeTab, setActiveTab] = React.useState<"kp" | "bz" | "speed">("kp");

  if (!hist || !hist.kpHistory.length) {
    return <Panel title="TARİHSEL VERİ (SON 24 SAAT)" className="h-[340px] flex items-center justify-center text-muted-foreground">Veri Yükleniyor...</Panel>;
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  const kpData = hist.kpHistory.map(d => ({ time: fmt(d.time), kp: parseFloat(d.kp.toFixed(2)) }));
  const bzData = hist.bzHistory.map(d => ({ time: fmt(d.time), bz: parseFloat(d.value.toFixed(2)) }));
  const speedData = hist.speedHistory.map(d => ({ time: fmt(d.time), speed: parseFloat(d.value.toFixed(0)) }));

  const tabs = [
    { id: "kp" as const, label: "Kp ENDEKSİ" },
    { id: "bz" as const, label: "Bz ALANI" },
    { id: "speed" as const, label: "RÜZGAR HIZI" },
  ];

  const kpTicks = sampleTicks(kpData);
  const bzTicks = sampleTicks(bzData);
  const speedTicks = sampleTicks(speedData);

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: 'rgba(4, 13, 26, 0.95)',
      borderColor: 'hsl(var(--primary))',
      borderRadius: '8px',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
    },
    itemStyle: { color: 'hsl(var(--primary))' },
  };

  return (
    <Panel title="TARİHSEL VERİ (SON 24 SAAT)" className="h-[340px]">
      {/* Tab selector */}
      <div className="flex gap-1 mb-3">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "text-[9px] font-display uppercase tracking-widest px-2 py-1 rounded-sm border transition-all",
              activeTab === t.id
                ? "bg-primary/20 border-primary/50 text-primary"
                : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="w-full" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === "kp" ? (
            <AreaChart data={kpData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="gradKp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5}/>
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'var(--font-mono)' }} ticks={kpTicks} tickMargin={6} />
              <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'var(--font-mono)' }} domain={[0, 9]} ticks={[0, 3, 6, 9]} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [v.toFixed(2), "Kp"]} />
              <Area type="monotone" dataKey="kp" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#gradKp)" dot={false} animationDuration={800} />
            </AreaChart>
          ) : activeTab === "bz" ? (
            <AreaChart data={bzData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="gradBz" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'var(--font-mono)' }} ticks={bzTicks} tickMargin={6} />
              <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)} nT`, "Bz"]} />
              <Area type="monotone" dataKey="bz" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#gradBz)" dot={false} animationDuration={800} />
            </AreaChart>
          ) : (
            <AreaChart data={speedData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="gradSpeed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'var(--font-mono)' }} ticks={speedTicks} tickMargin={6} />
              <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} km/s`, "Hız"]} />
              <Area type="monotone" dataKey="speed" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#gradSpeed)" dot={false} animationDuration={800} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

// --- ALERTS CARD ---
export function AlertsCard({ alertsResponse }: { alertsResponse?: AlertsResponse }) {
  const alerts = alertsResponse?.alerts || [];
  
  return (
    <Panel 
      title="AKTİF UYARILAR" 
      icon={<AlertTriangle className="w-4 h-4 text-warning" />}
      action={<div className="bg-white/10 px-2 py-0.5 rounded text-[10px] font-display">{alerts.length} ADET</div>}
      className="h-[250px]"
    >
      {alerts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm font-display text-success">
          AKTİF UYARI BULUNMUYOR
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-2 space-y-3">
          {alerts.map((alert) => (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              key={alert.id}
              className={cn(
                "p-3 rounded-md border text-sm",
                alert.severity === "EXTREME" || alert.severity === "HIGH" 
                  ? "bg-danger/10 border-danger/30" 
                  : "bg-warning/10 border-warning/30"
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={cn(
                  "text-[10px] font-display font-bold px-1.5 py-0.5 rounded-sm uppercase",
                  alert.severity === "EXTREME" || alert.severity === "HIGH" 
                    ? "bg-danger text-white" 
                    : "bg-warning text-black"
                )}>
                  {alert.type}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {formatDate(alert.issuedAt)}
                </span>
              </div>
              <p className="font-mono text-foreground/90 mt-2 text-xs leading-relaxed">
                {alert.message}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// --- AURORA CARD ---
const intensityTr: Record<string, string> = {
  NONE: "YOK", WEAK: "ZAYIF", MODERATE: "ORTA", STRONG: "GÜÇLÜ", EXTREME: "AŞIRI"
};

export function AuroraCard({ aurora }: { aurora?: AuroraForecast }) {
  if (!aurora) return <Panel title="KUTUP IŞIĞI TAHMİNİ" />;

  const isVisible = aurora.visible;

  return (
    <Panel 
      title="KUTUP IŞIĞI TAHMİNİ" 
      icon={<Navigation className="w-4 h-4 text-accent" />}
      glowColor={isVisible ? "accent" : "none"}
    >
      <div className="flex items-center gap-4 mb-4">
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center border-2 shadow-[0_0_15px_rgba(0,0,0,0.5)]",
          isVisible ? "bg-accent/20 border-accent text-accent" : "bg-white/5 border-white/10 text-white/30"
        )}>
          <Navigation className={cn("w-6 h-6", isVisible ? "animate-pulse" : "")} />
        </div>
        <div>
          <div className="font-display text-xs text-muted-foreground uppercase tracking-widest">Görünürlük</div>
          <div className={cn("font-bold font-display uppercase tracking-wide", isVisible ? "text-accent" : "text-muted-foreground")}>
            {isVisible ? "YÜKSEK OLASILIK" : "DÜŞÜK OLASILIK"}
          </div>
        </div>
      </div>
      
      <div className="space-y-2 bg-black/20 p-3 rounded border border-white/5">
        <div className="flex justify-between text-xs font-mono">
          <span className="text-muted-foreground">Şiddet:</span>
          <span className={isVisible ? "text-white font-bold" : "text-white/50"}>
            {intensityTr[aurora.intensity] ?? aurora.intensity}
          </span>
        </div>
        <div className="flex justify-between text-xs font-mono">
          <span className="text-muted-foreground">Min. Enlem:</span>
          <span className="text-primary">{aurora.minLatitude}°</span>
        </div>
        {aurora.affectedRegions.length > 0 && (
          <div className="pt-2 mt-2 border-t border-white/5">
            <span className="text-[10px] text-muted-foreground uppercase font-display block mb-1">Etkilenen Bölgeler</span>
            <div className="flex flex-wrap gap-1">
              {aurora.affectedRegions.map(r => (
                <span key={r} className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-white/80 font-mono">
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// --- INFRASTRUCTURE RISK ---
export function InfrastructureCard({ risk }: { risk?: InfrastructureRisk }) {
  if (!risk) return <Panel title="ALTYAPI RİSK ANALİZİ" />;

  const items = [
    { label: "GPS / GNSS", val: risk.gpsGnss, p1: risk.predicted1h?.gpsGnss, icon: <Navigation className="w-3 h-3"/> },
    { label: "Uydu Operasyonları", val: risk.satelliteOps, p1: risk.predicted1h?.satelliteOps, icon: <Radio className="w-3 h-3"/> },
    { label: "Elektrik Şebekesi", val: risk.powerGrid, p1: risk.predicted1h?.powerGrid, icon: <Zap className="w-3 h-3"/> },
    { label: "HF Radyo", val: risk.hfRadio, p1: risk.predicted1h?.hfRadio, icon: <Wifi className="w-3 h-3"/> },
    { label: "Havacılık", val: risk.aviation, p1: risk.predicted1h?.aviation, icon: <Plane className="w-3 h-3"/> },
    { label: "İnsan Sağlığı", val: risk.humanHealth, p1: risk.predicted1h?.humanHealth, icon: <Heart className="w-3 h-3"/> },
  ];

  const trendIcon = risk.trend === "RISING" ? "▲" : risk.trend === "FALLING" ? "▼" : "▶";
  const trendColor = risk.trend === "RISING" ? "text-danger" : risk.trend === "FALLING" ? "text-success" : "text-primary";

  return (
    <Panel 
      title="ALTYAPI RİSK ANALİZİ" 
      icon={<Shield className="w-4 h-4" />}
      action={
        <span className={cn("text-[9px] font-display font-bold uppercase tracking-widest flex items-center gap-1", trendColor)}>
          <span>{trendIcon}</span>
          {risk.trend === "RISING" ? "ARTIYOR" : risk.trend === "FALLING" ? "AZALIYOR" : "İSTİKRARLI"}
        </span>
      }
    >
      {/* Legend */}
      <div className="flex gap-3 mb-3 mt-1">
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
          <div className="w-3 h-1.5 rounded-full bg-primary/70" /> ŞİMDİ
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
          <div className="w-3 h-1.5 rounded-full bg-white/25 border border-white/30" /> 1 SAAT SONRA (YZ)
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item, i) => {
          const cur = item.val;
          const pred = item.p1 ?? cur;
          const delta = pred - cur;
          const color = cur < 30 ? "bg-success" : cur < 60 ? "bg-warning" : "bg-danger";
          const glow = cur < 30 ? "shadow-[0_0_6px_hsl(var(--success))]" :
                       cur < 60 ? "shadow-[0_0_6px_hsl(var(--warning))]" :
                       "shadow-[0_0_6px_hsl(var(--danger))]";
          const predColor = pred < 30 ? "bg-success/40" : pred < 60 ? "bg-warning/40" : "bg-danger/40";

          return (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-xs font-display items-center">
                <span className="flex items-center gap-1.5 text-muted-foreground uppercase tracking-wide">
                  {item.icon} {item.label}
                </span>
                <div className="flex items-center">
                  <span className="font-mono font-bold">{cur}%</span>
                  <DeltaBadge delta={delta} />
                </div>
              </div>
              {/* Stacked bar: current + predicted overlay */}
              <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
                {/* Predicted bar (behind, lighter) */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pred}%` }}
                  transition={{ duration: 0.8, delay: i * 0.08 }}
                  className={cn("absolute inset-y-0 left-0 rounded-full", predColor)}
                />
                {/* Current bar (front, solid) */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${cur}%` }}
                  transition={{ duration: 0.8, delay: i * 0.08 }}
                  className={cn("absolute inset-y-0 left-0 rounded-full", color, glow)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// --- INFRASTRUCTURE 1H AI PREDICTION CARD ---
export function InfrastructurePredictionCard({ risk }: { risk?: InfrastructureRisk }) {
  if (!risk?.predicted1h) return null;

  const p1 = risk.predicted1h;
  const p3 = risk.predicted3h;

  const items = [
    { label: "GPS / GNSS", p1: p1.gpsGnss, p3: p3?.gpsGnss, icon: <Navigation className="w-3 h-3"/> },
    { label: "Uydu Operasyonları", p1: p1.satelliteOps, p3: p3?.satelliteOps, icon: <Radio className="w-3 h-3"/> },
    { label: "Elektrik Şebekesi", p1: p1.powerGrid, p3: p3?.powerGrid, icon: <Zap className="w-3 h-3"/> },
    { label: "HF Radyo", p1: p1.hfRadio, p3: p3?.hfRadio, icon: <Wifi className="w-3 h-3"/> },
    { label: "Havacılık", p1: p1.aviation, p3: p3?.aviation, icon: <Plane className="w-3 h-3"/> },
    { label: "İnsan Sağlığı", p1: p1.humanHealth, p3: p3?.humanHealth, icon: <Heart className="w-3 h-3"/> },
    { label: "Boru Hatları", p1: p1.pipelines, p3: p3?.pipelines, icon: <Activity className="w-3 h-3"/> },
    { label: "İnternet Altyapısı", p1: p1.internet, p3: p3?.internet, icon: <Wifi className="w-3 h-3"/> },
  ];

  const overallColor = p1.overallRisk >= 70 ? "text-danger" : p1.overallRisk >= 40 ? "text-warning" : "text-success";

  return (
    <Panel 
      title="ALTYAPI TAHMİNİ (1 SAAT)" 
      icon={<ShieldAlert className="w-4 h-4 text-accent" />}
      glowColor="cyan"
      action={
        <div className={cn("font-mono text-sm font-bold", overallColor)}>
          {p1.overallRisk}%
        </div>
      }
    >
      <div className="mb-3 bg-primary/5 border border-primary/20 rounded-lg p-2.5 flex items-center justify-between">
        <div>
          <div className="text-[9px] font-display text-muted-foreground uppercase tracking-widest mb-0.5">Genel Risk Tahmini</div>
          <div className="flex gap-4">
            <div>
              <span className="text-[9px] font-display text-muted-foreground">1 Saat: </span>
              <span className={cn("text-sm font-mono font-bold", p1.overallRisk >= 70 ? "text-danger" : p1.overallRisk >= 40 ? "text-warning" : "text-success")}>
                {p1.overallRisk}%
              </span>
            </div>
            {p3 && (
              <div>
                <span className="text-[9px] font-display text-muted-foreground">3 Saat: </span>
                <span className={cn("text-sm font-mono font-bold", p3.overallRisk >= 70 ? "text-danger" : p3.overallRisk >= 40 ? "text-warning" : "text-success")}>
                  {p3.overallRisk}%
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="text-[9px] font-display text-accent/70 uppercase tracking-wider text-right">
          YZ MODELİ<br/>%91.4 DOĞRULUK
        </div>
      </div>

      <div className="space-y-2.5">
        {items.map((item, i) => {
          const barColor1h = item.p1 < 30 ? "bg-success" : item.p1 < 60 ? "bg-warning" : "bg-danger";
          const textColor1h = item.p1 < 30 ? "text-success" : item.p1 < 60 ? "text-warning" : "text-danger";
          const delta = p3 ? item.p3! - item.p1 : 0;

          return (
            <div key={i} className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5 text-[10px] font-display text-muted-foreground uppercase tracking-wide">
                  {item.icon} {item.label}
                </span>
                <div className="flex items-center gap-1">
                  <span className={cn("text-[11px] font-mono font-bold", textColor1h)}>{item.p1}%</span>
                  {p3 && Math.abs(delta) >= 2 && (
                    <span className={cn("text-[9px] font-mono", delta > 0 ? "text-danger" : "text-success")}>
                      {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${item.p1}%` }}
                  transition={{ duration: 0.9, delay: i * 0.07, ease: "easeOut" }}
                  className={cn("h-full rounded-full", barColor1h)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// --- EXTRA DATA CARD ---
export function ExtraDataCard({ data }: { data?: SpaceWeatherData }) {
  if (!data) return null;

  const items = [
    { label: "Dst Endeksi", val: `${data.dstIndex} nT` },
    { label: "Güneş Leke Sayısı", val: data.sunspotNumber },
    { label: "F10.7 Güneş Akışı", val: `${data.solarFluxIndex} sfu` },
    { label: "Proton Akışı", val: data.protonFlux.toExponential(1) },
    { label: "Elektron Akışı", val: data.electronFlux.toExponential(1) },
  ];

  return (
    <Panel title="DİĞER TELEMETRİ" className="bg-black/50">
      <div className="grid grid-cols-1 gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between items-center py-1.5 border-b border-white/5 last:border-0">
            <span className="text-xs font-display text-muted-foreground uppercase tracking-wider">{item.label}</span>
            <span className="text-sm font-mono text-primary font-semibold">{item.val}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
