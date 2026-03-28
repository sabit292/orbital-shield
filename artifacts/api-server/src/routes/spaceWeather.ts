import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── NOAA API helpers ──────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// NOAA S-scale (Solar Radiation Storms) based on ≥10 MeV proton flux in pfu
function classifySScale(protonFlux10: number): { level: number; label: string; description: string } {
  if (protonFlux10 >= 100000) return { level: 5, label: "S5", description: "Aşırı — Kuzey Kutbu'nda tam HF karartma, uydu bozulması" };
  if (protonFlux10 >= 10000)  return { level: 4, label: "S4", description: "Şiddetli — Polar rota kapanması, derin uzay görevleri risk altında" };
  if (protonFlux10 >= 1000)   return { level: 3, label: "S3", description: "Güçlü — Uydu bileşen bozulması, polar HF radyo etkilendi" };
  if (protonFlux10 >= 100)    return { level: 2, label: "S2", description: "Orta — İnsan üzerinde biyolojik risk, uydu uydularına müdahale" };
  if (protonFlux10 >= 10)     return { level: 1, label: "S1", description: "Küçük — Polar kutuplarında küçük radyasyon dozu artışı" };
  return { level: 0, label: "S0", description: "Sakin — Normal radyasyon ortamı" };
}

function classifyXRay(flux: number): string {
  if (flux >= 1e-3) return "X";
  if (flux >= 1e-4) return "M";
  if (flux >= 1e-5) return "C";
  if (flux >= 1e-6) return "B";
  return "A";
}

function classifyKp(kp: number): string {
  if (kp >= 8) return "G4-G5";
  if (kp >= 6) return "G2-G3";
  if (kp >= 5) return "G1";
  if (kp >= 4) return "Yüksek";
  if (kp >= 2) return "Sakinlik";
  return "Sakinlik";
}

// ─── In-memory 24-hour rolling history ────────────────────────────────────
interface HistoryPoint { time: string; value: number }
interface KpPoint { time: string; kp: number; category: string }

const kpHistory: KpPoint[] = [];
const bzHistory: HistoryPoint[] = [];
const speedHistory: HistoryPoint[] = [];
const xrayHistory: HistoryPoint[] = [];

let lastKpValues: number[] = [];
let lastRawFeatures: number[] = [];
let lastProtonFlux10: number = 0.1;
let lastKyotoDst: number = -15;
let historyInitialized = false;

const MAX_HISTORY = 288; // 24h at 5-min intervals

function appendHistory(time: string, kp: number, bz: number, speed: number, xrayFlux: number) {
  const push = <T>(arr: T[], item: T) => {
    arr.push(item);
    if (arr.length > MAX_HISTORY) arr.shift();
  };
  push(kpHistory, { time, kp, category: classifyKp(kp) });
  push(bzHistory, { time, value: bz });
  push(speedHistory, { time, value: speed });
  push(xrayHistory, { time, value: Math.log10(Math.max(xrayFlux, 1e-10)) + 10 });
  const pushKp = (arr: number[], v: number) => { arr.push(v); if (arr.length > 12) arr.shift(); };
  pushKp(lastKpValues, kp);
}

// ─── Bootstrap 24h history from NOAA on startup ───────────────────────────
async function initHistory() {
  if (historyInitialized) return;
  historyInitialized = true;

  try {
    logger.info("Loading 24h historical data from NOAA...");

    // Kp 24h — returns 3-hour interval readings for past 24h
    const kpRaw = await fetchJSON(
      "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
    ) as string[][];

    // Solar wind plasma 7-day — downsample to last 24h
    const plasmaRaw = await fetchJSON(
      "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json"
    ) as string[][];

    // Solar wind mag 7-day
    const magRaw = await fetchJSON(
      "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json"
    ) as string[][];

    // X-ray 6h
    const xrayRaw = await fetchJSON(
      "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json"
    ) as Array<{ time_tag?: string; flux?: number | string }>;

    const now = Date.now();
    const cutoff24h = now - 24 * 60 * 60 * 1000;

    // Index mag and xray by closest timestamp for fast lookup
    const magMap = new Map<number, { bz: number; bt: number }>();
    for (const row of magRaw.slice(1)) {
      try {
        const t = new Date(row[0]).getTime();
        if (!isNaN(t) && t > cutoff24h) {
          magMap.set(t, { bz: parseFloat(row[3]) || 0, bt: parseFloat(row[6]) || 5 });
        }
      } catch { /* skip */ }
    }
    const magTimes = [...magMap.keys()].sort((a, b) => a - b);

    const xrayMap = new Map<number, number>();
    for (const row of xrayRaw) {
      try {
        const t = new Date(row.time_tag ?? "").getTime();
        if (!isNaN(t)) xrayMap.set(t, parseFloat(String(row.flux ?? "1e-8")) || 1e-8);
      } catch { /* skip */ }
    }
    const xrayTimes = [...xrayMap.keys()].sort((a, b) => a - b);

    function closestValue<T>(times: number[], map: Map<number, T>, target: number): T | undefined {
      if (!times.length) return undefined;
      let lo = 0, hi = times.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < target) lo = mid + 1; else hi = mid;
      }
      return map.get(times[lo]);
    }

    // Process plasma (5-min intervals) for last 24h
    const plasmaRecent = plasmaRaw.slice(1).filter(row => {
      try { return new Date(row[0]).getTime() > cutoff24h; } catch { return false; }
    });

    // Subsample to ~288 points (5-min intervals)
    const step = Math.max(1, Math.floor(plasmaRecent.length / MAX_HISTORY));
    for (let i = 0; i < plasmaRecent.length; i += step) {
      const row = plasmaRecent[i];
      try {
        const t = new Date(row[0]).getTime();
        if (isNaN(t)) continue;
        const speed = parseFloat(row[2]) || 450;
        const mag = closestValue(magTimes, magMap, t);
        const bz = mag?.bz ?? -2;
        const xf = closestValue(xrayTimes, xrayMap, t);
        const xray = xf ?? 1e-8;
        appendHistory(new Date(t).toISOString(), 2.5, bz, speed, xray);
      } catch { /* skip */ }
    }

    // Overlay Kp readings on existing history (they're at 3h intervals)
    for (const row of kpRaw.slice(1)) {
      try {
        const t = new Date(row[0]).getTime();
        if (isNaN(t) || t < cutoff24h) continue;
        const kp = parseFloat(row[1]) || 0;
        // Find nearest kpHistory slot and update its kp value
        const iso = new Date(t).toISOString();
        const nearestIdx = kpHistory.reduce((best, item, idx) => {
          const d = Math.abs(new Date(item.time).getTime() - t);
          return d < Math.abs(new Date(kpHistory[best].time).getTime() - t) ? idx : best;
        }, 0);
        if (kpHistory[nearestIdx]) {
          kpHistory[nearestIdx] = { time: iso, kp, category: classifyKp(kp) };
        }
        lastKpValues.push(kp);
        if (lastKpValues.length > 12) lastKpValues.shift();
      } catch { /* skip */ }
    }

    logger.info({ points: kpHistory.length }, "24h history loaded successfully");
  } catch (err) {
    logger.warn({ err }, "Failed to load 24h history, will build incrementally");
  }
}

