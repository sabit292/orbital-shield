import React, { useMemo, useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetCurrentSpaceWeather,
  useGetAIPrediction,
  useGetInfrastructureRisk,
  useGetSpaceWeatherHistory,
} from "@workspace/api-client-react";
import {
  Plane, Radio, Navigation, Zap, ShieldAlert,
  TrendingUp, TrendingDown, Minus, ArrowLeft,
  CheckCircle2, AlertTriangle, XCircle, Clock,
  Bell, BellRing, Calculator, Satellite
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
type StatusLevel = "normal" | "caution" | "warning" | "critical";

interface Alarm {
  id: string;
  level: "warning" | "critical";
  title: string;
  detail: string;
  routes?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function turkeyTime(): string {
  const now = new Date();
  // Turkey is UTC+3 (no DST)
  const trt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const hh = String(trt.getUTCHours()).padStart(2, "0");
  const mm = String(trt.getUTCMinutes()).padStart(2, "0");
  const ss = String(trt.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} TRT`;
}

function statusColor(level: StatusLevel) {
  return {
    normal:   { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400" },
    caution:  { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30",   dot: "bg-amber-400"   },
    warning:  { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/30",  dot: "bg-orange-400"  },
    critical: { bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30",     dot: "bg-red-400"     },
  }[level];
}

function StatusIcon({ level }: { level: StatusLevel }) {
  const cls = "w-4 h-4";
  if (level === "normal")   return <CheckCircle2  className={`${cls} text-emerald-400`} />;
  if (level === "caution")  return <AlertTriangle className={`${cls} text-amber-400`} />;
  if (level === "warning")  return <AlertTriangle className={`${cls} text-orange-400`} />;
  return <XCircle className={`${cls} text-red-400`} />;
}

function kpToLevel(kp: number, thresholds: [number, number, number]): StatusLevel {
  if (kp < thresholds[0]) return "normal";
  if (kp < thresholds[1]) return "caution";
  if (kp < thresholds[2]) return "warning";
  return "critical";
}

function levelLabel(l: StatusLevel) {
  return { normal: "NORMAL", caution: "DİKKATLİ", warning: "UYARI", critical: "KRİTİK" }[l];
}

function TrendIcon({ val, prev }: { val: number; prev: number }) {
  const d = val - prev;
  if (Math.abs(d) < 0.1) return <Minus className="w-3 h-3 text-slate-400" />;
  if (d > 0) return <TrendingUp className="w-3 h-3 text-orange-400" />;
  return <TrendingDown className="w-3 h-3 text-emerald-400" />;
}

// ── AI Danger Alarms ──────────────────────────────────────────────────────────

function buildAlarms(kp: number, bz: number, xray: number, storm24: number, kp6h: number): Alarm[] {
  const alarms: Alarm[] = [];

  if (kp >= 7) {
    alarms.push({
      id: "kp-critical",
      level: "critical",
      title: "ŞİDDETLİ JEOMARNETİK FIRTINA — KUTUP GÜZERGAHI KAPATILDI",
      detail: `Kp=${kp.toFixed(1)} — Kp≥7 eşiği aşıldı. ICAO prosedürleri gereği tüm transpolar uçuşlar güney güzergaha yönlendirilmeli. HF haberleşme büyük ihtimalle kesik.`,
      routes: "TK 51 (IST-NRT) · TK 9 (IST-LAX)",
    });
  } else if (kp >= 5) {
    alarms.push({
      id: "kp-warning",
      level: "warning",
      title: "ORTA-GÜÇLÜ JEOMAGNETİK AKTİVİTE — KUTUP GÜZERGAHI İZLEMEDE",
      detail: `Kp=${kp.toFixed(1)} — Polar rota yoğun izlemede. HF kalitesi bozulabilir, SELCAL monitörü aktif tutun. Alternatif güzergah planı hazır olsun.`,
      routes: "TK 51 (IST-NRT) · TK 9 (IST-LAX) · TK 1 (IST-JFK)",
    });
  }

  if (bz < -15) {
    alarms.push({
      id: "bz-critical",
      level: "critical",
      title: "GÜNEY YÖNELİMLİ Bz KRİTİK — GPS/GNSS GÜVENİLMEZ",
      detail: `Bz=${bz.toFixed(1)} nT — Çok güçlü güney Bz, iyonosferi ciddi biçimde bozuyor. RNP AR prosedürleri iptal edilmeli, BARO-VNAV veya ILS zorunlu.`,
      routes: "TK 1 · TK 5 · TK 9 · TK 15 · TK 51 · TK 53",
    });
  } else if (bz < -10) {
    alarms.push({
      id: "bz-warning",
      level: "warning",
      title: "GÜNEY Bz UYARISI — GPS HASSASIYETI AZALDI",
      detail: `Bz=${bz.toFixed(1)} nT — İyonosferik bozulma başladı. GPS hatası artabilir; uçuş planı ILS yedeklemesiyle güncellenmeli.`,
      routes: "TK 1 (IST-JFK) · TK 5 (IST-ORD)",
    });
  }

  if (xray >= 1e-4) {
    alarms.push({
      id: "xray-critical",
      level: "critical",
      title: "X SINIFI GÜNEŞ PATLAMASİ — HF BLACKOUT RİSKİ",
      detail: "X sınıfı patlama tespit edildi. Güneş ışığı altındaki bölgelerde kısa dalga radyo tamamen kesintili olabilir. SATCOM birincil iletişim kanalı olarak kullanılmalı.",
      routes: "TK 1 · TK 5 · TK 9 · TK 15 (gündüz segmentleri)",
    });
  } else if (xray >= 1e-5) {
    alarms.push({
      id: "xray-warning",
      level: "warning",
      title: "M SINIFI GÜNEŞ PATLAMASİ — HF KALİTESİ DÜŞÜK",
      detail: "M sınıfı patlama. Gündüz segmentlerinde HF sönümlenmesi bekleniyor. SELCAL takibi ve yedek SATCOM kanalı aktif olmalı.",
      routes: "TK 1 (IST-JFK) · TK 5 (IST-ORD)",
    });
  }

  if (storm24 >= 60) {
    alarms.push({
      id: "storm-incoming",
      level: "critical",
      title: "YÜKSEK FIRTINA OLASIĞI — ÖN HAZIRLIK ALARMI",
      detail: `24 saatlik fırtına olasılığı %${storm24.toFixed(0)}. YZ modeli önümüzdeki periyotta önemli jeomagnetik aktivite bekliyor. Tüm uzun menzilli uçuş planlaması revize edilmeli.`,
    });
  } else if (storm24 >= 35) {
    alarms.push({
      id: "storm-caution",
      level: "warning",
      title: "ARTAN FIRTINA OLASIĞI — PLANLAMA UYARISI",
      detail: `24 saatlik fırtına olasılığı %${storm24.toFixed(0)}. Transatlantik ve kutup rotaları için alternatif güzergah senaryoları hazırlanmalı.`,
    });
  }

  if (kp6h >= 5 && kp < 5) {
    alarms.push({
      id: "incoming-activity",
      level: "warning",
      title: "YZ TAHMİNİ — 6 SAAT İÇİNDE BOZULMA BEKLENİYOR",
      detail: `Mevcut Kp=${kp.toFixed(1)} sakin görünse de YZ 6 saat içinde Kp≥${kp6h.toFixed(1)} öngörüyor. Uzun menzilli uçuş planlamacıları şimdiden alternatif rotaları değerlendirmeli.`,
      routes: "TK 51 (IST-NRT) · TK 1 (IST-JFK) · TK 9 (IST-LAX)",
    });
  }

  return alarms;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AlarmBanner({ alarms }: { alarms: Alarm[] }) {
  if (alarms.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <div>
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">YZ Alarm: Aktif Tehlike Yok</span>
          <p className="text-[11px] text-slate-400 mt-0.5">Tüm uzay hava parametreleri havacılık için güvenli seviyelerde. Tüm THY güzergahları normal operasyona uygun.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {alarms.map(a => (
        <div
          key={a.id}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
            a.level === "critical"
              ? "border-red-500/40 bg-red-500/10"
              : "border-orange-500/40 bg-orange-500/10"
          }`}
        >
          <BellRing className={`w-4 h-4 flex-shrink-0 mt-0.5 ${a.level === "critical" ? "text-red-400" : "text-orange-400"}`} />
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold uppercase tracking-widest ${a.level === "critical" ? "text-red-400" : "text-orange-400"}`}>
              {a.title}
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">{a.detail}</p>
            {a.routes && (
              <div className="mt-1 text-[10px] text-slate-500">
                Etkilenen güzergahlar: <span className="text-slate-400 font-mono">{a.routes}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  unit?: string;
  level: StatusLevel;
  description: string;
  trend?: React.ReactNode;
}

function MetricCard({ icon, title, value, unit, level, description, trend }: MetricCardProps) {
  const c = statusColor(level);
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4 flex flex-col gap-3`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="text-slate-400">{icon}</div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{title}</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${c.bg} ${c.text} border ${c.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {levelLabel(level)}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white tracking-tight">{value}</span>
        {unit && <span className="text-sm text-slate-400 mb-0.5">{unit}</span>}
        {trend && <span className="mb-1 ml-1">{trend}</span>}
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

interface RouteRowProps {
  flightNo: string;
  origin: string;
  dest: string;
  routeType: string;
  fl: string;
  commStatus: StatusLevel;
  gpsStatus: StatusLevel;
  radText: string;
  recommendation: string;
}

function RouteRow({ flightNo, origin, dest, routeType, fl, commStatus, gpsStatus, radText, recommendation }: RouteRowProps) {
  const cc = statusColor(commStatus);
  const gc = statusColor(gpsStatus);
  // overall severity for row highlight
  const levels: StatusLevel[] = [commStatus, gpsStatus];
  const worst: StatusLevel = levels.includes("critical") ? "critical"
    : levels.includes("warning") ? "warning"
    : levels.includes("caution") ? "caution" : "normal";

  return (
    <tr className={`border-b border-slate-700/40 hover:bg-slate-800/30 transition-colors ${worst === "critical" ? "bg-red-900/10" : worst === "warning" ? "bg-orange-900/8" : ""}`}>
      <td className="py-3 px-4">
        <div className="font-mono font-bold text-white text-sm">{flightNo}</div>
        <div className="text-[10px] text-blue-400 mt-0.5">{origin} → {dest}</div>
        <div className="text-[10px] text-slate-500">{routeType} · {fl}</div>
      </td>
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${cc.bg} ${cc.text}`}>
          <StatusIcon level={commStatus} />
          {levelLabel(commStatus)}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${gc.bg} ${gc.text}`}>
          <StatusIcon level={gpsStatus} />
          {levelLabel(gpsStatus)}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-slate-300 font-mono">{radText}</td>
      <td className="py-3 px-4 text-xs text-slate-400 max-w-[200px] leading-relaxed">{recommendation}</td>
    </tr>
  );
}

// ── THY Routes ────────────────────────────────────────────────────────────────

function buildRoutes(kp: number, bz: number, xray: number) {
  const hfLevel:   StatusLevel = kpToLevel(kp, [3, 5, 7]);
  const gpsLevel:  StatusLevel = bz < -10 ? "warning" : bz < -5 ? "caution" : kpToLevel(kp, [4, 6, 8]);
  const polarHF:   StatusLevel = kp >= 7 ? "critical" : kp >= 5 ? "warning" : kp >= 3 ? "caution" : "normal";
  const polarGPS:  StatusLevel = kpToLevel(kp, [4, 6, 8]);

  const radNormal  = kp < 3 ? "Düşük" : kp < 5 ? "Normal" : kp < 7 ? "Orta" : "Yüksek";
  const radPolar   = kp < 3 ? "Normal" : kp < 5 ? "Orta"   : kp < 7 ? "Yüksek" : "KRİTİK";
  const radMid     = kp < 4 ? "Düşük" : kp < 6 ? "Normal" : "Orta";

  const hfRec = (level: StatusLevel) =>
    level === "normal"   ? "Standart operasyon, HF nominal" :
    level === "caution"  ? "SELCAL monitörü aktif tutun" :
    level === "warning"  ? "SATCOM yedek aktif edin, HF izle" :
                           "HF kullanmayın, yalnızca SATCOM";

  const gpsRec = (gl: StatusLevel) =>
    gl === "normal"   ? "" :
    gl === "caution"  ? "GPS drift takibi, ILS yedek hazır" :
    gl === "warning"  ? "RNP AR iptal, BARO-VNAV zorunlu" :
                        "GPS GÜVENİLMEZ — ILS / BARO zorunlu";

  const mergeRec = (h: StatusLevel, g: StatusLevel) => {
    const r: string[] = [];
    const hr = hfRec(h); if (hr) r.push(hr);
    const gr = gpsRec(g); if (gr) r.push(gr);
    return r.length ? r.join("; ") : "Tüm sistemler nominal";
  };

  return [
    { flightNo: "TK 1",  origin: "IST", dest: "JFK", routeType: "Kuzey Atlantik NAT-A", fl: "FL350-FL370", commStatus: hfLevel,  gpsStatus: gpsLevel, radText: radNormal, recommendation: mergeRec(hfLevel, gpsLevel)  },
    { flightNo: "TK 5",  origin: "IST", dest: "ORD", routeType: "Kuzey Atlantik NAT-B", fl: "FL360",       commStatus: hfLevel,  gpsStatus: gpsLevel, radText: radNormal, recommendation: mergeRec(hfLevel, gpsLevel)  },
    { flightNo: "TK 51", origin: "IST", dest: "NRT", routeType: "Sibirya / Polar",       fl: "FL380",       commStatus: polarHF, gpsStatus: polarGPS, radText: radPolar,  recommendation: mergeRec(polarHF, polarGPS)  },
    { flightNo: "TK 9",  origin: "IST", dest: "LAX", routeType: "Kuzey Pasifik PACOTS",  fl: "FL370-FL390", commStatus: kp > 4 ? "caution" as StatusLevel : "normal",  gpsStatus: gpsLevel, radText: radMid,    recommendation: mergeRec(kp > 4 ? "caution" : "normal", gpsLevel) },
    { flightNo: "TK 15", origin: "IST", dest: "GRU", routeType: "Atlantik Güney",        fl: "FL350",       commStatus: hfLevel === "critical" ? "warning" as StatusLevel : hfLevel === "warning" ? "caution" as StatusLevel : "normal", gpsStatus: "normal" as StatusLevel, radText: "Düşük",      recommendation: "Afrika + Güney Atlantik segment, düşük etki" },
    { flightNo: "TK 53", origin: "IST", dest: "JNB", routeType: "Afrika Rotası",         fl: "FL360",       commStatus: "normal" as StatusLevel, gpsStatus: "normal" as StatusLevel, radText: "Düşük",      recommendation: "VHF kapsama alanı yeterli, etkilenme minimal"  },
  ];
}

// ── Physics Engine ────────────────────────────────────────────────────────────

/**
 * F = V^1.5 · |Bz|^1.2 · n^0.3 · (1 + 0.5·|dBz/dt|)
 * Güneş-Yer enerji aktarım kuplaj fonksiyonu.
 * Sessiz koşullar ~10k–80k | Orta ~80k–400k | Güçlü >400k | Şiddetli >1M
 */
function calcF(V: number, Bz: number, n: number, dBzdt: number): number {
  const absBz = Math.max(Math.abs(Bz), 0.01);
  return Math.pow(V, 1.5) * Math.pow(absBz, 1.2) * Math.pow(Math.max(n, 0.01), 0.3) * (1 + 0.5 * Math.abs(dBzdt));
}

/**
 * GPSrisk = 0.5·(|Bz|/20) + 0.3·(V/1000) + 0.2·(Kp/9)
 * 0–1 normalize edilmiş. >0.5 = uyarı, >0.75 = kritik.
 */
function calcGPSrisk(Bz: number, V: number, Kp: number): number {
  return 0.5 * (Math.abs(Bz) / 20) + 0.3 * (V / 1000) + 0.2 * (Kp / 9);
}

/**
 * SATrisk = 0.4·(Pd/50) + 0.4·(Fluxp/1000) + 0.2·(|Dst|/200)
 * Pd: dinamik basınç (nPa) = 1.67e-6·n·V²
 * Fluxp: proton akısı tahmini (Kp bazlı, pfu)
 * Dst: jeomagnetik fırtına indeksi tahmini (nT, Kp bazlı)
 */
function calcSATrisk(n: number, V: number, Kp: number): { sat: number; Pd: number; Fluxp: number; Dst: number } {
  const Pd    = 1.67e-6 * n * V * V;                          // nPa
  const Fluxp = Kp > 5 ? (Kp - 5) * 250 : Kp > 3 ? (Kp - 3) * 20 : 5; // pfu (crude proxy)
  const Dst   = -(7.26 * Kp + 0.05 * Kp * Kp);              // nT estimate
  const sat   = 0.4 * (Pd / 50) + 0.4 * (Fluxp / 1000) + 0.2 * (Math.abs(Dst) / 200);
  return { sat, Pd, Fluxp, Dst };
}

function fLevel(F: number): StatusLevel {
  if (F < 80_000)  return "normal";
  if (F < 400_000) return "caution";
  if (F < 1_000_000) return "warning";
  return "critical";
}

function riskLevel(r: number): StatusLevel {
  if (r < 0.25) return "normal";
  if (r < 0.50) return "caution";
  if (r < 0.75) return "warning";
  return "critical";
}

function fmtF(F: number): string {
  if (F >= 1_000_000) return (F / 1_000_000).toFixed(2) + "M";
  if (F >= 1_000)     return (F / 1_000).toFixed(1) + "k";
  return F.toFixed(0);
}

// Gauge bar for formula terms
function TermBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-slate-500 font-mono">{label}</span>
        <span className="text-[10px] text-slate-300 font-mono font-bold">{value}</span>
      </div>
      <div className="w-full h-1 bg-slate-700/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
    </div>
  );
}

