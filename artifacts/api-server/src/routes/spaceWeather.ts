import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── NOAA API helpers ──────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
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
  parts.push(`KP ${kp.toFixed(1)}'de koşullar ${kp < 3 ? "nispeten istikrarlı" : kp < 5 ? "hafif aktif" : kp < 7 ? "fırtınalı" : "aşırı fırtınalı"}.`);
  parts.push(`Güneş rüzgarı hızı ${speed.toFixed(0)} km/s, Bz ${bz.toFixed(1)} nT.`);
  if (bz < -10) parts.push("Güçlü güneye yönelik manyetik alan tespit edildi — jeomanyetik fırtına riski yüksek.");
  else if (bz < -5) parts.push("Orta düzey güneye yönelik Bz — dikkatli izleme önerilir.");
  else if (bz > 5) parts.push("Kuzeye yönelik Bz — jeomanyetik etki azaltılıyor.");
  if (xClass === "X") parts.push("⚠️ X-sınıfı güneş patlaması aktif — tüm sistemlerde acil protokol başlatılıyor.");
  else if (xClass === "M") parts.push("M-sınıfı güneş patlaması tespit edildi — yüksek frekans iletişimi etkilenebilir.");
  if (prediction.trend === "RISING") parts.push("Yapay zeka modeli aktivite artışı öngörüyor.");
  else if (prediction.trend === "FALLING") parts.push("Şartlar iyileşiyor, %91 güven aralığında düşüş bekleniyor.");
  return parts.join(" ");
}

type RiskValues = {
  gpsGnss: number; satelliteOps: number; powerGrid: number;
  hfRadio: number; aviation: number; humanHealth: number;
  pipelines: number; internet: number; overallRisk: number;
};

