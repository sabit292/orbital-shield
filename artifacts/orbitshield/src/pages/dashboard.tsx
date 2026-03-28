import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { formatTime } from "@/lib/utils";
import { Shield, RadioTower, AlertCircle, Globe, X, Plane } from "lucide-react";
import { 
  useGetCurrentSpaceWeather, 
  useGetAIPrediction, 
  useGetSpaceWeatherAlerts, 
  useGetInfrastructureRisk,
  useGetSpaceWeatherHistory,
  useGetAuroraForecast
} from "@workspace/api-client-react";
import {
  KpCard, AiInsightCard, SolarWindCard, XRayCard, 
  ChartsCard, AuroraCard, InfrastructureCard,
  InfrastructurePredictionCard 
} from "@/components/dashboard/cards";
import { Gauge } from "@/components/ui/gauge";
import { StarField } from "@/components/ui/starfield";
import { AlarmSystem } from "@/components/ui/alarm";
import { Globe3D } from "@/components/ui/globe3d";
import { motion, AnimatePresence } from "framer-motion";

export default function Dashboard() {
  const [time, setTime] = useState(new Date());
  const [showGlobe, setShowGlobe] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const queryOptions = { query: { refetchInterval: 60000, retry: 2 } };

  const { data: current, isLoading: currentLoading, isError: currentError } = useGetCurrentSpaceWeather(queryOptions);
  const { data: prediction } = useGetAIPrediction(queryOptions);
  const { data: alerts } = useGetSpaceWeatherAlerts(queryOptions);
  const { data: risk } = useGetInfrastructureRisk(queryOptions);
  const { data: history } = useGetSpaceWeatherHistory(queryOptions);
  const { data: aurora } = useGetAuroraForecast(queryOptions);

  if (currentLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center relative overflow-hidden">
        <StarField />
        <div className="relative z-10 flex flex-col items-center">
          <motion.div 
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-primary mb-6"
          >
            <Shield className="w-24 h-24" />
          </motion.div>
          <h1 className="font-display text-2xl text-primary font-bold tracking-[0.2em] mb-2">YÖRÜNGE KALKANI</h1>
          <p className="font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Sistemler Başlatılıyor...</p>
        </div>
      </div>
    );
  }

  if (currentError || !current) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <StarField />
        <div className="relative z-10">
          <AlertCircle className="w-16 h-16 text-danger mb-4 mx-auto" />
          <h1 className="font-display text-xl text-danger font-bold uppercase tracking-widest mb-2">Telemetri Bağlantısı Koptu</h1>
          <p className="font-mono text-muted-foreground">Merkezi sunucuya ulaşılamıyor veya veri akışı kesildi.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden pb-12 relative">
      {/* Animated starfield background */}
      <StarField />

      {/* Alarm system (floating) */}
      <AlarmSystem current={current} prediction={prediction} risk={risk} alerts={alerts} />

      {/* ── 3D Globe floating window ─────────────────────────────────────── */}
      <AnimatePresence>
        {showGlobe && (
          <motion.div
            key="globe-window"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-8"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowGlobe(false)}
            />

            {/* Window */}
            <div className="relative z-10 w-full max-w-4xl h-[70vh] flex flex-col rounded-xl overflow-hidden border border-primary/30 shadow-[0_0_60px_rgba(0,240,255,0.15)] bg-[#020b16]">
              {/* Title bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary/20 bg-black/60 flex-shrink-0">
                <div className="flex items-center gap-3">
                  {/* traffic light style dots */}
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-danger/70" />
                    <div className="w-3 h-3 rounded-full bg-warning/70" />
                    <div className="w-3 h-3 rounded-full bg-success/70" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <span className="font-display text-xs text-primary/90 uppercase tracking-[0.2em] font-semibold">
                      3D DÜNYA — ETKİLENEN BÖLGELER
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-muted-foreground hidden sm:block">
                    Kp {(current?.kpIndex ?? 0).toFixed(1)} · {(current?.solarWind?.speed ?? 0).toFixed(0)} km/s rüzgar
                  </span>
                  <button
                    onClick={() => setShowGlobe(false)}
                    className="w-7 h-7 rounded-md flex items-center justify-center border border-white/10 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Globe canvas */}
              <div className="flex-1 relative">
                <Globe3D data={current} pred={prediction} risk={risk} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10">
        {/* HEADER */}
        <header className="border-b border-primary/20 bg-[#03080f]/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-primary/10 border border-primary/40 rounded-lg flex items-center justify-center text-primary shadow-[0_0_15px_rgba(0,240,255,0.2)]">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold tracking-[0.15em] text-primary text-glow-cyan leading-tight">
                  YÖRÜNGE KALKANI
                </h1>
                <h2 className="font-display text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  Yapay Zeka Uzay Hava Durumu Merkezi
                </h2>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] font-display text-muted-foreground uppercase tracking-widest">Sistem Durumu</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-success animate-pulse-fast shadow-[0_0_8px_hsl(var(--success))]" />
                  <span className="font-mono text-xs font-bold text-success tracking-widest">CANLI BAĞLANTI</span>
                </div>
              </div>
              
              <div className="flex flex-col items-end border-l border-white/10 pl-6">
                <span className="text-[10px] font-display text-muted-foreground uppercase tracking-widest">Son Telemetri</span>
                <div className="flex items-center gap-2 font-mono text-primary">
                  <RadioTower className="w-3 h-3 opacity-70" />
                  <span className="font-bold tracking-wider">{formatTime(time.toISOString())}</span>
                </div>
              </div>

              {/* Globe Toggle Button */}
              <button
                onClick={() => setShowGlobe(v => !v)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-display text-[10px] uppercase tracking-widest transition-all ${
                  showGlobe
                    ? "bg-primary/20 border-primary/60 text-primary shadow-[0_0_12px_rgba(0,240,255,0.3)]"
                    : "bg-white/5 border-white/20 text-muted-foreground hover:border-primary/40 hover:text-primary"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                3D DÜNYA
              </button>
            </div>
          </div>
        </header>

        {/* MAIN DASHBOARD */}
        <main className="p-3 md:p-4 lg:p-5 max-w-[1600px] mx-auto space-y-3">

          {/* TOP 3-COLUMN GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3">

            {/* LEFT COLUMN — AI analiz paneli için genişletildi */}
            <div className="lg:col-span-4 flex flex-col gap-3">
              <KpCard data={current} pred={prediction} />
              <AiInsightCard pred={prediction} data={current} history={history} />
              
              <div className="grid grid-cols-2 gap-3 min-h-[200px]">
                <div className="bg-card/60 border border-white/10 rounded-xl flex flex-col items-center justify-center backdrop-blur-md relative overflow-hidden group py-3">
                  <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Gauge 
                    title="FIRTINA" 
                    value={prediction?.stormProbability24h ?? 0} 
                    color="hsl(var(--primary))"
                    subtitle="OLASILIK %"
                    size={120}
                  />
                </div>
                <div className="bg-card/60 border border-white/10 rounded-xl flex flex-col items-center justify-center backdrop-blur-md relative overflow-hidden group py-3">
                  <div className="absolute inset-0 bg-danger/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Gauge 
                    title="YZ RİSK" 
                    value={prediction?.riskScore ?? 0} 
                    color={
                      (prediction?.riskScore ?? 0) > 70 ? "hsl(var(--danger))" : 
                      (prediction?.riskScore ?? 0) > 40 ? "hsl(var(--warning))" : 
                      "hsl(var(--success))"
                    }
                    subtitle="PUAN"
                    size={120}
                  />
                </div>
              </div>
            </div>

            {/* CENTER COLUMN */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SolarWindCard data={current} />
                <XRayCard data={current} />
              </div>
              <ChartsCard hist={history} />
            </div>

            {/* RIGHT COLUMN */}
            <div className="lg:col-span-3 flex flex-col gap-3">
              <AuroraCard aurora={aurora} />
              <InfrastructureCard risk={risk} />
              {/* Aviation shortcut panel */}
              <button
                onClick={() => navigate("/aviation")}
                className="w-full rounded-lg border border-blue-500/30 bg-blue-600/10 hover:bg-blue-600/20 hover:border-blue-400/50 transition-all p-3 flex items-center gap-3 group text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-600/30 transition-colors">
                  <Plane className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-blue-300 uppercase tracking-widest leading-tight">Havacılık Modülü</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">HF · GPS · Radyasyon · Kutup Güzergahı</div>
                </div>
                <svg className="w-3.5 h-3.5 text-blue-400/60 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

          </div>

          {/* BOTTOM WIDE ROW: 1H AI Prediction Panel (full width) */}
          <div className="w-full">
            <InfrastructurePredictionCard risk={risk} />
          </div>

        </main>
      </div>
    </div>
  );
}