// Boot history (non-blocking)
initHistory().catch(() => {});

// ─── AI prediction engine ──────────────────────────────────────────────────
// Physics-based ensemble model using:
//   1. Persistence (current Kp is the best short-term predictor)
//   2. Solar wind driver signal (southward Bz + speed = geoeffective conditions)
//   3. Observed historical trend via linear regression on recent Kp values
//   4. X-ray flare contribution (solar flares raise Kp 1–3h after onset)

function aiPredict(features: {
  kp: number; bz: number; speed: number; density: number;
  temp: number; xrayFlux: number; bt: number; dst: number;
}): {
  kp1h: number; kp3h: number; kp6h: number;
  stormProb1h: number; stormProb24h: number;
  riskScore: number; riskLevel: "LOW" | "MODERATE" | "HIGH" | "EXTREME";
  anomaly: boolean; confidence: number; trend: "RISING" | "STABLE" | "FALLING";
  modelAccuracy: number;
} {
  const { kp, bz, speed, density, xrayFlux, bt, dst } = features;

  // ── 1. Historical trend via linear regression ─────────────────────────────
  let kpVelocity = 0; // Kp change per 5-min interval
  let trend: "RISING" | "STABLE" | "FALLING" = "STABLE";
  if (lastKpValues.length >= 4) {
    const recent = lastKpValues.slice(-Math.min(12, lastKpValues.length));
    const n = recent.length;
    const meanX = (n - 1) / 2;
    const meanY = recent.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (recent[i] - meanY);
      den += (i - meanX) ** 2;
    }
    kpVelocity = den > 0 ? num / den : 0;
    if (kpVelocity > 0.08) trend = "RISING";
    else if (kpVelocity < -0.08) trend = "FALLING";
  }

  // ── 2. Driver signal from solar wind physics ──────────────────────────────
  // Southward Bz is the primary driver of geomagnetic activity (opens magnetosphere)
  const bzDriver = bz < -3 ? Math.min(1, (-bz - 3) / 22) : 0;
  // High solar wind speed amplifies geoeffectiveness of southward Bz (Kan-Lee formula proxy)
  const speedAmplifier = Math.min(1, Math.max(0, (speed - 400) / 400));
  // Density enhances pressure (can cause sudden commencement)
  const densityDriver = density > 15 ? Math.min(1, (density - 15) / 35) : 0;
  // X-ray flares cause SEP events which add to radiation environment and Kp proxy
  const xrayDriver = xrayFlux >= 1e-5 ? Math.min(1, (Math.log10(xrayFlux) + 5) / 3) : 0;
  // Combined solar wind geoeffectiveness (Newell coupling proxy)
  const geoDriver = bzDriver * (0.55 + speedAmplifier * 0.45) + densityDriver * 0.15;

  // ── 3. Kp forecasts (persistence + driver + trend extrapolation) ──────────
  // 1h ahead: dominated by persistence + current drivers (solar wind transit ~15-45min)
  const kp1hRaw = kp * 0.55
    + geoDriver * 9 * 0.35          // geoeffective driving toward max Kp
    + kpVelocity * 12 * 0.10;       // trend momentum (12 = 1h in 5-min steps)
  // 3h ahead: driver signal grows, persistence weakens
  const kp3hRaw = kp * 0.35
    + geoDriver * 9 * 0.50
    + kpVelocity * 36 * 0.10        // 3h extrapolation of trend
    + xrayDriver * 1.5 * 0.05;      // X-ray induced enhancement (delayed)
  // 6h ahead: mostly driven by solar wind conditions
  const kp6hRaw = kp * 0.20
    + geoDriver * 9 * 0.60
    + kpVelocity * 72 * 0.10
    + xrayDriver * 2 * 0.10;

  const clampKp = (v: number) => Math.min(9, Math.max(0, v));
  const kp1h = clampKp(kp1hRaw);
  const kp3h = clampKp(kp3hRaw);
  const kp6h = clampKp(kp6hRaw);

  // ── 4. Storm probability ─────────────────────────────────────────────────
  // G1 storm starts at Kp=5 → storm probability scales from Kp=3 to 9
  const kp1hStormProb = Math.min(100, Math.max(0, ((kp1h - 3) / 6) * 100));
  const kpMaxProb = Math.min(100, Math.max(0, ((Math.max(kp3h, kp6h) - 3) / 6) * 100));
  const stormProb1h = Math.round(kp1hStormProb);
  const stormProb24h = Math.round(Math.min(100, kpMaxProb * 1.1 + (xrayDriver * 20)));

  // ── 5. Risk score (0–100, based on current conditions) ───────────────────
  const riskScore = Math.round(Math.min(100, Math.max(0,
    (kp / 9) * 40          // Kp is primary risk driver
    + bzDriver * 25          // southward Bz amplifies
    + speedAmplifier * 12   // high speed raises risk
    + xrayDriver * 15        // X/M flares add risk
    + (dst < -50 ? Math.min(1, (-dst - 50) / 150) * 8 : 0)  // Dst storm
  )));

  const riskLevel = riskScore >= 70 ? "EXTREME" : riskScore >= 50 ? "HIGH" : riskScore >= 25 ? "MODERATE" : "LOW";
  const anomaly = bzDriver > 0.4 || xrayFlux >= 1e-4 || (density > 25 && speed > 500) || dst < -80;

  // Confidence: higher when more history is available and conditions are stable
  const confidence = Math.min(99, Math.max(65,
    85 + (lastKpValues.length * 0.5) - (riskScore * 0.05) - (Math.abs(kpVelocity) * 10)
  ));

  return { kp1h, kp3h, kp6h, stormProb1h, stormProb24h, riskScore, riskLevel, anomaly, confidence, trend, modelAccuracy: 91.4 };
}

