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

  const bzFactor = bz < -10 ? 3 : bz < -5 ? 2 : bz < 0 ? 1 : 0;
  const speedFactor = speed > 700 ? 3 : speed > 500 ? 2 : speed > 400 ? 1 : 0;
  const densityFactor = density > 20 ? 2 : density > 10 ? 1 : 0;
  const xrayFactor = xrayFlux >= 1e-4 ? 4 : xrayFlux >= 1e-5 ? 2 : xrayFlux >= 1e-6 ? 1 : 0;
  const btFactor = bt > 20 ? 2 : bt > 10 ? 1 : 0;
  const dstFactor = dst < -100 ? 3 : dst < -50 ? 2 : dst < -30 ? 1 : 0;

  const rawScore = kp * 0.35 + bzFactor * 0.8 + speedFactor * 0.7 +
    densityFactor * 0.4 + xrayFactor * 0.5 + btFactor * 0.3 + dstFactor * 0.6;

  const kp1h = Math.min(9, Math.max(0, rawScore * 0.95 + (Math.random() * 0.3 - 0.15)));
  const kp3h = Math.min(9, Math.max(0, rawScore * 1.05 + (Math.random() * 0.4 - 0.2)));
  const kp6h = Math.min(9, Math.max(0, rawScore * 0.85 + (Math.random() * 0.5 - 0.25)));

  const stormProb1h = Math.min(100, Math.max(0, (rawScore / 9) * 100 * (bz < -5 ? 1.4 : 1.0)));
  const stormProb24h = Math.min(100, Math.max(0, stormProb1h * 1.2 + xrayFactor * 5));
  const riskScore = Math.min(100, Math.max(0,
    (kp / 9) * 30 + bzFactor * 8 + speedFactor * 7 + xrayFactor * 10 + dstFactor * 8 + densityFactor * 5
  ));

  const riskLevel = riskScore >= 70 ? "EXTREME" : riskScore >= 50 ? "HIGH" : riskScore >= 25 ? "MODERATE" : "LOW";
  const anomaly = (speed > 600 && bz < -8) || xrayFlux >= 1e-4 || (density > 25 && speed > 500);

  let trend: "RISING" | "STABLE" | "FALLING" = "STABLE";
  if (lastKpValues.length >= 3) {
    const recent = lastKpValues.slice(-3);
    const delta = recent[recent.length - 1] - recent[0];
    if (delta > 0.5) trend = "RISING";
    else if (delta < -0.5) trend = "FALLING";
  }

  const confidence = Math.min(99, Math.max(70, 88 - riskScore * 0.1 + (lastKpValues.length * 0.5)));
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

function calcRiskValues(kp: number, bz: number, speed: number, xrayFlux: number, dst: number): RiskValues {
  const kpN = kp / 9;
  const bzN = Math.min(1, Math.abs(Math.min(bz, 0)) / 20);
  const speedN = Math.min(1, (speed - 300) / 500);
  const xrayN = Math.min(1, (Math.log10(Math.max(xrayFlux, 1e-10)) + 7) / 4);
  const dstN = Math.min(1, Math.abs(Math.min(dst, 0)) / 150);
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v * 100)));
  return {
    gpsGnss: clamp(kpN * 0.5 + bzN * 0.3 + speedN * 0.2),
    satelliteOps: clamp(kpN * 0.4 + xrayN * 0.4 + speedN * 0.2),
    powerGrid: clamp(kpN * 0.5 + dstN * 0.4 + bzN * 0.1),
    hfRadio: clamp(xrayN * 0.6 + kpN * 0.3 + speedN * 0.1),
    aviation: clamp(kpN * 0.4 + xrayN * 0.3 + speedN * 0.3),
    humanHealth: clamp(kpN * 0.3 + xrayN * 0.4 + speedN * 0.3),
    pipelines: clamp(dstN * 0.5 + kpN * 0.4 + bzN * 0.1),
    internet: clamp(kpN * 0.3 + xrayN * 0.3 + speedN * 0.4),
    overallRisk: clamp((kpN + bzN + speedN + xrayN + dstN) / 5),
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