interface PhysicsRowProps {
  icon: React.ReactNode;
  label: string;
  formulaLabel: string;
  value: string;
  pct: number;          // 0–1 for the big gauge
  level: StatusLevel;
  terms: Array<{ label: string; value: string; pct: number }>;
}

function PhysicsCard({ icon, label, formulaLabel, value, pct, level, terms }: PhysicsRowProps) {
  const c = statusColor(level);
  const barColor = level === "critical" ? "bg-red-500" : level === "warning" ? "bg-orange-500" : level === "caution" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={`rounded-xl border ${c.border} bg-[#0c1e35] p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{icon}</span>
          <div>
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest leading-none">{label}</div>
            <div className="text-[9px] text-slate-600 font-mono mt-0.5">{formulaLabel}</div>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${c.bg} ${c.text} border ${c.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {levelLabel(level)}
        </div>
      </div>
      {/* Big value */}
      <div className="flex items-end gap-2">
        <span className={`text-2xl font-bold tracking-tight ${c.text}`}>{value}</span>
      </div>
      {/* Master progress bar */}
      <div className="w-full h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      {/* Term breakdown */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-700/40">
        {terms.map(t => (
          <TermBar key={t.label} label={t.label} value={t.value} pct={t.pct} color={barColor} />
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AviationPage() {
  const [, navigate] = useLocation();
  const [clock, setClock] = useState(turkeyTime());

  const { data: current } = useGetCurrentSpaceWeather({ refetchInterval: 60000 });
  const { data: pred }    = useGetAIPrediction({ refetchInterval: 60000 });
  const { data: risk }    = useGetInfrastructureRisk({ refetchInterval: 60000 });
  const { data: hist }    = useGetSpaceWeatherHistory({ refetchInterval: 60000 });

  // Live clock (TRT = UTC+3)
  useEffect(() => {
    const t = setInterval(() => setClock(turkeyTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const kp      = current?.kpIndex ?? 0;
  const bz      = current?.solarWind?.bz ?? 0;
  const speed   = current?.solarWind?.speed ?? 400;
  const density = current?.solarWind?.density ?? 5;
  const xray    = current?.xrayFlux?.current ?? 0;
  const avRisk  = risk?.aviation ?? 0;
  // Real NOAA values for SATrisk formula (from ExtraDataCard sources)
  const dstIndex  = (current as any)?.dstIndex ?? 0;          // nT
  const protonFlux = (current as any)?.protonFlux ?? 5;       // pfu

  // Track previous Bz for dBz/dt (rate of change)
  const prevBzRef = useRef<number>(bz);
  const dBzdt = bz - prevBzRef.current;
  useEffect(() => { prevBzRef.current = bz; }, [bz]);

  // ── Physics Engine Calculations ──────────────────────────────────────────────
  const physics = useMemo(() => {
    // F = V^1.5 · |Bz|^1.2 · n^0.3 · (1 + 0.5·|dBz/dt|)
    const F = calcF(speed, bz, density, dBzdt);

    // GPSrisk = 0.5·(|Bz|/20) + 0.3·(V/1000) + 0.2·(Kp/9)
    const gpsR = calcGPSrisk(bz, speed, kp);
    const gpsTerm1 = 0.5 * (Math.abs(bz) / 20);
    const gpsTerm2 = 0.3 * (speed / 1000);
    const gpsTerm3 = 0.2 * (kp / 9);

    // SATrisk = 0.4·(Pd/50) + 0.4·(Fluxp/1000) + 0.2·(|Dst|/200)
    // Use REAL Dst and protonFlux from NOAA API; Pd computed from density & speed
    const Pd      = 1.67e-6 * density * speed * speed;            // nPa
    const Fluxp   = Math.max(protonFlux, 0);                      // pfu — real API value
    const Dst     = dstIndex;                                      // nT  — real API value
    const satR    = 0.4 * (Pd / 50) + 0.4 * (Fluxp / 1000) + 0.2 * (Math.abs(Dst) / 200);
    const satTerm1 = 0.4 * (Pd / 50);
    const satTerm2 = 0.4 * (Fluxp / 1000);
    const satTerm3 = 0.2 * (Math.abs(Dst) / 200);

    // F normalization (log scale: quiet ~10k → 0.25, extreme ~2M → 1.0)
    const fNorm = Math.min(1, Math.log10(Math.max(F, 1)) / Math.log10(2_000_000));

    return {
      F, fNorm,
      gpsR, gpsTerm1, gpsTerm2, gpsTerm3,
      satR, satTerm1, satTerm2, satTerm3,
      Pd, Fluxp, Dst,
    };
  }, [bz, speed, density, kp, dBzdt, dstIndex, protonFlux]);

  // Metric levels — GPS now driven by physics formula
  const hfLevel:    StatusLevel = kpToLevel(kp, [3, 5, 7]);
  const gpsLevel:   StatusLevel = riskLevel(physics.gpsR);
  const satLevel:   StatusLevel = riskLevel(physics.satR);
  const radLevel:   StatusLevel = kpToLevel(kp, [4, 6, 8]);
  const polarLevel: StatusLevel = kp >= 7 ? "critical" : kp >= 5 ? "warning" : kp >= 3 ? "caution" : "normal";

  const hfDesc = {
    normal:   "HF kanalları nominal. NAT ve PACOTS güzergahlarında standart haberleşme sürdürülebilir.",
    caution:  "Kp artışı HF kalitesini etkiliyor. SELCAL monitörü aktif, SATCOM yedek hazır olmalı.",
    warning:  "HF sönümlenmesi başladı. Okyanus geçişlerinde SATCOM'u birincil kanal olarak kullanın.",
    critical: "HF blackout riski kritik. SELCAL yetersiz kalabilir. Yalnızca SATCOM ile devam edin.",
  }[hfLevel];

  const gpsDesc = {
    normal:   "GPS/GNSS tam hassasiyette. RNP AR ve RNP 0.1 prosedürleri güvenle uygulanabilir.",
    caution:  "İyonosferik bozulma başladı. GPS hatası ±5-10 m arası artabilir. ILS yedekleme aktif edin.",
    warning:  "GPS doğruluğu güvenilir değil. RNP AR prosedürleri kısıtlı; BARO-VNAV ve ILS zorunlu.",
    critical: "GPS/GNSS kullanılamaz. Tüm RNAV/RNP prosedürleri iptal. ILS / BARO-VNAV ile devam edin.",
  }[gpsLevel];

  const radDesc = {
    normal:   "Kutup rotası radyasyon dozu ICRP sınırları içinde. Ekstra kısıtlama gerekmez.",
    caution:  "Yüksek irtifa kutup rotalarında doz artışı. Mürettebat maruziyeti takip edilmeli.",
    warning:  "Radyasyon dozu artıyor. IATA rehberi doğrultusunda daha güney rota değerlendirin.",
    critical: "Kutup rotasında radyasyon kritik seviyede. Transpolar uçuş derhal güneye yönlendirilmeli.",
  }[radLevel];

  const polarDesc = {
    normal:   "Transpolar güzergah açık. Kp eşiği aşılmamış, kutup rotası serbesttir.",
    caution:  "Kutup güzergahı takipte. Kp artışı durumunda hızlı güzergah değişimine hazır olun.",
    warning:  "Kutup rota kısıtlamaları uygulanıyor. Operatörler alternatif güney güzergahı tercih etmeli.",
    critical: "Kutup güzergahı kapatıldı. Kp≥7 — tüm transpolar uçuşlar güney rotalara yönlendirilmeli.",
  }[polarLevel];

  // AI outlook
  const kp1h    = pred?.predictions?.kp1h  ?? kp;
  const kp3h    = pred?.predictions?.kp3h  ?? kp;
  const kp6h    = pred?.predictions?.kp6h  ?? kp;
  const aiConf  = pred?.confidence ?? 91.4;
  const storm24 = pred?.stormProbability24h ?? 0;

  const outlook1h: StatusLevel = kpToLevel(kp1h, [3, 5, 7]);
  const outlook6h: StatusLevel = kpToLevel(kp6h, [3, 5, 7]);

  const outlookText =
    kp6h < 3  ? "Önümüzdeki 6 saat sakin. Tüm THY güzergahlarında standart operasyon sürdürülebilir. HF ve GPS etkilenmez." :
    kp6h < 5  ? `YZ modeli ${kp6h.toFixed(1)} Kp öngörüyor. NAT güzergahlarında HF kalitesi hafif düşebilir; transatlantik uçuşlarda SELCAL monitörü aktif tutulmalı.` :
    kp6h < 7  ? `${kp6h.toFixed(1)} Kp tahmin ediliyor — güçlü aktivite. TK 51 (IST-NRT) polar rotası için alternatif hazırlayın. TK 1 ve TK 5'te HF bozulması bekleniyor.` :
                `Şiddetli fırtına riski — Kp ${kp6h.toFixed(1)}. TK 51 polar rotası kapatılmalı. Tüm transatlantik uçuşlarda SATCOM zorunlu. Acil uçuş planı revizyonu öneririz.`;

  // AI alarms from real data
  const alarms = useMemo(
    () => buildAlarms(kp, bz, xray, storm24, kp6h),
    [kp, bz, xray, storm24, kp6h]
  );

  // THY routes
  const routes = useMemo(() => buildRoutes(kp, bz, xray), [kp, bz, xray]);

  // Chart data — GPS/SAT risk from physics formulas, Kp from history
  // (history only has kpIndex reliably; use current Bz/V for other terms)
  const chartData = useMemo(() => {
    if (!hist?.history?.length) return [];
    return hist.history.slice(-24).map((h, i) => {
      const hKp    = h.kpIndex ?? 0;
      const gpsRaw = calcGPSrisk(bz, speed, hKp);
      const { sat: satRaw } = calcSATrisk(density, speed, hKp);
      return {
        label:   `-${24 - i}s`,
        hfRisk:  Math.min(100, Math.round(hKp * 14)),
        gpsRisk: Math.min(100, Math.round(gpsRaw * 100)),
        satRisk: Math.min(100, Math.round(satRaw * 100)),
        kp:      hKp,
      };
    });
  }, [hist, bz, speed, density]);

  const alarmCount = alarms.length;

  return (
    <div className="min-h-screen bg-[#07111f] text-white font-sans">

      {/* Header */}
      <header className="border-b border-slate-700/60 bg-[#0a1628]/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Ana Panel
          </button>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Plane className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-none">THY Havacılık Uzay Hava Paneli</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Türk Hava Yolları · Space Weather Operations</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-5">
            {alarmCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-400 border border-red-500/40 bg-red-500/10 px-3 py-1 rounded-full">
                <BellRing className="w-3.5 h-3.5" />
                {alarmCount} AKTİF ALARM
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-slate-400">NOAA Canlı</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              {clock}
            </div>
            <div className="text-xs bg-blue-600/20 border border-blue-500/30 text-blue-400 px-3 py-1 rounded-full font-semibold">
              YZ %{aiConf.toFixed(1)} Doğruluk
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-5">

        {/* AI Alarm Banner */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-3.5 h-3.5 text-slate-400" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">YZ Tehlike Alarmları</h2>
            <div className="flex-1 h-px bg-slate-700/50" />
            <span className="text-[10px] text-slate-600">Kp {kp.toFixed(1)} · Bz {bz.toFixed(1)} nT · X-ışını: {current?.xrayFlux?.classLabel ?? "B"}</span>
          </div>
          <AlarmBanner alarms={alarms} />
        </section>

        {/* Physics Engine Panel */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="w-3.5 h-3.5 text-slate-400" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Fizik Tabanlı Risk Motoru</h2>
            <div className="flex-1 h-px bg-slate-700/50" />
            <span className="text-[10px] text-slate-600">NOAA girdileri · anlık hesaplama</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* F coupling function */}
            <PhysicsCard
              icon={<Zap className="w-4 h-4" />}
              label="Kuplaj Fonksiyonu (F)"
              formulaLabel="F = V¹·⁵ · |Bz|¹·² · n⁰·³ · (1 + 0.5|dBz/dt|)"
              value={fmtF(physics.F)}
              pct={physics.fNorm}
              level={fLevel(physics.F)}
              terms={[
                { label: `V¹·⁵  (${speed} km/s)`,      value: Math.pow(speed, 1.5).toFixed(0),      pct: Math.min(1, speed / 800) },
                { label: `|Bz|¹·² (${Math.abs(bz).toFixed(1)} nT)`, value: Math.pow(Math.max(Math.abs(bz),0.01),1.2).toFixed(2), pct: Math.min(1, Math.abs(bz) / 20) },
                { label: `n⁰·³  (${density.toFixed(1)} p/cm³)`, value: Math.pow(Math.max(density,0.01),0.3).toFixed(2), pct: Math.min(1, density / 30) },
                { label: `dBz/dt (${dBzdt.toFixed(2)} nT/min)`, value: `×${(1 + 0.5 * Math.abs(dBzdt)).toFixed(2)}`, pct: Math.min(1, Math.abs(dBzdt) / 5) },
              ]}
            />

            {/* GPS Risk */}
            <PhysicsCard
              icon={<Navigation className="w-4 h-4" />}
              label="GPS/GNSS Risk Endeksi"
              formulaLabel="GPSrisk = 0.5·(|Bz|/20) + 0.3·(V/1000) + 0.2·(Kp/9)"
              value={`%${(physics.gpsR * 100).toFixed(1)}`}
              pct={physics.gpsR}
              level={gpsLevel}
              terms={[
                { label: `0.5·(|Bz|/20)  |Bz|=${Math.abs(bz).toFixed(1)}nT`, value: physics.gpsTerm1.toFixed(3), pct: physics.gpsTerm1 / 0.5 },
                { label: `0.3·(V/1000)   V=${speed}km/s`,                    value: physics.gpsTerm2.toFixed(3), pct: physics.gpsTerm2 / 0.3 },
                { label: `0.2·(Kp/9)     Kp=${kp.toFixed(1)}`,               value: physics.gpsTerm3.toFixed(3), pct: physics.gpsTerm3 / 0.2 },
              ]}
            />

            {/* SAT Risk */}
            <PhysicsCard
              icon={<Satellite className="w-4 h-4" />}
              label="Uydu Operasyon Riski"
              formulaLabel="SATrisk = 0.4·(Pd/50) + 0.4·(Fluxp/1000) + 0.2·(|Dst|/200)"
              value={`%${(physics.satR * 100).toFixed(1)}`}
              pct={physics.satR}
              level={satLevel}
              terms={[
                { label: `0.4·(Pd/50)    Pd=${physics.Pd.toFixed(2)}nPa`,      value: physics.satTerm1.toFixed(3), pct: physics.satTerm1 / 0.4 },
                { label: `0.4·(Fluxp/1k) Fp≈${physics.Fluxp.toFixed(0)}pfu`,   value: physics.satTerm2.toFixed(3), pct: physics.satTerm2 / 0.4 },
                { label: `0.2·(|Dst|/200) Dst≈${physics.Dst.toFixed(0)}nT`,    value: physics.satTerm3.toFixed(3), pct: physics.satTerm3 / 0.2 },
              ]}
            />
          </div>
        </section>

        {/* Metric Cards */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Anlık Etki Analizi</h2>
            <div className="flex-1 h-px bg-slate-700/50" />
            <span className="text-[10px] text-slate-500">Güneş rüzgarı: {speed} km/s · Yoğunluk: {current?.solarWind?.density?.toFixed(1) ?? "—"} p/cm³</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              icon={<Radio className="w-4 h-4" />}
              title="HF Haberleşme"
              value={hfLevel === "normal" ? "AKTİF" : hfLevel === "caution" ? "DİKKATLİ" : hfLevel === "warning" ? "KISMİ" : "KESİNTİ"}
              level={hfLevel}
              description={hfDesc}
              trend={<TrendIcon val={kp} prev={kp1h} />}
            />
            <MetricCard
              icon={<Navigation className="w-4 h-4" />}
              title="GPS / GNSS"
              value={gpsLevel === "normal" ? "HASSAS" : gpsLevel === "caution" ? "AZALMIŞ" : gpsLevel === "warning" ? "BOZUK" : "GÜVENİLMEZ"}
              level={gpsLevel}
              description={gpsDesc}
            />
            <MetricCard
              icon={<ShieldAlert className="w-4 h-4" />}
              title="Radyasyon Riski"
              value={avRisk.toFixed(0)}
              unit="Birim"
              level={radLevel}
              description={radDesc}
            />
            <MetricCard
              icon={<Plane className="w-4 h-4" />}
              title="Kutup Güzergahı"
              value={polarLevel === "normal" ? "AÇIK" : polarLevel === "caution" ? "İZLE" : polarLevel === "warning" ? "KISITLI" : "KAPALI"}
              level={polarLevel}
              description={polarDesc}
            />
          </div>
        </section>

        {/* AI Outlook + Route Table */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* AI Outlook Panel */}
          <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-[#0c1e35] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">YZ Etki Tahmini</span>
              </div>
              <span className="text-[10px] text-slate-500 border border-slate-700 rounded px-2 py-0.5">%{aiConf.toFixed(1)} güven</span>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
              <p className="text-sm text-slate-300 leading-relaxed">{outlookText}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "1 Saat", kpVal: kp1h, level: outlook1h },
                { label: "3 Saat", kpVal: kp3h, level: kpToLevel(kp3h, [3, 5, 7]) },
                { label: "6 Saat", kpVal: kp6h, level: outlook6h },
              ].map(({ label, kpVal, level }) => {
                const c = statusColor(level);
                return (
                  <div key={label} className={`rounded-lg p-3 border ${c.border} ${c.bg} text-center`}>
                    <div className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                    <div className={`text-xl font-bold ${c.text}`}>{kpVal.toFixed(1)}</div>
                    <div className={`text-[9px] font-semibold mt-0.5 ${c.text}`}>{levelLabel(level)}</div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Fırtına Olasılığı (24s)</span>
                <span className={`text-sm font-bold ${storm24 > 40 ? "text-red-400" : storm24 > 20 ? "text-amber-400" : "text-emerald-400"}`}>
                  %{storm24.toFixed(0)}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${storm24 > 40 ? "bg-red-500" : storm24 > 20 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, storm24)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-800/30 rounded-lg px-3 py-2 border border-slate-700/40">
                <span>X-Işını</span>
                <span className={`font-bold font-mono ${xray >= 1e-4 ? "text-red-400" : xray >= 1e-5 ? "text-orange-400" : "text-emerald-400"}`}>
                  {current?.xrayFlux?.classLabel ?? "B"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-800/30 rounded-lg px-3 py-2 border border-slate-700/40">
                <span>Bz Alanı</span>
                <span className={`font-bold font-mono ${bz < -10 ? "text-red-400" : bz < -5 ? "text-amber-400" : "text-emerald-400"}`}>
                  {bz.toFixed(1)} nT
                </span>
              </div>
            </div>
          </div>

          {/* THY Route Table */}
          <div className="lg:col-span-3 rounded-xl border border-slate-700/50 bg-[#0c1e35] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plane className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">THY Güzergah Durumu</span>
              </div>
              <span className="text-[10px] text-slate-500">Gerçek zamanlı NOAA verisi · YZ hesaplı</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {["Sefer", "HF İletişim", "GPS", "Radyasyon", "Operasyonel Öneri"].map(h => (
                      <th key={h} className="py-2.5 px-4 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {routes.map(r => <RouteRow key={r.flightNo} {...r} />)}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 24h Trend Chart */}
        <section className="rounded-xl border border-slate-700/50 bg-[#0c1e35] p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Son 24 Saat — Havacılık Etki Trendi</span>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-400 inline-block rounded" /> HF Risk %</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400 inline-block rounded" /> GPS Risk % (formül)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-violet-400 inline-block rounded" /> SAT Risk % (formül)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 inline-block rounded opacity-60" /> Uyarı (%50)</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 9 }} axisLine={false} tickLine={false} interval={3} />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0a1628", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#e2e8f0" }}
              />
              <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} label={{ value: "Uyarı %50", fill: "#ef4444", fontSize: 9, position: "insideTopRight" }} />
              <Line type="monotone" dataKey="hfRisk"  stroke="#60a5fa" strokeWidth={2} dot={false} name="HF Risk %" />
              <Line type="monotone" dataKey="gpsRisk" stroke="#fbbf24" strokeWidth={2} dot={false} name="GPS Risk % (formül)" />
              <Line type="monotone" dataKey="satRisk" stroke="#a78bfa" strokeWidth={2} dot={false} name="SAT Risk % (formül)" />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <footer className="text-center text-[10px] text-slate-600 pb-2">
          Yörünge Kalkanı Yapay Zeka · THY Havacılık Modülü · Veriler NOAA/SWPC kaynaklı · YZ destekli analiz
        </footer>

      </main>
    </div>
  );
}