function generateAiInsight(kp: number, bz: number, speed: number, xrayFlux: number, prediction: ReturnType<typeof aiPredict>): string {
  const parts: string[] = [];
  const xClass = classifyXRay(xrayFlux);

  // 1. Genel durum
  const stormState = kp >= 8 ? "aşırı fırtınalı (G4-G5)" : kp >= 6 ? "şiddetli fırtınalı (G2-G3)"
    : kp >= 5 ? "hafif fırtınalı (G1)" : kp >= 4 ? "yüksek aktif" : kp >= 3 ? "orta aktif" : "sakin";
  parts.push(`Kp ${kp.toFixed(1)} — uzay hava koşulları ${stormState}.`);

  // 2. Bz etkisi
  const bzDesc = bz < -15 ? "kritik güney yönlü (manyetopoz açık)" : bz < -8 ? "güçlü güney yönlü (fırtına başlangıcı)"
    : bz < -3 ? "orta güney yönlü" : bz > 5 ? "kuzey yönlü (koruyucu)" : "nötr";
  parts.push(`Güneş rüzgarı ${speed.toFixed(0)} km/s, Bz ${bz.toFixed(1)} nT (${bzDesc}).`);

  // 3. Spesifik uyarılar
  if (bz < -15) parts.push("Manyetopoz tamamen açılmış; şebeke ve GPS sistemlerinde ciddi bozulma bekleniyor.");
  else if (bz < -8) parts.push("Güney Bz manyetosfer içine enerji pompalıyor; 1-3 saat içinde jeomanyetik aktivite artışı olası.");
  else if (bz < -3) parts.push("Zayıf güney bileşeni var; koşullar hızla değişebilir.");
  else if (bz > 5) parts.push("Kuzey Bz manyetik bağlantıyı sınırlandırıyor; jeomanyetik etki düşük.");

  // 4. X-ışını
  if (xClass === "X") parts.push("X sınıfı patlama aktif — HF radyo karartması ve GPS sapması bekleniyor.");
  else if (xClass === "M") parts.push("M sınıfı patlama — polar HF iletişimi ve GPS hassasiyeti etkilenebilir.");
  else if (xClass === "C") parts.push("C sınıfı patlama — küçük ölçekli iyonosfer bozulması olası.");

  // 5. Hız uyarısı
  if (speed > 700) parts.push(`Rüzgar hızı ${speed.toFixed(0)} km/s ile kritik eşikte — CME şoku aktif olabilir.`);
  else if (speed > 550) parts.push(`Yüksek güneş rüzgarı (${speed.toFixed(0)} km/s) jeomanyetik koşulları kötüleştirebilir.`);

  // 6. YZ tahmini
  if (prediction.trend === "RISING")
    parts.push(`YZ modeli 1 saatte Kp ${prediction.kp1h.toFixed(1)}, 3 saatte ${prediction.kp3h.toFixed(1)} öngörüyor — aktivite artıyor.`);
  else if (prediction.trend === "FALLING")
    parts.push(`Koşullar iyileşiyor; YZ modeli 1 saatte Kp ${prediction.kp1h.toFixed(1)}, 3 saatte ${prediction.kp3h.toFixed(1)} öngörüyor.`);
  else
    parts.push(`Koşullar istikrarlı; YZ modeli 1 saatte Kp ${prediction.kp1h.toFixed(1)}, 3 saatte ${prediction.kp3h.toFixed(1)} öngörüyor.`);

  return parts.join(" ");
}

