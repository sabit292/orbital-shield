import React, { useMemo } from "react";
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
  CheckCircle2, AlertTriangle, XCircle, Clock
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(level: "normal" | "caution" | "warning" | "critical") {
  return {
    normal:   { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400" },
    caution:  { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30",   dot: "bg-amber-400"   },
    warning:  { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/30",  dot: "bg-orange-400"  },
    critical: { bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30",     dot: "bg-red-400"     },
  }[level];
}

function StatusIcon({ level }: { level: "normal" | "caution" | "warning" | "critical" }) {
  const cls = "w-4 h-4";
  if (level === "normal")   return <CheckCircle2  className={`${cls} text-emerald-400`} />;
  if (level === "caution")  return <AlertTriangle className={`${cls} text-amber-400`} />;
  if (level === "warning")  return <AlertTriangle className={`${cls} text-orange-400`} />;
  return <XCircle className={`${cls} text-red-400`} />;
}

type StatusLevel = "normal" | "caution" | "warning" | "critical";

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

// ── Sub-components ────────────────────────────────────────────────────────────

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
  route: string;
  type: string;
  commStatus: StatusLevel;
  gpsStatus: StatusLevel;
  radLevel: string;
  recommendation: string;
}

function RouteRow({ route, type, commStatus, gpsStatus, radLevel, recommendation }: RouteRowProps) {
  const cc = statusColor(commStatus);
  const gc = statusColor(gpsStatus);
  return (
    <tr className="border-b border-slate-700/50 hover:bg-slate-800/40 transition-colors">
      <td className="py-3 px-4">
        <div className="font-mono font-semibold text-white text-sm">{route}</div>
        <div className="text-[10px] text-slate-500 mt-0.5">{type}</div>
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
      <td className="py-3 px-4 font-mono text-sm text-slate-300">{radLevel}</td>
      <td className="py-3 px-4 text-xs text-slate-400 max-w-[180px]">{recommendation}</td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AviationPage() {
  const [, navigate] = useLocation();
  const { data: current } = useGetCurrentSpaceWeather({ refetchInterval: 60000 });
  const { data: pred }    = useGetAIPrediction({ refetchInterval: 60000 });
  const { data: risk }    = useGetInfrastructureRisk({ refetchInterval: 60000 });
  const { data: hist }    = useGetSpaceWeatherHistory({ refetchInterval: 60000 });

  const kp    = current?.kpIndex ?? 0;
  const bz    = current?.solarWind?.bz ?? 0;
  const speed = current?.solarWind?.speed ?? 400;
  const xray  = current?.xrayFlux?.current ?? 0;
  const avRisk = risk?.aviation ?? 0;

  // Derived aviation metrics
  const hfLevel:  StatusLevel = kpToLevel(kp, [3, 5, 7]);
  const gpsLevel: StatusLevel = bz < -10 ? "warning" : bz < -5 ? "caution" : kpToLevel(kp, [4, 6, 8]);
  const radLevel: StatusLevel = kpToLevel(kp, [4, 6, 8]);
  const polarLevel: StatusLevel = kp >= 7 ? "critical" : kp >= 5 ? "warning" : kp >= 3 ? "caution" : "normal";

  const hfDesc  = hfLevel === "normal"
    ? "HF iletişim kanalları nominal. Okyanus geçiş güzergahlarında normal operasyon bekleniyor."
    : hfLevel === "caution"
    ? "HF bozulma riski artıyor. Yedek iletişim kanallarını hazır tutun."
    : hfLevel === "warning"
    ? "HF iletişimde kısmi kesintiler mümkün. SELCAL ve SATCOM'u aktif edin."
    : "Okyanus güzergahlarında HF kesintisi yüksek olasılıklı. SATCOM zorunlu.";

  const gpsDesc = gpsLevel === "normal"
    ? "GPS/GNSS sinyalleri nominal. RNP yaklaşım prosedürleri etkilenmez."
    : gpsLevel === "caution"
    ? "Hafif iyonosferik bozulma. ILS yedekleme prosedürlerini gözden geçirin."
    : "GPS doğruluğu düşük. RNP AR prosedürleri kısıtlanabilir, BARO-VNAV öncelikli.";

  const radDesc = radLevel === "normal"
    ? "Kutup rotalarında radyasyon dozu normal seviyede. Kısıtlama gerekmez."
    : radLevel === "caution"
    ? "Yüksek irtifa kutup rotalarında hafif radyasyon artışı. Mürettebat maruziyetini takip edin."
    : "Kutup rotası radyasyon dozu arttı. Daha güney güzergah değerlendirmesi önerilir.";

  const polarDesc = polarLevel === "normal"
    ? "Transpolar güzergahlar açık. Kp düşük, kutup rotası kullanımı serbesttir."
    : polarLevel === "caution"
    ? "Kutup güzergahı yakından izleniyor. Alternatif güzergah planı hazır olsun."
    : polarLevel === "warning"
    ? "Kutup güzergahında operasyonel kısıtlamalar. ICAO Özel Prosedür gerekebilir."
    : "Kutup güzergahı kapatma eşiğinde. Tüm transpolar uçuşlar güneye yönlendirilmeli.";

  // AI outlook
  const kp1h  = pred?.predictions?.kp1h  ?? kp;
  const kp3h  = pred?.predictions?.kp3h  ?? kp;
  const kp6h  = pred?.predictions?.kp6h  ?? kp;
  const aiConf = pred?.confidence ?? 91;
  const storm24 = (pred?.stormProbability24h ?? 0);

  const outlook1h: StatusLevel = kpToLevel(kp1h, [3, 5, 7]);
  const outlook6h: StatusLevel = kpToLevel(kp6h, [3, 5, 7]);

  const outlookText = kp6h < 3
    ? "Önümüzdeki 6 saat için uzay hava koşulları sakin kalması bekleniyor. Tüm havacılık operasyonları normal şekilde sürdürülebilir."
    : kp6h < 5
    ? "Orta düzey aktivite bekleniyor. HF iletişim kalitesi hafifçe düşebilir; okyanus geçişlerinde SELCAL monitörü aktif tutulmalı."
    : kp6h < 7
    ? "Güçlü jeomagnetik aktivite bekleniyor. Kutup güzergahları için alternatif plan hazırlayın; HF iletişimi kesintili olabilir."
    : "Şiddetli jeomagnetik fırtına riski yüksek. Transpolar güzergah kullanmayın; SATCOM birincil iletişim kanalı olarak kullanın.";

  // Chart data
  const chartData = useMemo(() => {
    if (!hist?.history?.length) return [];
    return hist.history.slice(-24).map((h, i) => ({
      t: i,
      kp: h.kpIndex ?? 0,
      hfRisk: Math.min(100, (h.kpIndex ?? 0) * 14),
      gpsRisk: Math.min(100, avRisk + (h.kpIndex ?? 0) * 3),
    }));
  }, [hist, avRisk]);

  const now = new Date();
  const utcStr = now.toUTCString().slice(17, 25) + " UTC";

  return (
    <div className="min-h-screen bg-[#07111f] text-white font-sans">
      {/* Top navigation bar */}
      <header className="border-b border-slate-700/60 bg-[#0a1628]/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Ana Panel
          </button>
          <div className="h-4 w-px bg-slate-600" />
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Plane className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-none">Havacılık Uzay Hava Paneli</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Space Weather Aviation Intelligence</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-6">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-slate-400">Canlı Veri</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              {utcStr}
            </div>
            <div className="text-xs bg-blue-600/20 border border-blue-500/30 text-blue-400 px-3 py-1 rounded-full font-semibold">
              YZ %{aiConf.toFixed(0)} Doğruluk
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-6">

        {/* Section: Current Status */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Anlık Etki Analizi</h2>
            <div className="flex-1 h-px bg-slate-700/50" />
            <span className="text-[10px] text-slate-500">Kp {kp.toFixed(1)} · Bz {bz.toFixed(1)} nT · {speed} km/s</span>
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
              title="Radyasyon Seviyesi"
              value={avRisk.toFixed(0)}
              unit="Birim Risk"
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

        {/* Section: AI Outlook + Route Table */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* AI Outlook */}
          <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-[#0c1e35] p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">YZ Etki Tahmini</span>
              </div>
              <span className="text-[10px] text-slate-500 border border-slate-700 rounded px-2 py-0.5">%{aiConf.toFixed(0)} güven</span>
            </div>

            {/* 6h outlook text */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
              <p className="text-sm text-slate-300 leading-relaxed">{outlookText}</p>
            </div>

            {/* Hour-by-hour KP forecast */}
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

            {/* 24h storm probability */}
            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Fırtına Olasılığı (24s)</span>
                <span className={`text-sm font-bold ${storm24 > 40 ? "text-orange-400" : storm24 > 20 ? "text-amber-400" : "text-emerald-400"}`}>
                  %{storm24.toFixed(0)}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${storm24 > 40 ? "bg-orange-500" : storm24 > 20 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, storm24)}%` }}
                />
              </div>
            </div>

            {/* X-Ray class */}
            <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-800/30 rounded-lg px-3 py-2 border border-slate-700/40">
              <span>X-Işını Sınıfı</span>
              <span className={`font-bold font-mono ${xray > 1e-4 ? "text-red-400" : xray > 1e-5 ? "text-orange-400" : "text-emerald-400"}`}>
                {current?.xrayFlux?.classLabel ?? "B"}
              </span>
            </div>
          </div>

          {/* Route table */}
          <div className="lg:col-span-3 rounded-xl border border-slate-700/50 bg-[#0c1e35] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plane className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Kritik Güzergah Durumu</span>
              </div>
              <span className="text-[10px] text-slate-500">Gerçek zamanlı · YZ hesaplı</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {["Güzergah", "HF İletişim", "GPS", "Radyasyon", "Öneri"].map(h => (
                      <th key={h} className="py-2 px-4 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  <RouteRow
                    route="NAT Track"
                    type="Kuzey Atlantik · FL350"
                    commStatus={hfLevel}
                    gpsStatus={gpsLevel}
                    radLevel={radLevel === "normal" ? "Normal" : radLevel === "caution" ? "Orta" : "Yüksek"}
                    recommendation={hfLevel === "normal" ? "Standart operasyon" : "SELCAL monitor aktif"}
                  />
                  <RouteRow
                    route="Polar 1"
                    type="Kuzey Kutbu · FL380"
                    commStatus={polarLevel === "normal" ? "normal" : polarLevel === "caution" ? "caution" : "critical"}
                    gpsStatus={gpsLevel}
                    radLevel={kp > 5 ? "Yüksek" : kp > 3 ? "Orta" : "Normal"}
                    recommendation={polarLevel === "normal" ? "Açık, kısıtsız" : polarLevel === "caution" ? "İzle, seçenek hazırla" : "Güney güzergah kullan"}
                  />
                  <RouteRow
                    route="PACOTS"
                    type="Kuzey Pasifik · FL390"
                    commStatus={kp > 4 ? "caution" : "normal"}
                    gpsStatus={gpsLevel}
                    radLevel="Normal"
                    recommendation={kp > 4 ? "HF yedek hazır tut" : "Standart operasyon"}
                  />
                  <RouteRow
                    route="ATS-L888"
                    type="Pasifik Güney · FL360"
                    commStatus="normal"
                    gpsStatus="normal"
                    radLevel="Düşük"
                    recommendation="Tüm sistemler nominal"
                  />
                  <RouteRow
                    route="Eurocontrol"
                    type="Avrupa NAM · FL340"
                    commStatus={kp > 5 ? "caution" : "normal"}
                    gpsStatus={bz < -8 ? "caution" : "normal"}
                    radLevel="Normal"
                    recommendation={kp > 5 ? "GPS drift izle" : "Normal prosedür"}
                  />
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Section: 24h Trend Chart */}
        <section className="rounded-xl border border-slate-700/50 bg-[#0c1e35] p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Son 24 Saat — Havacılık Etki Trendi</span>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> HF Risk %</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400 inline-block" /> GPS Risk %</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-500 inline-block border-dashed border-t" /> Eşik (Kp=5)</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="t" tick={false} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0a1628", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#e2e8f0" }}
              />
              <ReferenceLine y={70} stroke="#f97316" strokeDasharray="4 2" strokeWidth={1} />
              <Line type="monotone" dataKey="hfRisk"  stroke="#60a5fa" strokeWidth={2} dot={false} name="HF Risk %" />
              <Line type="monotone" dataKey="gpsRisk" stroke="#fbbf24" strokeWidth={2} dot={false} name="GPS Risk %" />
            </LineChart>
          </ResponsiveContainer>
        </section>

        {/* Footer */}
        <footer className="text-center text-[10px] text-slate-600 pb-2">
          Yörünge Kalkanı Yapay Zeka · Havacılık Modülü · Veriler NOAA/SWPC kaynaklı · YZ destekli analiz
        </footer>

      </main>
    </div>
  );
}
