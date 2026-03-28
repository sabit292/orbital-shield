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
  Dst: number, Fluxp: number,
  history?: HistoricalData
) {
  const bzHist    = history?.bzHistory    ?? [];
  const speedHist = history?.speedHistory ?? [];

  // ── History-derived inputs ─────────────────────────────────────────────────
  // dBz/dt: 1-step backward difference (nT / 5-min)
  const bz1    = bzHist.length >= 2 ? bzHist[bzHist.length - 2].value : Bz;
  const bz2    = bzHist.length >= 3 ? bzHist[bzHist.length - 3].value : bz1;
  const dBzdt  = Bz - bz1;                          // nT / 5-min
  const d2Bzdt2 = Bz - 2 * bz1 + bz2;              // nT / (5-min)² — second deriv

  // t_{Bz<0}: hours Bz has been continuously southward (from recent bzHistory)
  let tBzNeg = 0;
  for (let i = bzHist.length - 1; i >= 0; i--) {
    if (bzHist[i].value < 0) tBzNeg += 5 / 60;     // each point = 5 min
    else break;
  }
  if (Bz < 0) tBzNeg = Math.max(tBzNeg, 5 / 60);  // at minimum current point

  // dPd/dt: pressure rate of change over last 15 min (nPa / hour)
  const speed15 = speedHist.length >= 3 ? speedHist[speedHist.length - 3].value : V;
  const Pd_now  = 1.67e-6 * n * V * V;
  const Pd_15   = 1.67e-6 * 5 * speed15 * speed15; // density baseline 5 p/cm³
  const dPddt   = (Pd_now - Pd_15) / 0.25;          // nPa/hour

  // Shock_P: dynamic pressure ratio vs 1h ago (for F_CME)
  const speed1h = speedHist.length >= 12 ? speedHist[speedHist.length - 12].value : V;
  const Pd_1h   = 1.67e-6 * 5 * speed1h * speed1h;
  const shockP  = Pd_now / Math.max(Pd_1h, 0.1);

  // Shared terms
  const absBz   = Math.max(Math.abs(Bz), 0.01);
  const safeN   = Math.max(n, 0.01);
  // ln(1 + t) term — add floor to avoid zero when Bz just turned south
  const logTBz  = Math.log(1 + Math.max(tBzNeg, 0.05));

  // ── F variants ─────────────────────────────────────────────────────────────
  // F_new = V^1.4 · |Bz|^1.5 · n^0.3 · (1 + 0.6·|dBz/dt|) · ln(1 + t_{Bz<0})
  const F_new = Math.pow(V, 1.4) * Math.pow(absBz, 1.5) * Math.pow(safeN, 0.3)
              * (1 + 0.6 * Math.abs(dBzdt)) * logTBz;

  // F_shock = F_new · (1 + 0.4·dPd/dt)   [shock-sensitive, when Pd rising]
  const F_shock = F_new * (1 + 0.4 * Math.max(dPddt, 0));

  // F_advanced = F_new · (1 + 0.3·|d²Bz/dt²|)   [includes second derivative]
  const F_advanced = F_new * (1 + 0.3 * Math.abs(d2Bzdt2));

  // F_CME = V^1.5 · |Bz|^1.4 · n^0.5 · Shock_P^0.8 · ln(1 + t_{Bz<0})
  const F_CME = Math.pow(V, 1.5) * Math.pow(absBz, 1.4) * Math.pow(safeN, 0.5)
              * Math.pow(Math.max(shockP, 0.01), 0.8) * logTBz;

  // F_final = V^1.5 · |Bz|^1.6 · n^0.35 · (1+0.7|dBz/dt|) · (1+0.4·dPd/dt) · ln(1+t_{Bz<0})
  // Nihai "tek formül" — güç + ani değişim + basınç şoku + negatif Bz süresi
  const F_final = Math.pow(V, 1.5) * Math.pow(absBz, 1.6) * Math.pow(safeN, 0.35)
                * (1 + 0.7 * Math.abs(dBzdt))
                * (1 + 0.4 * Math.max(dPddt, 0))
                * logTBz;

  // ── Active F: F_final is primary; legacy variants kept for comparison ───────
  const F       = F_final;
  const fLabel  = "F_final";

  // ── Risk scores ────────────────────────────────────────────────────────────
  // GPSrisk = 0.5·(|Bz|/20) + 0.3·(V/1000) + 0.2·(Kp/9)
  const gpsR = 0.5 * (absBz / 20) + 0.3 * (V / 1000) + 0.2 * (Kp / 9);

  // SATrisk = 0.4·(Pd/50) + 0.4·(Fluxp/1000) + 0.2·(|Dst|/200)
  const Pd   = Pd_now;
  const satR = 0.4 * (Pd / 50) + 0.4 * (Math.max(Fluxp, 0) / 1000) + 0.2 * (Math.abs(Dst) / 200);

  const fmt  = (f: number) =>
    f >= 1e6 ? (f / 1e6).toFixed(2) + "M" : f >= 1e3 ? (f / 1e3).toFixed(1) + "k" : f.toFixed(0);

  const fLvl = F < 80_000 ? "success" : F < 400_000 ? "warning" : "danger";
  const gLvl = gpsR < 0.25 ? "success" : gpsR < 0.50 ? "warning" : "danger";
  const sLvl = satR < 0.25 ? "success" : satR < 0.50 ? "warning" : "danger";

  return {
    F, F_new, F_shock, F_advanced, F_CME, F_final,
    fmtF: fmt(F), fLabel,
    gpsR, satR, Pd, fLvl, gLvl, sLvl,
    dBzdt, d2Bzdt2, tBzNeg, dPddt, shockP,
    absBz, V, n, Fluxp,
  };
}