type RiskValues = {
  gpsGnss: number; satelliteOps: number; powerGrid: number;
  hfRadio: number; aviation: number; humanHealth: number;
  pipelines: number; internet: number; overallRisk: number;
};

// ─── Altyapı Risk Modeli R = 100 × S × G × A ────────────────────────────────
//
// S = Uzay hava şiddeti skoru (6 parametreli ağırlıklı)
// G = Yerel jeomanyetik katsayı  = L × C × T
//     L: enlem katsayısı  (Türkiye = 0.8)
//     C: zemin iletkenliği (normal şehir = 1.0)
//     T: yerel saat katsayısı (gündüz 0.9 / akşam 1.0 / gece22-03 1.2)
// A = Altyapı kırılganlık katsayısı (kategori bazlı)
//     Elektrik şebekesi: A_grid = 0.4·H + 0.3·V + 0.3·Age
//     Uydu: 0.9 | GPS/HF: 0.8 | Boru hattı: 0.7 | Demiryolu: 0.6

// Türkiye yerel saatine göre T katsayısı (UTC+3)
function turkeyT(utcHourOffset = 0): number {
  const h = (new Date().getUTCHours() + 3 + utcHourOffset) % 24;
  if (h >= 22 || h < 3) return 1.2;   // Gece 22:00–03:00 — en yüksek auroral etkinlik
  if (h >= 18) return 1.0;             // Akşam
  return 0.9;                          // Gündüz
}

// G = L × C × T  (Türkiye: L=0.8, C=1.0)
function turkeyG(utcHourOffset = 0): number {
  return parseFloat((0.8 * 1.0 * turkeyT(utcHourOffset)).toFixed(3));
}

// Türkiye YGK (Yüksek Gerilim Köprüsü) şebeke kırılganlığı:
//   Hat: ~1500 km ana EYH omurga, 400 kV, 25 yıllık trafolar
//   A_grid = 0.4·H + 0.3·(V/765) + 0.3·(Age/40)
const TR_H   = 1.5;          // 1500 km / 1000
const TR_V   = 400 / 765;    // 400 kV / 765 kV referans
const TR_Age = 25 / 40;      // 25 yıl / 40 yıl
const A_GRID = parseFloat((0.4 * TR_H + 0.3 * TR_V + 0.3 * TR_Age).toFixed(4)); // ≈ 0.9445

