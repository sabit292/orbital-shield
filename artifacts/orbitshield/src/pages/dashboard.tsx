import React, { useEffect, useState } from "react";
import { formatTime } from "@/lib/utils";
import { Shield, RadioTower, AlertCircle } from "lucide-react";
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
  InfrastructurePredictionCard, ExtraDataCard 
} from "@/components/dashboard/cards";
import { Gauge } from "@/components/ui/gauge";
import { StarField } from "@/components/ui/starfield";
import { AlarmSystem } from "@/components/ui/alarm";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [time, setTime] = useState(new Date());

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
            </div>
          </div>
        </header>

        {/* MAIN DASHBOARD */}
        <main className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">

          {/* TOP 3-COLUMN GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">

            {/* LEFT COLUMN */}
            <div className="lg:col-span-3 flex flex-col gap-6">
              <KpCard data={current} pred={prediction} />
              <AiInsightCard pred={prediction} />
              
              <div className="grid grid-cols-2 gap-4 min-h-[200px]">
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
            <div className="lg:col-span-6 flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <SolarWindCard data={current} />
                <XRayCard data={current} />
              </div>
              <ChartsCard hist={history} />
            </div>

            {/* RIGHT COLUMN */}
            <div className="lg:col-span-3 flex flex-col gap-6">
              <AuroraCard aurora={aurora} />
              <InfrastructureCard risk={risk} />
              <ExtraDataCard data={current} />
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
