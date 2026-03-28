import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BellRing, BellOff, Volume2, VolumeX, X, AlertTriangle, AlertOctagon, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpaceWeatherData, AIPrediction, AlertsResponse, InfrastructureRisk } from "@workspace/api-client-react";

// ── Types ────────────────────────────────────────────────────────────────────
type AlarmLevel = "CRITICAL" | "HIGH" | "MODERATE";

interface AlarmEvent {
  id: string;
  level: AlarmLevel;
  title: string;
  message: string;
  timestamp: Date;
  dismissed: boolean;
}

// ── Web Audio Synthesizer ────────────────────────────────────────────────────
function createAlarmSound(ctx: AudioContext, level: AlarmLevel) {
  const now = ctx.currentTime;

  if (level === "CRITICAL") {
    // Fast urgent pulsing: descending tritone interval, 4 rapid pulses
    const freqs = [988, 740, 988, 740];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = freq;
      filter.Q.value = 3;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now + i * 0.18);
      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.22, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.16);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.17);
    });
  } else if (level === "HIGH") {
    // Three medium-tempo pulses: warning tone
    [660, 550, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now + i * 0.28);
      gain.gain.setValueAtTime(0, now + i * 0.28);
      gain.gain.linearRampToValueAtTime(0.14, now + i * 0.28 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.28 + 0.25);
      osc.start(now + i * 0.28);
      osc.stop(now + i * 0.28 + 0.26);
    });
  } else {
    // Single soft chime: C5 → E5 → G5 (Cmaj triad)
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.10, now + i * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.40);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.45);
    });
  }
}

// ── Alarm Rules ──────────────────────────────────────────────────────────────
interface CheckInput {
  current?: SpaceWeatherData;
  prediction?: AIPrediction;
  risk?: InfrastructureRisk;
  alerts?: AlertsResponse;
}

function checkAlarms(input: CheckInput): Omit<AlarmEvent, "id" | "timestamp" | "dismissed">[] {
  const events: Omit<AlarmEvent, "id" | "timestamp" | "dismissed">[] = [];
  const { current, prediction, risk } = input;
  if (!current) return events;

  const kp = current.kpIndex;
  const bz = current.magneticField.bz;
  const speed = current.solarWind.speed;
  const xClass = current.xray?.fluxClass ?? "A";
  const overall = risk?.overallRisk ?? 0;

  // CRITICAL alerts
  if (kp >= 7) events.push({ level: "CRITICAL", title: "G3+ JEOMANYETİK FIRTINA", message: `Kp ${kp.toFixed(1)} — G${kp >= 9 ? 5 : kp >= 8 ? 4 : 3} fırtınası aktif. Elektrik şebekeleri ve uydu sistemleri tehlikede.` });
  if (xClass === "X") events.push({ level: "CRITICAL", title: "X-SINIFI GÜNEŞ PATLAMASI", message: `${xClass}-sınıfı patlama tespit edildi. HF radyo iletişimi çökmüş olabilir. GPS hatası bekleniyor.` });
  if (bz < -15) events.push({ level: "CRITICAL", title: "GÜÇLÜ GÜNEY BZ", message: `Bz = ${bz.toFixed(1)} nT — Manyetopoz açılıyor. Jeomanyetik fırtına başlangıcı bekleniyor.` });
  if (overall >= 70) events.push({ level: "CRITICAL", title: "KRİTİK ALTYAPI RİSKİ", message: `Genel altyapı risk skoru ${overall}% — Acil protokol önerilir.` });

  // HIGH alerts
  if (kp >= 5 && kp < 7) events.push({ level: "HIGH", title: "G1-G2 JEOMANYETİK FIRTINA", message: `Kp ${kp.toFixed(1)} — Güç şebekesinde dalgalanma, GPS hataları oluşabilir.` });
  if (xClass === "M") events.push({ level: "HIGH", title: "M-SINIFI GÜNEŞ PATLAMASI", message: `M-sınıfı patlama — HF radyo iletişimi bozulabilir. Polar rota uçuşları etkilenebilir.` });
  if (bz < -10 && bz >= -15) events.push({ level: "HIGH", title: "GÜNEY BZ YÜKSEK", message: `Bz = ${bz.toFixed(1)} nT — Jeomanyetik aktivite artıyor. İzleme artırılmalı.` });
  if (speed > 700) events.push({ level: "HIGH", title: "YÜKSEK GÜNEŞ RÜZGARI HIZI", message: `Solar wind hızı ${speed.toFixed(0)} km/s — CME etkisi muhtemel.` });
  if (overall >= 50 && overall < 70) events.push({ level: "HIGH", title: "YÜKSEK ALTYAPI RİSKİ", message: `Altyapı risk skoru ${overall}% — Kritik sistemlerde tedbir alınmalı.` });

  // MODERATE alerts
  if (kp >= 4 && kp < 5) events.push({ level: "MODERATE", title: "ARTAN JEOMANYETİK AKTİVİTE", message: `Kp ${kp.toFixed(1)} — Fırtına eşiğine yaklaşılıyor. Polar bölgeler etkilenebilir.` });
  if (speed > 550 && speed <= 700) events.push({ level: "MODERATE", title: "GÜNEŞ RÜZGARI YÜKSELİYOR", message: `Solar wind hızı ${speed.toFixed(0)} km/s — Geoeffektif koşullar oluşabilir.` });
  if (prediction?.riskScore && prediction.riskScore >= 40 && prediction.riskScore < 55) {
    events.push({ level: "MODERATE", title: "YZ TAHMİN UYARISI", message: `Yapay zeka modeli önümüzdeki 1 saatte risk artışı öngörüyor. Risk skoru: ${prediction.riskScore}%.` });
  }

  return events;
}

