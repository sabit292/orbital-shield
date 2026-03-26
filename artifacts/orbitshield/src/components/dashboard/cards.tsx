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
              Taha: {pred.kpPredicted1h.toFixed(1)}
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
export function AiInsightCard({ pred }: { pred?: AIPrediction }) {
  if (!pred) return <Panel title="YAPAY ZEKA İÇGÖRÜSÜ" className="min-h-[150px]" />;

  const getRiskColor = (level: string) => {
    if (level === "LOW") return "text-success border-success/30 bg-success/10";
    if (level === "MODERATE") return "text-warning border-warning/30 bg-warning/10";
    return "text-danger border-danger/30 bg-danger/10";
  };

  return (
    <Panel title="YAPAY ZEKA İÇGÖRÜSÜ" icon={<Zap className="w-4 h-4 text-accent" />}>
      <div className="space-y-4">
        <p className="font-mono text-sm leading-relaxed text-primary/90 border-l-2 border-accent/50 pl-3">
          {pred.aiInsight}
        </p>
        
        <div className="flex justify-between items-center bg-white/5 p-2 rounded-md border border-white/10">
          <div className="text-xs font-display text-muted-foreground uppercase tracking-wider">Risk Seviyesi</div>
          <div className={cn("px-2 py-0.5 text-xs font-bold font-display uppercase tracking-widest rounded-sm border", getRiskColor(pred.riskLevel))}>
            {pred.riskLevel}
          </div>
        </div>
        
        {pred.anomalyDetected && (
          <div className="flex items-center gap-2 text-danger text-xs font-display font-bold animate-pulse">
            <ShieldAlert className="w-4 h-4" />
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
    { label: "BZ MANYETİK", value: data.magneticField.bz.toFixed(1), unit: "nT", icon: <Activity className="w-4 h-4" />, danger: data.magneticField.bz < -5 },
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
            <div className="flex items-baseline gap-1">
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
  if (!data) return <Panel title="X-IŞINI AKISI" className="min-h-[200px]" />;

  const isHigh = ["M", "X"].includes(data.xray.fluxClass.charAt(0));

  return (
    <Panel 
      title="X-IŞINI AKISI" 
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

// --- CHARTS CARD ---
export function ChartsCard({ hist }: { hist?: HistoricalData }) {
  if (!hist || !hist.kpHistory.length) {
    return <Panel title="TARİHSEL VERİ" className="h-[300px] flex items-center justify-center text-muted-foreground">Veri Bekleniyor...</Panel>;
  }

  // Format data for chart
  const data = hist.kpHistory.map(d => ({
    time: new Date(d.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    kp: d.kp
  }));

  return (
    <Panel title="KP ENDEKSİ (SON 24 SAAT)" className="h-[300px]">
      <div className="w-full h-full mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorKp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="time" 
              stroke="rgba(255,255,255,0.3)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              tickMargin={10}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.3)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              domain={[0, 9]}
              ticks={[0, 3, 6, 9]}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(4, 13, 26, 0.9)', 
                borderColor: 'hsl(var(--primary))',
                borderRadius: '8px',
                fontFamily: 'var(--font-mono)'
              }} 
              itemStyle={{ color: 'hsl(var(--primary))' }}
            />
            <Area 
              type="monotone" 
              dataKey="kp" 
              stroke="hsl(var(--primary))" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorKp)" 
              animationDuration={1500}
            />
          </AreaChart>
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
export function AuroraCard({ aurora }: { aurora?: AuroraForecast }) {
  if (!aurora) return <Panel title="AURORA TAHMİNİ" />;

  const isVisible = aurora.visible;

  return (
    <Panel 
      title="AURORA TAHMİNİ" 
      icon={<Sun className="w-4 h-4 text-accent" />}
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
          <span className={isVisible ? "text-white font-bold" : "text-white/50"}>{aurora.intensity}</span>
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
    { label: "GPS / GNSS", val: risk.gpsGnss, icon: <Navigation className="w-3 h-3"/> },
    { label: "Uydu Operasyonları", val: risk.satelliteOps, icon: <Radio className="w-3 h-3"/> },
    { label: "Elektrik Şebekesi", val: risk.powerGrid, icon: <Zap className="w-3 h-3"/> },
    { label: "HF Radyo", val: risk.hfRadio, icon: <Wifi className="w-3 h-3"/> },
    { label: "Havacılık", val: risk.aviation, icon: <Plane className="w-3 h-3"/> },
    { label: "İnsan Sağlığı", val: risk.humanHealth, icon: <Heart className="w-3 h-3"/> },
  ];

  return (
    <Panel title="ALTYAPI RİSK ANALİZİ" icon={<Shield className="w-4 h-4" />}>
      <div className="space-y-4 mt-2">
        {items.map((item, i) => {
          const color = item.val < 30 ? "bg-success" : item.val < 60 ? "bg-warning" : "bg-danger";
          const glow = item.val < 30 ? "shadow-[0_0_8px_hsl(var(--success))]" : 
                       item.val < 60 ? "shadow-[0_0_8px_hsl(var(--warning))]" : 
                       "shadow-[0_0_8px_hsl(var(--danger))]";
                       
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between text-xs font-display items-center">
                <span className="flex items-center gap-1.5 text-muted-foreground uppercase tracking-wide">
                  {item.icon} {item.label}
                </span>
                <span className="font-mono font-bold">{item.val}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${item.val}%` }}
                  transition={{ duration: 1, delay: i * 0.1 }}
                  className={cn("h-full rounded-full", color, glow)} 
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
    { label: "F10.7 Solar Akı", val: `${data.solarFluxIndex} sfu` },
    { label: "Proton Akısı", val: data.protonFlux.toExponential(1) },
    { label: "Elektron Akısı", val: data.electronFlux.toExponential(1) },
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