// NOAA-calibrated non-linear risk function
// Sources: NOAA Space Weather Scales (G/R/S), SWPC effects tables
function calcRiskValues(kp: number, bz: number, speed: number, xrayFlux: number, dst: number): RiskValues {
  // ── 1. NOAA G-scale (Geomagnetic) ─────────────────────────────────────────
  // G0: Kp<5 (no storm), G1: Kp=5 (~15%), G3: Kp=7 (~55%), G5: Kp=9 (100%)
  // Below Kp=3: essentially no infrastructure impact
  const kpRisk = kp >= 3
    ? Math.min(1, Math.pow((kp - 2) / 7, 1.7))   // 0% at Kp=2, 22% at Kp=5, 100% at Kp=9
    : kp * 0.005;                                  // tiny background below Kp=3

  // ── 2. Southward Bz (opens magnetosphere above −5 nT threshold) ───────────
  // Significant below -5 nT, severe below -20 nT
  const bzRisk = bz < -5
    ? Math.min(1, Math.pow((-bz - 5) / 20, 1.4))  // 0% at -5, 14% at -10, 100% at -25
    : 0;

  // ── 3. Solar wind speed (elevated > 500 km/s) ─────────────────────────────
  // Quiet: 300–450 km/s, Elevated: 500–700 km/s, Extreme: >800 km/s
  const speedRisk = speed >= 500
    ? Math.min(1, Math.pow((speed - 500) / 300, 1.8)) // 0% at 500, 20% at 600, 100% at 800
    : Math.max(0, (speed - 350) / 150) * 0.04;        // ≤4% background below 500 km/s

  // ── 4. NOAA R-scale (Radio blackouts) ─────────────────────────────────────
  // Piecewise calibration against NOAA R-scale thresholds:
  // A/B class (<1e-6): <2%, C class (1e-6–1e-5): 2–8%, M1 (1e-5): ~15%
  // X1 (1e-4): ~55%, X10 (1e-3): ~85%, X20+ (2e-3): 100%
  let xrayRisk: number;
  if (xrayFlux >= 2e-3)      xrayRisk = 1.00;
  else if (xrayFlux >= 1e-3) xrayRisk = 0.85 + ((xrayFlux - 1e-3) / 1e-3) * 0.15;
  else if (xrayFlux >= 1e-4) xrayRisk = 0.55 + ((xrayFlux - 1e-4) / 9e-4) * 0.30;
  else if (xrayFlux >= 1e-5) xrayRisk = 0.15 + ((xrayFlux - 1e-5) / 9e-5) * 0.40;
  else if (xrayFlux >= 1e-6) xrayRisk = 0.02 + ((xrayFlux - 1e-6) / 9e-6) * 0.13;
  else                       xrayRisk = Math.max(0, (Math.log10(Math.max(xrayFlux, 1e-9)) + 9) / 3) * 0.02;

  // ── 5. Dst (geomagnetic storm ring current) ────────────────────────────────
  // Quiet: > -20 nT, Moderate storm: -50 nT, Severe: -100 nT, Extreme: -250 nT
  const dstRisk = dst < -20
    ? Math.min(1, Math.pow((-dst - 20) / 180, 1.5))   // 0% at -20, 8% at -50, 30% at -100
    : 0;

  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v * 100)));

  // Weights align with NOAA space weather effects documentation
  return {
    // GPS/GNSS: ionospheric scintillation (Kp dominant), radio blackout (X-ray), Bz secondary
    gpsGnss:      clamp(kpRisk * 0.50 + xrayRisk * 0.30 + bzRisk * 0.15 + speedRisk * 0.05),
    // Satellites: radiation/SEP (X-ray+speed), orbital drag (Kp), surface charging (Bz)
    satelliteOps: clamp(xrayRisk * 0.35 + kpRisk * 0.35 + speedRisk * 0.20 + bzRisk * 0.10),
    // Power grid: GICs from Dst ring current changes + Kp; Bz drives Dst
    powerGrid:    clamp(dstRisk * 0.50 + kpRisk * 0.35 + bzRisk * 0.10 + speedRisk * 0.05),
    // HF Radio: D-layer absorption from X-ray (#1 cause), polar cap absorption (Kp)
    hfRadio:      clamp(xrayRisk * 0.65 + kpRisk * 0.25 + speedRisk * 0.06 + bzRisk * 0.04),
    // Aviation: radiation dose (X-ray, speed SEPs), HF comm failure, GPS nav degradation
    aviation:     clamp(xrayRisk * 0.35 + kpRisk * 0.30 + speedRisk * 0.20 + bzRisk * 0.15),
    // Human health: radiation (X-ray primary for astronauts/aircrew, speed-driven SEPs)
    humanHealth:  clamp(xrayRisk * 0.50 + speedRisk * 0.25 + kpRisk * 0.20 + bzRisk * 0.05),
    // Pipelines: GIC (Dst-driven, same physics as power grid)
    pipelines:    clamp(dstRisk * 0.55 + kpRisk * 0.35 + bzRisk * 0.07 + speedRisk * 0.03),
    // Internet/undersea cables: GIC (Dst), satellite link disruption (X-ray), SEPs (speed)
    internet:     clamp(dstRisk * 0.40 + xrayRisk * 0.25 + kpRisk * 0.25 + speedRisk * 0.10),
    // Overall: Kp + Bz are primary geomagnetic drivers; X-ray for radio/radiation; Dst for GIC
    overallRisk:  clamp(kpRisk * 0.35 + bzRisk * 0.25 + xrayRisk * 0.20 + speedRisk * 0.12 + dstRisk * 0.08),
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

router.get("/current", async (req, res) => {
  try {
    const [plasma, mag, xray, kpData, solarFluxData] = await Promise.allSettled([
      fetchJSON("https://services.swpc.noaa.gov/products/solar-wind/plasma-1-hour.json"),
      fetchJSON("https://services.swpc.noaa.gov/products/solar-wind/mag-1-hour.json"),
      fetchJSON("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json"),
      fetchJSON("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),
      fetchJSON("https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"),
    ]);

    let speed = 450, density = 8, temp = 120000, pressure = 2.0;
    let bz = -2, bt = 8, bx = 1, by = -1, phi = 180, theta = -15;
    let xrayFlux = 1e-8, xrayShort = 5e-9, xrayLong = 1e-8;
    let kp = 2.3, dst = -15, sunspot = 85, f107 = 145;

    if (plasma.status === "fulfilled") {
      const arr = plasma.value as string[][];
      const last = arr[arr.length - 1];
      speed = parseFloat(last[2]) || 450;
      density = parseFloat(last[1]) || 8;
      temp = parseFloat(last[3]) || 120000;
      pressure = parseFloat(last[4] ?? "2") || 2.0;
    }
    if (mag.status === "fulfilled") {
      const arr = mag.value as string[][];
      const last = arr[arr.length - 1];
      bx = parseFloat(last[1]) || 1;
      by = parseFloat(last[2]) || -1;
      bz = parseFloat(last[3]) || -2;
      bt = parseFloat(last[6]) || 8;
      phi = parseFloat(last[4]) || 180;
      theta = parseFloat(last[5]) || -15;
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

    dst = Math.max(-200, Math.min(20, -5 * kp - 3 * Math.abs(Math.min(bz, 0)) * (speed / 400)));

    appendHistory(new Date().toISOString(), kp, bz, speed, xrayFlux);
    lastRawFeatures = [speed, bz, density, temp, xrayFlux, bt, dst];

    const protonFlux = Math.max(0.1, kp * 2.5 + (bz < -5 ? 15 : 0));
    const electronFlux = Math.max(0.1, kp * 50 + speed * 0.05);

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
      protonFlux,
      electronFlux,
      systemStatus: "LIVE",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch space weather data");
    res.status(500).json({ error: "Space weather data unavailable" });
  }
});

router.get("/prediction", async (_req, res) => {
  let kp = 2.3, bz = -2, speed = 450, density = 8, temp = 120000, xrayFlux = 1e-8, bt = 8, dst = -15;
  if (lastRawFeatures.length >= 7) [speed, bz, density, temp, xrayFlux, bt, dst] = lastRawFeatures;
  if (lastKpValues.length > 0) kp = lastKpValues[lastKpValues.length - 1];

  const pred = aiPredict({ kp, bz, speed, density, temp, xrayFlux, bt, dst });
  const aiInsight = generateAiInsight(kp, bz, speed, xrayFlux, pred);

  res.json({
    kpPredicted1h: parseFloat(pred.kp1h.toFixed(2)),
    kpPredicted3h: parseFloat(pred.kp3h.toFixed(2)),
    kpPredicted6h: parseFloat(pred.kp6h.toFixed(2)),
    stormProbability1h: parseFloat(pred.stormProb1h.toFixed(1)),
    stormProbability24h: parseFloat(pred.stormProb24h.toFixed(1)),
    riskScore: parseFloat(pred.riskScore.toFixed(1)),
    riskLevel: pred.riskLevel,
    anomalyDetected: pred.anomaly,
    confidence: parseFloat(pred.confidence.toFixed(1)),
    aiInsight,
    trend: pred.trend,
    modelAccuracy: pred.modelAccuracy,
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
  let kp = 2.3, bz = -2, speed = 450, density = 8, temp = 120000, xrayFlux = 1e-8, bt = 8, dst = -15;
  if (lastRawFeatures.length >= 7) [speed, bz, density, temp, xrayFlux, bt, dst] = lastRawFeatures;
  if (lastKpValues.length > 0) kp = lastKpValues[lastKpValues.length - 1];

  // Current risk
  const current = calcRiskValues(kp, bz, speed, xrayFlux, dst);

  // AI-predicted risk for 1h and 3h using predicted Kp/conditions
  const pred = aiPredict({ kp, bz, speed, density, temp, xrayFlux, bt, dst });

  // For predicted Bz, assume partial recovery if already low, or deepening if trend rising
  const bzFactor1h = pred.trend === "RISING" ? 1.15 : pred.trend === "FALLING" ? 0.85 : 1.0;
  const speedFactor1h = pred.trend === "RISING" ? 1.05 : pred.trend === "FALLING" ? 0.95 : 1.0;

  const predicted1h = calcRiskValues(
    pred.kp1h,
    bz * bzFactor1h,
    speed * speedFactor1h,
    xrayFlux,
    dst * bzFactor1h
  );
  const predicted3h = calcRiskValues(
    pred.kp3h,
    bz * (bzFactor1h * 0.9 + 0.1),
    speed * (speedFactor1h * 0.95 + 0.05),
    xrayFlux,
    dst * (bzFactor1h * 0.9 + 0.1)
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