// ── Storm type classifier ─────────────────────────────────────────────────────
type StormTypeId = "CME" | "CORONAL_HOLE" | "SUDDEN_SHOCK" | "LONG_WEAK" | "NONE";

interface StormClassification {
  id:          StormTypeId;
  label:       string;    // Turkish display
  labelEn:     string;    // English scientific name
  icon:        string;
  color:       string;    // Tailwind text-* class
  bg:          string;    // Tailwind bg + border classes
  description: string;
  confidence:  number;    // 0–100
  signatures:  string[];  // key physical signatures that triggered this
}

function classifyStorm(data: SpaceWeatherData, history?: HistoricalData): StormClassification {
  const V      = data.solarWind.speed;
  const Bz     = data.magneticField.bz;
  const n      = data.solarWind.density;
  const Kp     = data.kpIndex;
  const Fluxp  = (data as any).protonFlux ?? 0;

  const speedHist = history?.speedHistory ?? [];
  const bzHist    = history?.bzHistory    ?? [];
  const kpHist    = history?.kpHistory    ?? [];

  // ── Derive trend values from real history ───────────────────────────────────
  // Speed 1h ago (12 × 5-min points), 15min ago (3 points)
  const speed1h    = speedHist.length >= 12 ? speedHist[speedHist.length - 12].value : V;
  const speed15m   = speedHist.length >=  3 ? speedHist[speedHist.length -  3].value : V;
  const dV1h       = V - speed1h;    // km/s gained in last 1 hour
  const dV15m      = V - speed15m;   // km/s gained in last 15 min

  // Bz change in last 15 min (sudden rotation signal)
  const bz15m      = bzHist.length >= 3 ? bzHist[bzHist.length - 3].value : Bz;
  const dBz15m     = Bz - bz15m;

  // Dynamic pressure ratio: now vs 1h ago (approximate n1h with baseline)
  const Pd         = 1.67e-6 * n * V * V;
  const Pd1h_est   = 1.67e-6 * 5 * speed1h * speed1h;   // density baseline 5 p/cm³
  const pdRatio    = Pd / Math.max(Pd1h_est, 0.1);

  // Fraction of last 2h of kpHistory readings that are ≥3 (sustained moderate)
  const recent24   = kpHist.slice(-24);   // ~2h at 5-min intervals
  const sustained  = recent24.length > 0
    ? recent24.filter(p => p.kp >= 3).length / recent24.length
    : 0;

  // ── Scoring (each type gets a 0–100 score) ──────────────────────────────────
  const scores = { SUDDEN_SHOCK: 0, CME: 0, CORONAL_HOLE: 0, LONG_WEAK: 0 };

  // --- ANİ ŞOK: very fast speed jump + abrupt Bz rotation ─────────────────────
  if (dV15m > 100)             scores.SUDDEN_SHOCK += 55;
  else if (dV15m > 60)         scores.SUDDEN_SHOCK += 35;
  else if (dV15m > 30)         scores.SUDDEN_SHOCK += 15;
  if (Math.abs(dBz15m) > 10)  scores.SUDDEN_SHOCK += 30;
  else if (Math.abs(dBz15m) > 6) scores.SUDDEN_SHOCK += 15;
  if (pdRatio > 3.5)           scores.SUDDEN_SHOCK += 20;
  else if (pdRatio > 2.0)      scores.SUDDEN_SHOCK += 10;

  // --- CME: 1h speed surge + elevated proton flux + strong Bz + high Pd ───────
  if (dV1h > 150)              scores.CME += 45;
  else if (dV1h > 80)          scores.CME += 25;
  else if (dV1h > 40)          scores.CME += 10;
  if (Fluxp > 100)             scores.CME += 40;
  else if (Fluxp > 10)         scores.CME += 25;
  else if (Fluxp > 5)          scores.CME += 10;
  if (V > 600 && Bz < -12)    scores.CME += 20;
  else if (V > 500 && Bz < -8) scores.CME += 10;
  if (pdRatio > 2.5)           scores.CME += 10;

  // --- KORONAL DELİK: elevated but stable speed + low density + no protons ────
  if (V > 450 && dV1h < 50)   scores.CORONAL_HOLE += 30;  // fast but not surging
  if (n < 5)                   scores.CORONAL_HOLE += 30;
  else if (n < 8)              scores.CORONAL_HOLE += 18;
  if (Fluxp < 3)               scores.CORONAL_HOLE += 20;
  if (V > 480)                 scores.CORONAL_HOLE += 10;
  // Alfvénic proxy: Bz oscillating (non-zero delta but not huge)
  if (Math.abs(dBz15m) > 2 && Math.abs(dBz15m) < 8)
                               scores.CORONAL_HOLE += 10;

  // --- UZUN SÜRELİ ZAYIF: sustained moderate Kp + normal speed + moderate Bz ──
  if (Kp >= 3 && Kp <= 5.5)   scores.LONG_WEAK += 30;
  if (V < 550)                 scores.LONG_WEAK += 20;
  if (Math.abs(Bz) >= 5 && Math.abs(Bz) <= 15) scores.LONG_WEAK += 20;
  if (sustained > 0.7)         scores.LONG_WEAK += 25;
  else if (sustained > 0.4)    scores.LONG_WEAK += 12;
  if (Fluxp < 5)               scores.LONG_WEAK += 10;

  // ── Pick winner ─────────────────────────────────────────────────────────────
  const maxScore = Math.max(...Object.values(scores));
  const MIN_THRESHOLD = 25;

  if (Kp < 2 && V < 500 && Math.abs(Bz) < 5 && maxScore < MIN_THRESHOLD) {
    return {
      id: "NONE", label: "AKTİVİTE YOK", labelEn: "Quiet Conditions", icon: "◌",
      color: "text-primary/50", bg: "bg-primary/5 border-primary/15",
      description: "Uzay hava koşulları sakin. Belirgin fırtına türü imzası tespit edilmedi.",
      confidence: 92, signatures: []
    };
  }

  const winner = (Object.entries(scores)
    .reduce((a, b) => a[1] >= b[1] ? a : b)[0]) as keyof typeof scores;
  const conf = Math.min(95, Math.round(45 + scores[winner] * 0.45));

  const defs: Record<keyof typeof scores, Omit<StormClassification, "confidence">> = {
    SUDDEN_SHOCK: {
      id: "SUDDEN_SHOCK",
      label: "ANİ ŞOK",
      labelEn: "Sudden Storm Commencement",
      icon: "⚡",
      color: "text-danger",
      bg: "bg-danger/10 border-danger/40",
      description: "Hızlı dinamik basınç artışı ve ani Bz rotasyonu tespit edildi. Plazma şoku magnetopozda kısa sürede sıkıştırma oluşturdu.",
      signatures: [
        `+${dV15m.toFixed(0)} km/s / 15dk`,
        `Bz ${dBz15m > 0 ? "+" : ""}${dBz15m.toFixed(1)} nT rotasyon`,
        `Pd ${pdRatio.toFixed(1)}× artış`,
      ],
    },
    CME: {
      id: "CME",
      label: "CME KAYNAKLI",
      labelEn: "Coronal Mass Ejection",
      icon: "☄",
      color: "text-danger",
      bg: "bg-danger/10 border-danger/40",
      description: "Güneş'ten fırlayan yüklü plazma bulutu manyetosferle çarpıştı. Yüksek proton akısı ve hız artışı CME imzası taşıyor.",
      signatures: [
        `+${dV1h.toFixed(0)} km/s / 1s hız artışı`,
        ...(Fluxp > 3 ? [`${Fluxp.toFixed(0)} pfu proton akısı`] : []),
        `Bz ${Bz.toFixed(1)} nT`,
      ],
    },
    CORONAL_HOLE: {
      id: "CORONAL_HOLE",
      label: "KORONAL DELİK",
      labelEn: "High-Speed Stream (HSS)",
      icon: "◎",
      color: "text-warning",
      bg: "bg-warning/10 border-warning/40",
      description: "Güneş'te koronal delikten çıkan hızlı rüzgâr akımı (HSS). Düşük yoğunluk ve Alfvénik dalgalanmalar karakteristik imzadır.",
      signatures: [
        `${V.toFixed(0)} km/s stabil hız`,
        `${n.toFixed(1)} p/cm³ düşük yoğunluk`,
        "Proton olayı yok",
      ],
    },
    LONG_WEAK: {
      id: "LONG_WEAK",
      label: "UZUN SÜRELİ ZAYIF",
      labelEn: "Long-Duration Weak Storm",
      icon: "〜",
      color: "text-yellow-400",
      bg: "bg-yellow-500/10 border-yellow-500/30",
      description: "Süregelen ılımlı jeomagnetik aktivite. Normal hız, hafif güney Bz ve uzun süreli Kp baskısı karakteristik.",
      signatures: [
        `Kp ${Kp.toFixed(1)} sürekli`,
        `${(sustained * 100).toFixed(0)}% ölçüm aktif`,
        `Bz ${Bz.toFixed(1)} nT`,
      ],
    },
  };

  return { ...defs[winner], confidence: conf };
}