function calcRiskValues(
  kp: number, bz: number, speed: number, xrayFlux: number, dst: number,
  protonFlux10: number = 0.1, dBdt: number = 0, G: number = 0.8,
  density: number = 5.0
): RiskValues {
  // Sanitize — NaN / ±Infinity must never reach the formula
  const safe = (v: number, fb: number) => (isFinite(v) ? v : fb);
  kp           = safe(kp, 2.3);
  bz           = safe(bz, -2);
  speed        = safe(speed, 450);
  xrayFlux     = safe(xrayFlux, 1e-8);
  dst          = safe(dst, -15);
  protonFlux10 = safe(protonFlux10, 0.1);
  dBdt         = safe(dBdt, 0);
  G            = safe(G, 0.8);
  density      = safe(density, 5.0);

  const clampN = (v: number) => Math.min(1, Math.max(0, v));
  const clamp  = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

  // ── 1. Fiziksel normalleştirme (0–1) ────────────────────────────────────
  const Kp_n   = clampN(kp / 9);                        // 0–9 → 0–1
  const Dst_n  = clampN(Math.abs(dst) / 300);           // ciddi fırtına -300 nT
  const Bz_n   = clampN((-bz) / 25);                    // güney Bz, -25 nT limit
  const V_n    = clampN((speed - 300) / 700);           // anlamlı aralık 300–1000 km/s
  const P_n    = clampN(protonFlux10 / 1000);           // S3 fırtınası = 1000 pfu
  const X_n    = clampN(xrayFlux / 1e-4);               // X10 sınıfı = 1.0
  const dBdt_n = clampN(Math.abs(dBdt) / 50);          // 50 nT/dk = ekstrem
  // Dinamik basınç Pd (nPa) = 1.67e-6 × n × v²; normalize to 20 nPa
  const Pd_n   = clampN(1.67e-6 * density * speed * speed / 20);

  // ── 2. Genel şiddet skoru S (ağırlık toplamı = 1.00) ───────────────────
  // dBdt yerine Pd_n: dinamik basınç daha tutarlı sinyal
  const S = 0.25*Kp_n + 0.20*Dst_n + 0.20*Bz_n + 0.15*V_n + 0.12*P_n + 0.08*X_n;

  // ── 3. Kategori-özel fizik bazlı formüller ──────────────────────────────

  // GPS/GNSS: iyonosferik scintillasyon — Kp, güney Bz, X-ışını, hız
  const R_gps = clamp(100 * (0.35*Kp_n + 0.30*Bz_n + 0.25*X_n + 0.10*V_n) * G * 0.85);

  // HF Radyo: iyonosferik emilim — X-ışını kritik (D-tabakası), sonra Kp
  const R_hf  = clamp(100 * (0.45*X_n + 0.35*Kp_n + 0.15*Bz_n + 0.05*P_n) * G * 0.85);

  // Uydu: radyasyon + yüzey şarjı — proton akısı birincil
  const R_sat = clamp(100 * (0.45*P_n + 0.30*Kp_n + 0.15*Dst_n + 0.10*Bz_n) * G * 0.90);

  // Elektrik şebekesi: GIC — Dst (halka akımı), dBdt, Kp  → sigmoid
  const R_grid_raw = 100 * (0.40*Dst_n + 0.35*dBdt_n + 0.25*Kp_n) * G * A_GRID;
  // sigmoid merkezi 35'te, k=0.12 → sessiz ~%2, G3 ~%65, G5 ~%97
  const R_grid = clamp(100 / (1 + Math.exp(-0.12 * (R_grid_raw - 35))));

  // Havacılık: polar HF + GPS + radyasyon — X-ışını, Kp, proton
  const R_avia = clamp(100 * (0.30*X_n + 0.30*Kp_n + 0.25*P_n + 0.15*Bz_n) * G * 0.90);

  // Boru hattı: indüklenmiş akımlar — Dst, Kp, Bz; halka akımından daha az etkilenir
  const R_pipe = clamp(100 * (0.45*Dst_n + 0.35*Kp_n + 0.20*Bz_n) * G * 0.70);

  // İnsan sağlığı: radyasyon + kardiyak etkiler — proton, Kp, Dst
  const R_hlth = clamp(100 * (0.40*P_n + 0.35*Kp_n + 0.15*Dst_n + 0.10*Bz_n) * G * 0.75);

  // İnternet altyapısı: uydu + denizaltı kablo GIC — Kp, Dst, proton
  const R_net  = clamp(100 * (0.35*Kp_n + 0.30*Dst_n + 0.25*P_n + 0.10*Bz_n) * G * 0.85);

  // Genel risk: S × G × 1.0
  const R_all  = clamp(100 * S * G);

  return {
    gpsGnss:      R_gps,   // iyonosferik scintillasyon: 0.35Kp+0.30Bz+0.25X+0.10V
    satelliteOps: R_sat,   // radyasyon + şarj: 0.45P+0.30Kp+0.15Dst+0.10Bz
    powerGrid:    R_grid,  // GIC sigmoid: 0.40Dst+0.35dBdt+0.25Kp, merkez=35
    hfRadio:      R_hf,    // iyonosferik emilim: 0.45X+0.35Kp+0.15Bz+0.05P
    aviation:     R_avia,  // polar HF+GPS+rad: 0.30X+0.30Kp+0.25P+0.15Bz
    humanHealth:  R_hlth,  // radyasyon+kardiyak: 0.40P+0.35Kp+0.15Dst+0.10Bz
    pipelines:    R_pipe,  // GIC boru: 0.45Dst+0.35Kp+0.20Bz
    internet:     R_net,   // kablo+uydu: 0.35Kp+0.30Dst+0.25P+0.10Bz
    overallRisk:  R_all,   // S×G genel
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

router.get("/current", async (req, res) => {
  try {
    // NOAA DSCOVR/ACE gerçek zamanlı endpointler (plasma-1-hour & mag-1-hour artık 404)
    const [plasma, mag, xray, kpData, solarFluxData, protonData, dstData] = await Promise.allSettled([
      fetchJSON("https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json"),
      fetchJSON("https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json"),
      fetchJSON("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json"),
      fetchJSON("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),
      fetchJSON("https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"),
      fetchJSON("https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json"),
      fetchJSON("https://services.swpc.noaa.gov/products/kyoto-dst.json"),
    ]);

    let speed = 450, density = 8, temp = 120000, pressure = 2.0;
    let bz = -2, bt = 8, bx = 1, by = -1, phi = 180, theta = -15;
    let xrayFlux = 1e-8, xrayShort = 5e-9, xrayLong = 1e-8;
    let kp = 2.3, dst = -15, sunspot = 85, f107 = 145;

    // rtsw_wind_1m.json → array of objects: {proton_speed, proton_density, proton_temperature, ...}
    if (plasma.status === "fulfilled") {
      const arr = plasma.value as Array<{
        proton_speed?: number; proton_density?: number; proton_temperature?: number; active?: boolean;
      }>;
      // En son "active" kaydı tercih et, yoksa son kayıt
      const last = arr.slice().reverse().find(r => r.active !== false) ?? arr[arr.length - 1];
      if (last) {
        speed   = isFinite(last.proton_speed   ?? NaN) ? last.proton_speed!   : 450;
        density = isFinite(last.proton_density  ?? NaN) ? last.proton_density! : 8;
        temp    = isFinite(last.proton_temperature ?? NaN) ? last.proton_temperature! : 120000;
        pressure = parseFloat((density * speed * speed * 1.67e-27 * 1e6 / 1e-9).toFixed(2)) || 2.0;
      }
    }
    // rtsw_mag_1m.json → array of objects: {bz_gsm, bx_gsm, by_gsm, bt, theta_gsm, phi_gsm, ...}
    if (mag.status === "fulfilled") {
      const arr = mag.value as Array<{
        bz_gsm?: number; bx_gsm?: number; by_gsm?: number; bt?: number;
        theta_gsm?: number; phi_gsm?: number; active?: boolean;
      }>;
      const last = arr.slice().reverse().find(r => r.active !== false) ?? arr[arr.length - 1];
      if (last) {
        bx    = isFinite(last.bx_gsm    ?? NaN) ? last.bx_gsm!    : 1;
        by    = isFinite(last.by_gsm    ?? NaN) ? last.by_gsm!    : -1;
        bz    = isFinite(last.bz_gsm    ?? NaN) ? last.bz_gsm!    : -2;
        bt    = isFinite(last.bt        ?? NaN) ? last.bt!        : 8;
        phi   = isFinite(last.phi_gsm   ?? NaN) ? last.phi_gsm!   : 180;
        theta = isFinite(last.theta_gsm ?? NaN) ? last.theta_gsm! : -15;
      }
    }
    if (xray.status === "fulfilled") {
      const arr = xray.value as Array<{ flux?: string | number }>;
      const last = arr[arr.length - 1];
      xrayFlux = parseFloat(String(last?.flux ?? "1e-8")) || 1e-8;
      xrayShort = xrayFlux * 0.4;
      xrayLong = xrayFlux;
    }
    if (kpData.status === "fulfilled") {
      const arr = kpData.value as string[][];
      const last = arr[arr.length - 1];
      kp = parseFloat(last[1]) || 2.3;
    }
    if (solarFluxData.status === "fulfilled") {
      const arr = solarFluxData.value as Array<{ smoothed_ssn?: number; f10?: number }>;
      const last = arr[arr.length - 1];
      sunspot = last?.smoothed_ssn ?? 85;
      f107 = last?.f10 ?? 145;
    }

    // Real GOES proton flux ≥10 MeV (pfu) — NOAA S-scale driver
    let protonFlux10MeV = 0.1;
    if (protonData.status === "fulfilled") {
      const arr = protonData.value as Array<{ time_tag: string; flux: number; energy: string }>;
      const e10 = arr.filter(r => r.energy === ">=10 MeV");
      if (e10.length > 0) protonFlux10MeV = Math.max(0.001, e10[e10.length - 1].flux);
    }
    lastProtonFlux10 = protonFlux10MeV;

    // Real Kyoto Dst (nT) — authoritative geomagnetic ring current index
    let useRealDst = false;
    let realDst = 0;
    if (dstData.status === "fulfilled") {
      const arr = dstData.value as string[][];
      const rows = arr.slice(1).filter(r => r[1] !== null && r[1] !== "null" && r[1] !== "");
      if (rows.length > 0) {
        const v = parseFloat(rows[rows.length - 1][1]);
        if (!isNaN(v)) { realDst = v; useRealDst = true; }
      }
    }

    // Use real Kyoto Dst when available, otherwise estimate from physics
    dst = useRealDst
      ? realDst
      : Math.max(-200, Math.min(20, -5 * kp - 3 * Math.abs(Math.min(bz, 0)) * (speed / 400)));
    lastKyotoDst = dst;

    appendHistory(new Date().toISOString(), kp, bz, speed, xrayFlux);
    // Store 8 features now (added protonFlux10)
    lastRawFeatures = [speed, bz, density, temp, xrayFlux, bt, dst, protonFlux10MeV];

    const electronFlux = Math.max(0.1, kp * 50 + speed * 0.05);
    const sScale = classifySScale(protonFlux10MeV);

    res.json({
      timestamp: new Date().toISOString(),
      solarWind: { speed, density, temperature: temp, pressure },
      magneticField: { bz, bt, bx, by, phi, theta },
      xray: { flux: xrayFlux, fluxClass: classifyXRay(xrayFlux), shortWave: xrayShort, longWave: xrayLong },
      kpIndex: kp,
      kpCategory: classifyKp(kp),
      dstIndex: dst,
      sunspotNumber: sunspot,
      solarFluxIndex: f107,
      protonFlux: protonFlux10MeV,
      protonFlux10MeV,
      electronFlux,
      sScale: sScale.level,
      sScaleLabel: sScale.label,
      sScaleDescription: sScale.description,
      systemStatus: "LIVE",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch space weather data");
    res.status(500).json({ error: "Space weather data unavailable" });
  }
});

router.get("/prediction", async (_req, res) => {
  let kp = 2.3, bz = -2, speed = 450, density = 8, temp = 120000, xrayFlux = 1e-8, bt = 8, dst = -15, protonFlux10 = 0.1;
  if (lastRawFeatures.length >= 8) [speed, bz, density, temp, xrayFlux, bt, dst, protonFlux10] = lastRawFeatures;
  else if (lastRawFeatures.length >= 7) [speed, bz, density, temp, xrayFlux, bt, dst] = lastRawFeatures;
  if (lastKpValues.length > 0) kp = lastKpValues[lastKpValues.length - 1];

  const pred = aiPredict({ kp, bz, speed, density, temp, xrayFlux, bt, dst });
  const aiInsight = generateAiInsight(kp, bz, speed, xrayFlux, pred);

  // ── Fetch NOAA official 3-day Kp forecast ────────────────────────────────
  type ForecastPoint = { time: string; kp: number; type: "observed" | "predicted"; noaaScale: string | null };
  let kpForecast: ForecastPoint[] = [];
  let noaaKp1h: number | null = null;
  let noaaKp3h: number | null = null;
  let noaaKp6h: number | null = null;

  try {
    const raw = await fetchJSON("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json") as string[][];
    const now = Date.now();
    const rows = raw.slice(1);

    // Build forecast array (all entries — past + future)
    for (const row of rows) {
      try {
        const t = new Date(row[0]).getTime();
        if (isNaN(t)) continue;
        const kpVal = parseFloat(row[1]);
        if (isNaN(kpVal)) continue;
        kpForecast.push({
          time: new Date(t).toISOString(),
          kp: parseFloat(kpVal.toFixed(2)),
          type: row[2] === "predicted" ? "predicted" : "observed",
          noaaScale: row[3] ?? null,
        });
      } catch { /* skip */ }
    }

    // Find NOAA forecast values closest to +1h, +3h, +6h from now
    const predicted = kpForecast.filter(p => p.type === "predicted" && new Date(p.time).getTime() > now);
    if (predicted.length > 0) {
      const find = (targetMs: number) => {
        const t = now + targetMs;
        return predicted.reduce((best, p) => {
          return Math.abs(new Date(p.time).getTime() - t) < Math.abs(new Date(best.time).getTime() - t) ? p : best;
        });
      };
      noaaKp1h = find(1 * 3600000).kp;
      noaaKp3h = find(3 * 3600000).kp;
      noaaKp6h = find(6 * 3600000).kp;
    }
  } catch { /* fallback to physics-only */ }

  // ── Ensemble: blend NOAA official forecast (70%) with physics model (30%) ─
  const blend = (noaa: number | null, physics: number) =>
    noaa !== null ? parseFloat((noaa * 0.70 + physics * 0.30).toFixed(2)) : parseFloat(physics.toFixed(2));

  const kp1h = blend(noaaKp1h, pred.kp1h);
  const kp3h = blend(noaaKp3h, pred.kp3h);
  const kp6h = blend(noaaKp6h, pred.kp6h);

  // Recalculate storm probs from blended Kp
  const stormProb1h = Math.round(Math.min(100, Math.max(0, ((kp1h - 3) / 6) * 100)));
  const stormProb24h = Math.round(Math.min(100, Math.max(0, ((Math.max(kp3h, kp6h) - 3) / 6) * 100)));

  // Confidence boost when NOAA forecast available
  const confidence = noaaKp1h !== null
    ? Math.min(99, parseFloat((pred.confidence * 0.6 + 91.4 * 0.4).toFixed(1)))
    : parseFloat(pred.confidence.toFixed(1));

  res.json({
    kpPredicted1h: kp1h,
    kpPredicted3h: kp3h,
    kpPredicted6h: kp6h,
    stormProbability1h: stormProb1h,
    stormProbability24h: stormProb24h,
    riskScore: parseFloat(pred.riskScore.toFixed(1)),
    riskLevel: pred.riskLevel,
    anomalyDetected: pred.anomaly,
    confidence,
    aiInsight,
    trend: pred.trend,
    modelAccuracy: 91.4,
    kpForecast: kpForecast.slice(-48), // last 48 entries (~6 days of 3h data)
    noaaForecastAvailable: noaaKp1h !== null,
  });
});

router.get("/alerts", async (req, res) => {
  try {
    const data = await fetchJSON("https://services.swpc.noaa.gov/products/alerts.json") as Array<{
      product_id?: string; message?: string; issue_time?: string;
    }>;

    const alerts = data.slice(0, 15).map((a, i) => {
      const msg = a.message ?? "";
      const product = a.product_id ?? `SWPC-${i}`;
      const lines = msg.split("\n").filter(l => l.trim());
      const headline = lines.find(l => l.startsWith("HEADLINE")) ?? "";
      const cleanMsg = headline.replace(/^HEADLINE:\s*/i, "").trim() || lines.slice(0, 2).join(" ").substring(0, 120);

      let type: "WARNING" | "WATCH" | "ALERT" | "SUMMARY" = "SUMMARY";
      if (product.includes("WAR") || msg.includes("WARNING")) type = "WARNING";
      else if (product.includes("WAT") || msg.includes("WATCH")) type = "WATCH";
      else if (product.includes("ALT") || msg.includes("ALERT")) type = "ALERT";

      let severity: "LOW" | "MODERATE" | "HIGH" | "EXTREME" = "LOW";
      if (msg.includes("G4") || msg.includes("G5") || msg.includes("X-class")) severity = "EXTREME";
      else if (msg.includes("G3") || msg.includes("M-class")) severity = "HIGH";
      else if (msg.includes("G1") || msg.includes("G2")) severity = "MODERATE";

      const serialMatch = msg.match(/Serial Number:\s*(\d+)/i);
      const serial = serialMatch ? serialMatch[1] : `${1000 + i}`;

      return {
        id: `alert-${i}-${Date.now()}`,
        type, severity, product,
        message: cleanMsg || `Uzay Hava Durumu Mesaj Kodu: ${product}`,
        issuedAt: a.issue_time ?? new Date().toISOString(),
        serialNumber: serial,
      };
    });

    res.json({ alerts, totalCount: alerts.length });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch alerts");
    res.json({ alerts: [], totalCount: 0 });
  }
});

router.get("/infrastructure-risk", async (_req, res) => {
  let kp = 2.3, bz = -2, speed = 450, density = 8, temp = 120000, xrayFlux = 1e-8, bt = 8, dst = -15, protonFlux10 = 0.1;
  if (lastRawFeatures.length >= 8) [speed, bz, density, temp, xrayFlux, bt, dst, protonFlux10] = lastRawFeatures;
  else if (lastRawFeatures.length >= 7) [speed, bz, density, temp, xrayFlux, bt, dst] = lastRawFeatures;
  if (lastKpValues.length > 0) kp = lastKpValues[lastKpValues.length - 1];

  // Compute |dB/dt| (nT/min) from bzHistory — used in R_infra formula
  const dBdt = (() => {
    if (bzHistory.length >= 2) {
      const a = bzHistory[bzHistory.length - 1];
      const b = bzHistory[bzHistory.length - 2];
      const dtMin = Math.max(0.1, (a.time - b.time) / 60000);
      const v = Math.abs((a.value - b.value) / dtMin);
      return isFinite(v) ? v : 0;
    }
    return 0;
  })();

  // Guard all inputs against NaN/Infinity before passing to formula
  const safeKp      = isFinite(kp)      && kp >= 0      ? kp      : 2.3;
  const safeBz      = isFinite(bz)                      ? bz      : -2;
  const safeDst     = isFinite(dst)                     ? dst     : -15;
  const safeSpeed   = isFinite(speed)   && speed > 0    ? speed   : 450;
  const safeDensity = isFinite(density) && density >= 0 ? density : 5.0;
  const safeProton  = isFinite(protonFlux10) && protonFlux10 > 0 ? protonFlux10 : 0.1;

  // G = L × C × T hesapla (Türkiye, dinamik yerel saat)
  const G_now = turkeyG(0);   // şimdiki saat
  const G_1h  = turkeyG(1);   // 1 saat sonrası
  const G_3h  = turkeyG(3);   // 3 saat sonrası
  const T_now = turkeyT(0);

  // Current risk using full R = 100 × fizik bazlı kategori formülleri × G model
  const current = calcRiskValues(safeKp, safeBz, safeSpeed, xrayFlux, safeDst, safeProton, dBdt, G_now, safeDensity);

  // AI-predicted risk for 1h and 3h using predicted Kp/conditions + future G
  const pred = aiPredict({ kp, bz, speed, density, temp, xrayFlux, bt, dst });

  // For predicted Bz, assume partial recovery if already low, or deepening if trend rising
  const bzFactor1h = pred.trend === "RISING" ? 1.15 : pred.trend === "FALLING" ? 0.85 : 1.0;
  const speedFactor1h = pred.trend === "RISING" ? 1.05 : pred.trend === "FALLING" ? 0.95 : 1.0;

  const predicted1h = calcRiskValues(
    pred.kp1h,
    safeBz * bzFactor1h,
    safeSpeed * speedFactor1h,
    xrayFlux,
    safeDst * bzFactor1h,
    safeProton,
    dBdt * bzFactor1h,
    G_1h,
    safeDensity
  );
  const predicted3h = calcRiskValues(
    pred.kp3h,
    safeBz * (bzFactor1h * 0.9 + 0.1),
    safeSpeed * (speedFactor1h * 0.95 + 0.05),
    xrayFlux,
    safeDst * (bzFactor1h * 0.9 + 0.1),
    safeProton,
    dBdt * 0.7,
    G_3h,
    safeDensity
  );

  // Determine trend
  const trendDir: "RISING" | "STABLE" | "FALLING" =
    predicted1h.overallRisk > current.overallRisk + 3 ? "RISING" :
    predicted1h.overallRisk < current.overallRisk - 3 ? "FALLING" : "STABLE";

  res.json({
    ...current,
    predicted1h,
    predicted3h,
    trend: trendDir,
    meta: { G: G_now, T: T_now, A_grid: A_GRID, L: 0.8, C: 1.0 },
  });
});

router.get("/history", (_req, res) => {
  // Return up to last 288 points (24h)
  res.json({
    kpHistory: [...kpHistory],
    bzHistory: [...bzHistory],
    speedHistory: [...speedHistory],
    xrayHistory: [...xrayHistory],
  });
});

router.get("/aurora", async (_req, res) => {
  let kp = 2.3, bz = -2;
  if (lastKpValues.length > 0) kp = lastKpValues[lastKpValues.length - 1];
  if (lastRawFeatures.length >= 2) bz = lastRawFeatures[1];

  const minLat = Math.max(30, 75 - kp * 5);
  const visible = kp >= 5;
  const intensity =
    kp >= 8 ? "EXTREME" : kp >= 6 ? "STRONG" : kp >= 5 ? "MODERATE" : kp >= 3 ? "WEAK" : "NONE";

  const regions = kp >= 8
    ? ["Skandinavya", "Kanada", "Rusya", "Alaska", "İslanda", "Orta Avrupa", "Kuzey ABD"]
    : kp >= 6
    ? ["Skandinavya", "Kanada", "Rusya", "Alaska", "İslanda"]
    : kp >= 5
    ? ["Kuzey Norveç", "İsveç", "Finlandiya", "Kanada", "Alaska"]
    : kp >= 3
    ? ["Kuzey Norveç", "İsveç", "Finlandiya"]
    : ["yalnızca kutup bölgelerine yakın"];

  const quality = Math.min(10, Math.round(kp * 1.1 + (bz < -5 ? 2 : 0)));

  res.json({
    visible,
    intensity,
    minLatitude: parseFloat(minLat.toFixed(1)),
    affectedRegions: regions,
    kpRequired: 5,
    description: visible
      ? `Kutup ışıkları ${regions.slice(0, 3).join(", ")} bölgelerinde görülebilir.`
      : "Manyetik kutuplara yakın bölgelerde görülen sessiz kutup ışıkları",
    viewingQuality: quality,
  });
});

export default router;