// ── Main Alarm System Component ──────────────────────────────────────────────
interface AlarmSystemProps {
  current?: SpaceWeatherData;
  prediction?: AIPrediction;
  risk?: InfrastructureRisk;
  alerts?: AlertsResponse;
}

export function AlarmSystem({ current, prediction, risk, alerts }: AlarmSystemProps) {
  const [enabled, setEnabled] = useState(true);
  const [muted, setMuted] = useState(false);
  const [activeAlarms, setActiveAlarms] = useState<AlarmEvent[]>([]);
  const [history, setHistory] = useState<AlarmEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastTriggeredRef = useRef<Map<string, number>>(new Map());

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playAlarm = useCallback((level: AlarmLevel) => {
    if (muted) return;
    try {
      const ctx = getAudioCtx();
      createAlarmSound(ctx, level);
    } catch (e) {
      // Audio API may be blocked; ignore silently
    }
  }, [muted, getAudioCtx]);

  // Check for alarms whenever data changes
  useEffect(() => {
    if (!enabled) return;
    const detected = checkAlarms({ current, prediction, risk, alerts });
    const now = Date.now();
    // Cooldown per alarm type: CRITICAL=90s, HIGH=180s, MODERATE=600s
    const cooldowns: Record<AlarmLevel, number> = { CRITICAL: 90000, HIGH: 180000, MODERATE: 600000 };

    const newEvents: AlarmEvent[] = [];
    for (const ev of detected) {
      const key = ev.level + ":" + ev.title;
      const lastTime = lastTriggeredRef.current.get(key) ?? 0;
      if (now - lastTime >= cooldowns[ev.level]) {
        lastTriggeredRef.current.set(key, now);
        const event: AlarmEvent = { ...ev, id: `${key}-${now}`, timestamp: new Date(), dismissed: false };
        newEvents.push(event);
        playAlarm(ev.level);
      }
    }

    if (newEvents.length > 0) {
      setActiveAlarms(prev => [...newEvents, ...prev].slice(0, 5));
      setHistory(prev => [...newEvents, ...prev].slice(0, 50));
    }
  }, [current, prediction, risk, alerts, enabled, playAlarm]);

  const dismiss = (id: string) => {
    setActiveAlarms(prev => prev.filter(a => a.id !== id));
  };
  const dismissAll = () => setActiveAlarms([]);

  const levelColors: Record<AlarmLevel, string> = {
    CRITICAL: "border-red-500 bg-red-950/90 text-red-200",
    HIGH: "border-orange-400 bg-orange-950/90 text-orange-200",
    MODERATE: "border-yellow-400 bg-yellow-950/90 text-yellow-200",
  };
  const levelBadge: Record<AlarmLevel, string> = {
    CRITICAL: "bg-red-500 text-white",
    HIGH: "bg-orange-500 text-white",
    MODERATE: "bg-yellow-500 text-black",
  };
  const levelIcon: Record<AlarmLevel, React.ReactNode> = {
    CRITICAL: <AlertOctagon className="w-4 h-4 text-red-400" />,
    HIGH: <AlertTriangle className="w-4 h-4 text-orange-400" />,
    MODERATE: <Info className="w-4 h-4 text-yellow-400" />,
  };

  return (
    <>
      {/* Control bar */}
      <div className="fixed top-[68px] right-4 z-50 flex items-center gap-2">
        {/* History badge */}
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory(v => !v)}
            className="relative flex items-center gap-1.5 bg-[#040d1a]/90 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>Alarm Geçmişi ({history.length})</span>
          </button>
        )}
        {/* Mute toggle */}
        <button
          onClick={() => setMuted(v => !v)}
          title={muted ? "Sesi aç" : "Sesi kapat"}
          className={cn(
            "p-2 rounded-lg border transition-colors",
            muted
              ? "bg-white/5 border-white/10 text-muted-foreground"
              : "bg-primary/10 border-primary/30 text-primary"
          )}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        {/* Enable toggle */}
        <button
          onClick={() => { setEnabled(v => !v); if (!enabled) dismissAll(); }}
          title={enabled ? "Alarmı devre dışı bırak" : "Alarmı etkinleştir"}
          className={cn(
            "p-2 rounded-lg border transition-colors",
            enabled
              ? "bg-danger/10 border-danger/30 text-danger"
              : "bg-white/5 border-white/10 text-muted-foreground"
          )}
        >
          {enabled ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        </button>
      </div>

      {/* Active alarm toasts */}
      <div className="fixed top-[110px] right-4 z-50 flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
        <AnimatePresence>
          {activeAlarms.map(alarm => (
            <motion.div
              key={alarm.id}
              initial={{ x: 360, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 360, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className={cn(
                "relative rounded-xl border-2 p-3 shadow-2xl backdrop-blur-xl",
                alarm.level === "CRITICAL" && "animate-pulse-fast",
                levelColors[alarm.level]
              )}
            >
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0">{levelIcon[alarm.level]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("text-[9px] font-display font-bold px-1.5 py-0.5 rounded-sm tracking-widest uppercase", levelBadge[alarm.level])}>
                      {alarm.level}
                    </span>
                    <span className="text-[9px] font-mono text-white/40">
                      {alarm.timestamp.toLocaleTimeString("tr-TR")}
                    </span>
                  </div>
                  <div className="text-[11px] font-display font-bold tracking-wide mb-0.5">{alarm.title}</div>
                  <div className="text-[10px] opacity-80 leading-relaxed">{alarm.message}</div>
                </div>
                <button
                  onClick={() => dismiss(alarm.id)}
                  className="shrink-0 p-0.5 hover:opacity-70 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Severity glow line */}
              {alarm.level === "CRITICAL" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-500/0 via-red-400 to-red-500/0 rounded-b-xl" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {activeAlarms.length > 1 && (
          <button
            onClick={dismissAll}
            className="text-[10px] font-display text-muted-foreground text-right hover:text-foreground transition-colors pr-1"
          >
            Tümünü kapat
          </button>
        )}
      </div>

      {/* History panel */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-[110px] right-4 z-50 w-[380px] max-h-[60vh] overflow-y-auto bg-[#040d1a]/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-xl"
          >
            <div className="sticky top-0 bg-[#040d1a]/95 backdrop-blur px-4 py-3 border-b border-white/10 flex justify-between items-center">
              <span className="text-xs font-display font-bold text-primary tracking-widest uppercase">Alarm Geçmişi</span>
              <button onClick={() => setShowHistory(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="divide-y divide-white/5">
              {history.map(alarm => (
                <div key={alarm.id} className="px-4 py-2.5 flex gap-2 items-start">
                  <div className="mt-0.5">{levelIcon[alarm.level]}</div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn("text-[8px] font-display font-bold px-1 py-0.5 rounded-sm tracking-widest uppercase", levelBadge[alarm.level])}>
                        {alarm.level}
                      </span>
                      <span className="text-[9px] font-mono text-white/35">{alarm.timestamp.toLocaleTimeString("tr-TR")}</span>
                    </div>
                    <div className="text-[10px] font-display font-bold text-foreground">{alarm.title}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">{alarm.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