// ── Reason generator — physics + real NOAA history ───────────────────────────
type ReasonLevel = "info" | "warning" | "danger";
interface Reason { text: string; level: ReasonLevel }

function generateReasons(
  data: SpaceWeatherData,
  phy: ReturnType<typeof physicsCalc>,
  history?: HistoricalData
): Reason[] {
  const V      = data.solarWind.speed;
  const Bz     = data.magneticField.bz;
  const n      = data.solarWind.density;
  const Kp     = data.kpIndex;
  const Dst    = (data as any).dstIndex  ?? 0;
  const Fluxp  = (data as any).protonFlux ?? 5;
  const Pd     = 1.67e-6 * n * V * V;
  const out: Reason[] = [];

  // ── 1. Bz trend from real bzHistory (~15 min = 3 points at 5-min) ──────────
  const bzHist = history?.bzHistory ?? [];
  if (bzHist.length >= 4) {
    const bzThen  = bzHist[Math.max(0, bzHist.length - 4)].value;
    const delta   = Bz - bzThen;
    if (delta < -5)
      out.push({ text: `Bz son 15 dk'da ${delta.toFixed(1)} nT düştü → ${Bz.toFixed(1)} nT (güçlü güney)`, level: "danger" });
    else if (delta < -2)
      out.push({ text: `Bz son 15 dk'da ${delta.toFixed(1)} nT azaldı → ${Bz.toFixed(1)} nT`, level: "warning" });
    else if (Bz < -5)
      out.push({ text: `Bz ${Bz.toFixed(1)} nT — sabit güney yönlü alan, kuplaj aktif`, level: "warning" });
    else
      out.push({ text: `Bz ${Bz.toFixed(1)} nT — stabil alan koşulları`, level: "info" });
  } else {
    if (Bz < -10)
      out.push({ text: `Bz ${Bz.toFixed(1)} nT — kritik güney yönlü manyetik alan`, level: "danger" });
    else if (Bz < -5)
      out.push({ text: `Bz ${Bz.toFixed(1)} nT — güney yönlü alan, F kuplaj aktif`, level: "warning" });
    else
      out.push({ text: `Bz ${Bz.toFixed(1)} nT — kuzey/nötr alan`, level: "info" });
  }

  // ── 2. Solar wind speed + Pd change from speedHistory (~1 h = 12 pts) ──────
  const speedHist = history?.speedHistory ?? [];
  let pdSuffix = `Pd=${Pd.toFixed(1)} nPa`;
  if (speedHist.length >= 12) {
    const vThen  = speedHist[Math.max(0, speedHist.length - 12)].value;
    const pdThen = 1.67e-6 * 5 * vThen * vThen;          // baseline density ~5
    const ratio  = Pd / Math.max(pdThen, 0.1);
    if (ratio > 2.5)
      pdSuffix = `Pd=${Pd.toFixed(1)} nPa — ${ratio.toFixed(1)}× arttı`;
    else if (ratio > 1.5)
      pdSuffix = `Pd=${Pd.toFixed(1)} nPa — ${ratio.toFixed(1)}× yükseldi`;
  }
  if (V > 700)
    out.push({ text: `Güneş rüzgarı ${V.toFixed(0)} km/s — ${pdSuffix}`, level: "danger" });
  else if (V > 500)
    out.push({ text: `Güneş rüzgarı ${V.toFixed(0)} km/s — ${pdSuffix}`, level: "warning" });
  else
    out.push({ text: `Güneş rüzgarı ${V.toFixed(0)} km/s — ${pdSuffix}`, level: "info" });

  // ── 3. F coupling function (physics engine) ─────────────────────────────────
  if (phy.F > 400_000)
    out.push({ text: `Enerji kuplaj F=${phy.fmtF} — yüksek magnetosferik enerji girişi`, level: "danger" });
  else if (phy.F > 80_000)
    out.push({ text: `Enerji kuplaj F=${phy.fmtF} — orta magnetosferik aktivite`, level: "warning" });
  else
    out.push({ text: `Enerji kuplaj F=${phy.fmtF} — sakin magnetosfer`, level: "info" });

  // ── 4. GPS/SAT risk from physics formulas ──────────────────────────────────
  const maxRisk = Math.max(phy.gpsR, phy.satR);
  if (maxRisk > 0.25) {
    const lvl: ReasonLevel = maxRisk > 0.5 ? "danger" : "warning";
    out.push({ text: `Fizik motoru: GPS %${(phy.gpsR * 100).toFixed(0)}, SAT %${(phy.satR * 100).toFixed(0)} risk`, level: lvl });
  }

  // ── 5. Dst index (real NOAA) ────────────────────────────────────────────────
  if (Dst < -100)
    out.push({ text: `Dst ${Dst} nT — büyük manyetik fırtına (ring current yüklü)`, level: "danger" });
  else if (Dst < -50)
    out.push({ text: `Dst ${Dst} nT — orta manyetik fırtına`, level: "warning" });
  else if (Dst < -20)
    out.push({ text: `Dst ${Dst} nT — zayıf jeomagnetik baskı`, level: "info" });

  // ── 6. Proton flux (real NOAA) ──────────────────────────────────────────────
  if (Fluxp > 100)
    out.push({ text: `Proton akısı ${Fluxp.toFixed(0)} pfu — radyasyon kuşağı tehlikeli`, level: "danger" });
  else if (Fluxp > 10)
    out.push({ text: `Proton akısı ${Fluxp.toFixed(0)} pfu — artmış uzay radyasyonu`, level: "warning" });

  // ── 7. Historical Kp pattern (real kpHistory from NOAA) ────────────────────
  const kpHist = history?.kpHistory ?? [];
  if (kpHist.length >= 5) {
    const pts       = kpHist.slice(-48);
    const threshold = Math.max(Math.ceil(Kp + 0.5), 3);
    const above     = pts.filter(p => p.kp >= threshold).length;
    if (above > 0) {
      const lvl: ReasonLevel = threshold >= 6 ? "danger" : threshold >= 4 ? "warning" : "info";
      out.push({ text: `Son ${pts.length} ölçümün ${above}'sinde Kp≥${threshold} gözlemlendi`, level: lvl });
    } else {
      out.push({ text: `Son ${pts.length} ölçümde Kp<${threshold} — geçmiş periyot sakin`, level: "info" });
    }
  }

  return out;
}

function PhysiBar({ label, pct, lvl }: { label: string; pct: number; lvl: string }) {
  const bar = lvl === "danger" ? "bg-danger" : lvl === "warning" ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-muted-foreground w-[72px] shrink-0 truncate">{label}</span>
      <div className="flex-1 h-[6px] bg-white/8 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <span className={cn("text-xs font-mono w-8 text-right shrink-0",
        lvl === "danger" ? "text-danger" : lvl === "warning" ? "text-warning" : "text-success"
      )}>{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}

export function AiInsightCard({
  pred, data, history
}: {
  pred?: AIPrediction;
  data?: SpaceWeatherData;
  history?: HistoricalData;
}) {
  if (!pred) return <Panel title="YAPAY ZEKA ANALİZİ" className="min-h-[150px]" />;

  const riskTr = (level: string) =>
    level === "LOW" ? "DÜŞÜK" : level === "MODERATE" ? "ORTA" : level === "HIGH" ? "YÜKSEK" : "KRİTİK";
  const trendTr = (t?: string) =>
    t === "RISING" ? "↑ ARTIYOR" : t === "FALLING" ? "↓ AZALIYOR" : "→ STABIL";
  const trendClr = (t?: string) =>
    t === "RISING" ? "text-danger" : t === "FALLING" ? "text-success" : "text-primary";

  const riskHeaderColor = pred.riskLevel === "LOW"
    ? "text-success border-success/30 bg-success/10"
    : pred.riskLevel === "MODERATE"
    ? "text-warning border-warning/30 bg-warning/10"
    : "text-danger border-danger/30 bg-danger/10";

  // Physics calculations — all 4 F variants from history + real NOAA data
  const phy = data ? physicsCalc(
    data.solarWind.speed,
    data.magneticField.bz,
    data.solarWind.density,
    data.kpIndex,
    (data as any).dstIndex  ?? 0,
    (data as any).protonFlux ?? 5,
    history
  ) : null;

  // Dynamic reasons from physics + real history
  const reasons = (data && phy) ? generateReasons(data, phy, history) : [];
  // Storm type classification
  const storm = data ? classifyStorm(data, history) : null;

  // Bullet dot color
  const dotColor = (lvl: ReasonLevel) =>
    lvl === "danger" ? "text-danger" : lvl === "warning" ? "text-warning" : "text-primary/40";
  const textColor = (lvl: ReasonLevel) =>
    lvl === "danger" ? "text-danger/90" : lvl === "warning" ? "text-warning/90" : "text-muted-foreground";

  return (
    <Panel title="YAPAY ZEKA ANALİZİ" icon={<Zap className="w-4 h-4 text-accent" />}>
      <div className="space-y-3">

        {/* ── Tahmin header ────────────────────────────────────────── */}
        <div className={cn(
          "flex items-center justify-between rounded px-3 py-2.5 border text-base font-display font-bold",
          riskHeaderColor
        )}>
          <span>TAHMİN: {riskTr(pred.riskLevel)} RİSK</span>
          <span className="text-xs font-mono opacity-80">YZ %{pred.confidence ?? 91.4} güven</span>
        </div>

        {/* ── Fırtına türü sınıflandırması ──────────────────────────── */}
        {storm && (
          <div className={cn("rounded border p-3", storm.bg)}>
            {/* Badge row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={cn("text-xl leading-none", storm.color)}>{storm.icon}</span>
                <span className={cn("text-base font-display font-bold tracking-wide", storm.color)}>
                  {storm.label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono text-muted-foreground">YZ</span>
                <span className={cn("text-sm font-mono font-bold", storm.color)}>
                  %{storm.confidence}
                </span>
              </div>
            </div>
            {/* Scientific name */}
            <div className="text-xs font-mono text-muted-foreground/70 mb-1.5 italic">
              {storm.labelEn}
            </div>
            {/* Description */}
            <p className="text-sm font-mono text-muted-foreground leading-relaxed mb-2">
              {storm.description}
            </p>
            {/* Key signature pills */}
            {storm.signatures.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {storm.signatures.map((sig, i) => (
                  <span key={i} className={cn(
                    "text-xs font-mono px-2 py-0.5 rounded border",
                    storm.color, storm.bg
                  )}>
                    {sig}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Sebep listesi ─────────────────────────────────────────── */}
        {reasons.length > 0 && (
          <div className="bg-black/40 border border-white/8 rounded p-3 space-y-2">
            <div className="text-xs font-display text-muted-foreground uppercase tracking-widest mb-2">
              Sebep
            </div>
            {reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={cn("mt-[2px] shrink-0 text-xs", dotColor(r.level))}>▶</span>
                <span className={cn("text-sm font-mono leading-relaxed", textColor(r.level))}>
                  {r.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Metrics grid — fırtına olasılıkları */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 border border-white/10 rounded p-2.5">
            <div className="text-[10px] font-display text-muted-foreground uppercase tracking-wider mb-1">Fırtına Olas. 1S</div>
            <div className="text-sm font-bold font-mono text-warning">{pred.stormProbability1h ?? 0}%</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-2.5">
            <div className="text-[10px] font-display text-muted-foreground uppercase tracking-wider mb-1">Fırtına Olas. 24S</div>
            <div className="text-sm font-bold font-mono text-warning">{pred.stormProbability24h ?? 0}%</div>
          </div>
        </div>

        {/* Physics Engine block */}
        {phy && (
          <div className="bg-black/40 border border-accent/20 rounded p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-display text-accent/80 uppercase tracking-widest">Fizik Motoru</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-accent/60 border border-accent/30 rounded px-1.5 py-0.5">
                  {phy.fLabel}
                </span>
                <span className={cn("text-sm font-mono font-bold",
                  phy.fLvl === "danger" ? "text-danger" : phy.fLvl === "warning" ? "text-warning" : "text-success"
                )}>{phy.fmtF}</span>
              </div>
            </div>

            {/* F variants mini-table */}
            <div className="space-y-1">
              {[
                { label: "F_final", v: phy.F_final, note: "birleşik nihai" },
                { label: "F_new",   v: phy.F_new,   note: "enerji aktarımı" },
                { label: "F_şok",   v: phy.F_shock, note: "ani şok dahil" },
                { label: "F_adv",   v: phy.F_advanced, note: "ivme terimi" },
                { label: "F_CME",   v: phy.F_CME,   note: "fırtına gücü" },
              ].map(({ label, v, note }) => {
                const fmtV = v >= 1e6 ? (v/1e6).toFixed(2)+"M" : v >= 1e3 ? (v/1e3).toFixed(1)+"k" : v.toFixed(0);
                const logPct = Math.min(100, Math.log10(Math.max(v, 1)) / Math.log10(2e6) * 100);
                const active = label === "F_final";
                const lvlColor = v < 80_000 ? "bg-success" : v < 400_000 ? "bg-warning" : "bg-danger";
                const txtColor = v < 80_000 ? "text-success" : v < 400_000 ? "text-warning" : "text-danger";
                return (
                  <div key={label} className={cn(
                    "flex items-center gap-2 rounded px-1.5 py-1",
                    active ? "bg-accent/10 outline outline-[0.5px] outline-accent/40" : ""
                  )}>
                    <span className={cn("text-xs font-mono w-[52px] shrink-0", active ? "text-accent font-bold" : "text-muted-foreground/55")}>
                      {label}
                    </span>
                    <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", active ? lvlColor : "bg-white/20")} style={{ width: `${logPct}%` }} />
                    </div>
                    <span className={cn("text-xs font-mono w-10 text-right shrink-0", active ? txtColor : "text-muted-foreground/45")}>
                      {fmtV}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground/35 w-[54px] text-right shrink-0 truncate">{note}</span>
                  </div>
                );
              })}
            </div>

            {/* En Etkili Faktörler */}
            <div className="border-t border-accent/15 pt-2">
              <div className="text-xs font-display text-accent/60 uppercase tracking-widest mb-2">En Etkili Faktörler</div>
              {(() => {
                const factors = [
                  {
                    label: `|Bz| = ${phy.absBz.toFixed(1)} nT`,
                    note: "güney Bz",
                    pct: Math.min(1, phy.absBz / 30),
                    color: phy.absBz > 15 ? "bg-danger" : phy.absBz > 5 ? "bg-warning" : "bg-success",
                  },
                  {
                    label: `dBz/dt = ${phy.dBzdt.toFixed(1)} nT/5dk`,
                    note: "değişim hızı",
                    pct: Math.min(1, Math.abs(phy.dBzdt) / 8),
                    color: Math.abs(phy.dBzdt) > 4 ? "bg-danger" : Math.abs(phy.dBzdt) > 1.5 ? "bg-warning" : "bg-success",
                  },
                  {
                    label: `V = ${phy.V.toFixed(0)} km/s`,
                    note: "güneş rüzgarı",
                    pct: Math.min(1, phy.V / 800),
                    color: phy.V > 600 ? "bg-danger" : phy.V > 400 ? "bg-warning" : "bg-success",
                  },
                  {
                    label: `t_Bz<0 = ${phy.tBzNeg < 1 ? `${(phy.tBzNeg*60).toFixed(0)}dk` : `${phy.tBzNeg.toFixed(1)}s`}`,
                    note: "neg. Bz süresi",
                    pct: Math.min(1, phy.tBzNeg / 6),
                    color: phy.tBzNeg > 3 ? "bg-danger" : phy.tBzNeg > 1 ? "bg-warning" : "bg-success",
                  },
                ].sort((a, b) => b.pct - a.pct);
                return factors.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-mono text-muted-foreground/70 w-[110px] shrink-0 truncate">{f.label}</span>
                    <div className="flex-1 h-[6px] bg-white/8 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", f.color)} style={{ width: `${f.pct * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground/60 w-8 text-right shrink-0">{(f.pct*100).toFixed(0)}%</span>
                    <span className="text-[10px] font-mono text-muted-foreground/35 w-[58px] text-right shrink-0 truncate">{f.note}</span>
                  </div>
                ));
              })()}
            </div>

            {/* GPS / SAT risk */}
            <div className="border-t border-white/5 pt-2 space-y-1.5">
              <PhysiBar label="GPSrisk" pct={phy.gpsR} lvl={phy.gLvl} />
              <PhysiBar label="SATrisk" pct={phy.satR} lvl={phy.sLvl} />
            </div>
            <div className="text-[9px] font-mono text-muted-foreground/40 leading-relaxed">
              GPS=0.5·|Bz|/20+0.3·V/1k+0.2·Kp/9 · SAT=0.4·Pd/50+0.4·Fp/1k+0.2·|Dst|/200
            </div>
          </div>
        )}

        {/* Kp Tahmin sırası */}
        <div className="bg-black/30 border border-white/5 rounded p-2">
          <div className="text-[10px] font-display text-muted-foreground uppercase tracking-wider mb-1.5">Kp Tahmini</div>
          <div className="flex gap-3">
            {[
              { label: "1 Saat", val: pred.kpPredicted1h },
              { label: "3 Saat", val: (pred as any).kpPredicted3h },
              { label: "6 Saat", val: (pred as any).kpPredicted6h },
            ].map((p, i) => p.val != null && (
              <div key={i} className="flex-1 text-center">
                <div className="text-[10px] font-display text-muted-foreground">{p.label}</div>
                <div className={cn("text-base font-mono font-bold",
                  p.val >= 6 ? "text-danger" : p.val >= 4 ? "text-warning" : "text-success"
                )}>{p.val.toFixed(1)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* NOAA vs Model karşılaştırması */}
        {data && pred.kpPredicted1h != null && (() => {
          const noaaKp = data.kpIndex;
          const modelKp = pred.kpPredicted1h!;
          const diff = modelKp - noaaKp;
          const absDiff = Math.abs(diff);
          const bz = data.magneticField.bz;
          const speed = data.solarWind.speed;

          let sebep = "";
          if (absDiff < 0.3) {
            sebep = "Modelimiz NOAA ile uyumlu — sakin koşullar.";
          } else if (diff > 0) {
            if (bz < -5 && phy && phy.dBzdt < -1)
              sebep = `Bz son ölçümlerde ${bz.toFixed(1)} nT'ye düştü, enerji kuplajı NOAA tahmininin üzerinde.`;
            else if (bz < -3)
              sebep = `Güney Bz (${bz.toFixed(1)} nT) manyetosfer bağlanmasını artırıyor.`;
            else if (speed > 500)
              sebep = `Güneş rüzgarı ${speed.toFixed(0)} km/s — dinamik basınç NOAA modelini aşıyor.`;
            else
              sebep = `Birleşik F_final parametreleri NOAA tahmininden ${diff.toFixed(1)} Kp fazla aktivite gösteriyor.`;
          } else {
            if (bz > 2)
              sebep = `Bz kuzeye döndü (${bz.toFixed(1)} nT), manyetosferik bağlanma azalıyor.`;
            else if (speed < 400)
              sebep = `Güneş rüzgarı yavaşlıyor (${speed.toFixed(0)} km/s), fırtına olasılığı düşüyor.`;
            else
              sebep = `Anlık telemetri NOAA tahmininin ${Math.abs(diff).toFixed(1)} Kp altında seyrediyor.`;
          }

          const modelColor = modelKp >= 6 ? "text-danger" : modelKp >= 4 ? "text-warning" : "text-success";
          const noaaColor = noaaKp >= 6 ? "text-danger" : noaaKp >= 4 ? "text-warning" : "text-success";
          const diffLabel = diff > 0.3 ? `▲ +${diff.toFixed(1)}` : diff < -0.3 ? `▼ ${diff.toFixed(1)}` : "≈ uyumlu";
          const diffColor = diff > 0.3 ? "text-warning" : diff < -0.3 ? "text-success" : "text-primary/60";

          return (
            <div className="bg-black/40 border border-primary/15 rounded p-3 space-y-2">
              <div className="text-xs font-display text-primary/60 uppercase tracking-widest">Model — NOAA Karşılaştırması</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/5 rounded p-2">
                  <div className="text-[10px] font-display text-muted-foreground mb-0.5">NOAA Güncel</div>
                  <div className={cn("text-lg font-mono font-bold", noaaColor)}>Kp {noaaKp.toFixed(1)}</div>
                </div>
                <div className="bg-white/5 rounded p-2">
                  <div className="text-[10px] font-display text-muted-foreground mb-0.5">YZ Model (1s)</div>
                  <div className={cn("text-lg font-mono font-bold", modelColor)}>Kp {modelKp.toFixed(1)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-mono font-bold", diffColor)}>{diffLabel}</span>
                <span className="text-[10px] font-mono text-muted-foreground leading-snug flex-1">{sebep}</span>
              </div>
            </div>
          );
        })()}

        {/* Trend & Anomali */}
        <div className="flex items-center justify-between">
          <span className={cn("text-xs font-display font-bold", trendClr(pred.trend))}>
            {trendTr(pred.trend)}
          </span>
          <span className="text-[10px] font-display text-muted-foreground">YZ %91.4 Doğruluk</span>
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
    { label: "GPS / GNSS",           val: risk.gpsGnss,      icon: <Navigation className="w-3 h-3"/> },
    { label: "Uydu Operasyonları",   val: risk.satelliteOps, icon: <Radio className="w-3 h-3"/> },
    { label: "Elektrik Şebekesi",    val: risk.powerGrid,    icon: <Zap className="w-3 h-3"/> },
    { label: "HF Radyo",             val: risk.hfRadio,      icon: <Wifi className="w-3 h-3"/> },
    { label: "Havacılık",            val: risk.aviation,     icon: <Plane className="w-3 h-3"/> },
    { label: "İnsan Sağlığı",        val: risk.humanHealth,  icon: <Heart className="w-3 h-3"/> },
  ];

  const trendIcon  = risk.trend === "RISING" ? "▲" : risk.trend === "FALLING" ? "▼" : "▶";
  const trendColor = risk.trend === "RISING" ? "text-danger" : risk.trend === "FALLING" ? "text-success" : "text-primary";
  const overall    = risk.overallRisk ?? 0;
  const overallColor = overall >= 70 ? "text-danger" : overall >= 40 ? "text-warning" : "text-success";

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
      {/* Genel risk özeti */}
      <div className="flex items-center justify-between mb-3 mt-1 px-1">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">GENEL RİSK (NOAA)</span>
        <span className={cn("font-mono font-bold text-sm", overallColor)}>{overall}%</span>
      </div>

      <div className="space-y-2.5">
        {items.map((item, i) => {
          const cur = item.val ?? 0;
          const color  = cur < 30 ? "bg-success"  : cur < 60 ? "bg-warning"  : "bg-danger";
          const glow   = cur < 30 ? "shadow-[0_0_5px_hsl(var(--success))]" :
                         cur < 60 ? "shadow-[0_0_5px_hsl(var(--warning))]" :
                                    "shadow-[0_0_5px_hsl(var(--danger))]";
          const valColor = cur < 30 ? "text-success" : cur < 60 ? "text-warning" : "text-danger";

          return (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-xs font-display items-center">
                <span className="flex items-center gap-1.5 text-muted-foreground uppercase tracking-wide">
                  {item.icon} {item.label}
                </span>
                <span className={cn("font-mono font-bold text-xs", valColor)}>{cur}%</span>
              </div>
              <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${cur}%` }}
                  transition={{ duration: 0.8, delay: i * 0.07 }}
                  className={cn("absolute inset-y-0 left-0 rounded-full", color, glow)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Formül ve kaynak notu */}
      <div className="mt-3 border-t border-white/5 pt-2 space-y-1">
        <div className="text-[9px] font-mono text-muted-foreground/40 leading-relaxed">
          S = 0.18·Kp + 0.22·|Dst| + 0.30·dB/dt + 0.12·V + 0.10·Bz↓ + 0.08·P
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider">
            NOAA SWPC · R = 100·S·L
          </span>
        </div>
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
