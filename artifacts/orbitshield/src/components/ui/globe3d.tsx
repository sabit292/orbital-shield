import React, { useRef, useEffect } from "react";
import type { SpaceWeatherData, AIPrediction, InfrastructureRisk } from "@workspace/api-client-react/src/generated/api.schemas";

interface Globe3DProps {
  data?: SpaceWeatherData;
  pred?: AIPrediction;
  risk?: InfrastructureRisk;
}

const IMPACT_ZONES = [
  { lat: 64,  lon: -20,  label: "İzlanda",       system: "hfRadio",     hex: "#00f0ff" },
  { lat: 70,  lon: 25,   label: "Norveç",         system: "hfRadio",     hex: "#00f0ff" },
  { lat: 65,  lon: -148, label: "Alaska",         system: "powerGrid",   hex: "#ffaa00" },
  { lat: 60,  lon: -95,  label: "Kanada",         system: "powerGrid",   hex: "#ffaa00" },
  { lat: 55,  lon: 37,   label: "Moskova",        system: "gpsGnss",     hex: "#39ff14" },
  { lat: 52,  lon: 5,    label: "Batı Avrupa",    system: "gpsGnss",     hex: "#39ff14" },
  { lat: 35,  lon: 139,  label: "Tokyo",          system: "satelliteOps",hex: "#cc44ff" },
  { lat: 40,  lon: -74,  label: "New York",       system: "aviation",    hex: "#ff4444" },
  { lat: -75, lon: 0,    label: "Antarktika",     system: "hfRadio",     hex: "#00f0ff" },
  { lat: -55, lon: -68,  label: "G. Amerika",     system: "gpsGnss",     hex: "#39ff14" },
];

// Simplified continent polygons [lat, lon]
const LAND_POLYGONS: [number, number][][] = [
  // North America
  [[71,-153],[72,-131],[75,-88],[72,-76],[63,-64],[45,-53],[45,-60],
   [35,-75],[25,-80],[22,-90],[16,-88],[16,-92],[20,-103],[22,-110],
   [32,-117],[38,-123],[48,-124],[55,-133],[60,-145],[65,-168],[71,-153]],
  // Greenland
  [[83,-25],[82,-15],[80,-18],[76,-19],[72,-24],[70,-24],
   [70,-35],[72,-40],[76,-42],[80,-40],[83,-35],[83,-25]],
  // South America
  [[12,-72],[10,-62],[8,-60],[5,-52],[0,-50],[-5,-35],[-10,-37],
   [-15,-40],[-23,-43],[-28,-49],[-34,-54],[-42,-63],[-54,-67],
   [-56,-68],[-53,-74],[-42,-73],[-35,-57],[-25,-44],[-10,-37],
   [0,-48],[5,-52],[8,-60],[12,-72]],
  // Europe
  [[36,-8],[36,2],[43,3],[48,2],[51,2],[52,4],[55,8],
   [58,5],[65,14],[70,20],[70,28],[65,25],[60,25],[57,22],
   [55,18],[50,18],[48,18],[46,28],[44,28],[42,28],[40,18],
   [38,14],[37,15],[36,10],[36,-8]],
  // Scandinavia
  [[56,8],[58,5],[63,5],[65,14],[68,18],[70,20],[72,26],
   [70,28],[68,28],[65,25],[60,25],[57,22],[56,8]],
  // Africa
  [[37,10],[37,12],[33,15],[28,33],[22,37],[12,44],[12,43],
   [5,35],[0,42],[-5,40],[-10,38],[-22,35],[-34,26],[-34,18],
   [-29,16],[-22,14],[-17,12],[-5,10],[0,8],[5,2],[5,-5],
   [10,-15],[15,-17],[20,-17],[22,-14],[28,-10],[33,-5],[37,10]],
  // Asia
  [[70,28],[72,50],[73,80],[73,120],[70,130],[60,140],[55,135],
   [50,140],[48,135],[40,127],[35,122],[25,120],[22,114],[20,110],
   [10,105],[5,100],[5,103],[1,104],[5,100],[10,105],[15,100],
   [20,93],[22,92],[22,88],[20,85],[14,80],[8,78],[8,77],
   [20,70],[22,60],[25,57],[22,55],[15,45],[12,44],[22,37],
   [28,33],[33,35],[37,36],[40,36],[38,26],[41,29],[45,30],
   [50,30],[55,38],[60,50],[65,60],[68,70],[70,80],[70,28]],
  // Arabian Peninsula
  [[22,55],[24,58],[22,60],[18,57],[12,44],[15,42],[22,55]],
  // Indian Subcontinent
  [[22,68],[22,88],[8,78],[8,77],[20,68],[22,68]],
  // SE Asia
  [[22,100],[18,100],[10,99],[5,103],[1,104],[3,106],
   [10,105],[16,103],[20,106],[22,105],[22,100]],
  // Australia
  [[-16,130],[-16,136],[-18,140],[-22,150],[-28,154],[-38,146],
   [-38,140],[-34,136],[-32,128],[-28,122],[-22,114],[-20,118],[-16,130]],
  // Japan
  [[41,140],[38,141],[35,136],[33,130],[34,131],[36,136],[38,141],[41,140]],
  // UK
  [[50,-5],[52,-4],[58,-3],[60,-3],[58,0],[55,2],[52,2],[50,0],[50,-5]],
];

// Orthographic projection: returns {x, y, visible}
function ortho(lat: number, lon: number, rotY: number, cx: number, cy: number, R: number) {
  const φ = (lat * Math.PI) / 180;
  const λ = ((lon - rotY * 180 / Math.PI) * Math.PI) / 180;
  const x = R * Math.cos(φ) * Math.sin(λ);
  const y = -R * Math.sin(φ);
  const z = Math.cos(φ) * Math.cos(λ); // >0 = visible hemisphere
  return { x: cx + x, y: cy + y, z };
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function Globe3D({ data, risk }: Globe3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef({ rotY: 0.4, isDragging: false, lastX: 0 });

  const kp    = data?.kpIndex     ?? 2;
  const speed = data?.solarWind?.speed ?? 400;

  const getRisk = (system: string): number => {
    if (!risk) return 5;
    const v = (risk as Record<string, unknown>)[system];
    return typeof v === "number" ? v : 5;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Particles (solar wind)
    const NPART = 300;
    const parts: { x: number; y: number; vx: number; vy: number; alpha: number }[] = [];
    const resetParticle = () => ({
      x: -canvas.width * 0.1 - Math.random() * canvas.width * 0.5,
      y: (Math.random() - 0.5) * canvas.height,
      vx: (1.5 + Math.random() * 2) * (speed / 400),
      vy: (Math.random() - 0.5) * 0.4,
      alpha: 0.2 + Math.random() * 0.4,
    });
    for (let i = 0; i < NPART; i++) {
      parts.push({ ...resetParticle(), x: (Math.random() - 0.5) * canvas.width * 2 });
    }

    let raf = 0;
    let t = 0;
    const st = stateRef.current;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.016;
      if (!st.isDragging) st.rotY += 0.004;

      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const R  = Math.min(W, H) * 0.40;

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = "#010913";
      ctx.fillRect(0, 0, W, H);

      // Stars
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      for (let i = 0; i < 120; i++) {
        const sx = ((i * 137.5) % W);
        const sy = ((i * 97.3)  % H);
        const sr = (i % 3 === 0) ? 1.1 : 0.55;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Solar wind particles
      const windColor = kp < 4 ? "0,160,255" : kp < 7 ? "255,160,0" : "255,60,0";
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x > W * 0.6) Object.assign(p, resetParticle());
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${windColor},${p.alpha * 0.5})`;
        ctx.lineWidth = 1;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 5, p.y - p.vy * 5);
        ctx.stroke();
      }

      // Atmosphere glow
      const kpNorm = Math.min(kp / 9, 1);
      const atmoR = kpNorm > 0.5 ? 180 : 0;
      const atmoG = kpNorm > 0.7 ? 30 : Math.round(150 * (1 - kpNorm));
      const atmoB = Math.round(255 * (1 - kpNorm * 0.6));
      const atmoGrad = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.22);
      atmoGrad.addColorStop(0, `rgba(${atmoR},${atmoG},${atmoB},0.35)`);
      atmoGrad.addColorStop(0.5, `rgba(${atmoR},${atmoG},${atmoB},0.12)`);
      atmoGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2);
      ctx.fillStyle = atmoGrad;
      ctx.fill();

      // Ocean sphere
      const oceanGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.05, cx, cy, R);
      oceanGrad.addColorStop(0, "#0a2540");
      oceanGrad.addColorStop(0.6, "#020d1f");
      oceanGrad.addColorStop(1, "#000810");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = oceanGrad;
      ctx.fill();

      // Latitude / longitude grid (only on visible hemisphere)
      ctx.strokeStyle = "rgba(0,80,140,0.20)";
      ctx.lineWidth = 0.6;
      // Lon lines
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let first = true;
        for (let lat = -90; lat <= 90; lat += 3) {
          const p = ortho(lat, lon, st.rotY, cx, cy, R);
          if (p.z < 0) { first = true; continue; }
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      // Lat lines
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let first = true;
        for (let lon = -180; lon <= 180; lon += 3) {
          const p = ortho(lat, lon, st.rotY, cx, cy, R);
          if (p.z < 0) { first = true; continue; }
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // Continents
      for (const poly of LAND_POLYGONS) {
        if (poly.length < 2) continue;
        ctx.beginPath();
        let first = true;
        for (const [lat, lon] of poly) {
          const p = ortho(lat, lon, st.rotY, cx, cy, R);
          if (p.z < 0) { first = true; continue; }
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle   = "rgba(18,42,22,0.85)";
        ctx.fill();
        ctx.strokeStyle = "#00bb66";
        ctx.lineWidth   = 1.2;
        ctx.stroke();
      }

      // Aurora rings
      const auroraOpacity = Math.min(kp / 6, 1) * 0.85;
      const auroraColor   = kp < 4 ? "0,255,136" : kp < 7 ? "255,160,0" : "255,40,0";
      for (const [aLat, sign] of [[68, 1], [72, 1], [68, -1], [72, -1]] as [number, number][]) {
        ctx.beginPath();
        let first = true;
        for (let lon = -180; lon <= 180; lon += 2) {
          const p = ortho(sign * aLat, lon, st.rotY, cx, cy, R * 1.012);
          if (p.z < 0) { first = true; continue; }
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(${auroraColor},${auroraOpacity})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Sphere edge highlight
      const edgeGrad = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.35, 0, cx, cy, R);
      edgeGrad.addColorStop(0, "rgba(60,120,160,0.15)");
      edgeGrad.addColorStop(0.75, "rgba(0,0,0,0)");
      edgeGrad.addColorStop(0.9, "rgba(0,160,200,0.07)");
      edgeGrad.addColorStop(1, "rgba(0,200,255,0.20)");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = edgeGrad;
      ctx.fill();
      // Clip globe edge
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,200,255,0.30)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Impact zone markers
      for (const zone of IMPACT_ZONES) {
        const p = ortho(zone.lat, zone.lon, st.rotY, cx, cy, R * 1.01);
        if (p.z < 0.05) continue;
        const rPct = getRisk(zone.system) / 100;
        const { r, g, b } = hexToRgb(zone.hex);
        const col = `${r},${g},${b}`;
        const fade = Math.min(1, (p.z - 0.05) / 0.2);

        // Outer pulse ring
        const ringR = R * (0.04 + rPct * 0.03) * (1 + Math.sin(t * 3 + zone.lat) * 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${col},${0.6 * fade})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Glow dot
        const dotGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, ringR * 0.9);
        dotGrad.addColorStop(0, `rgba(${col},${0.95 * fade})`);
        dotGrad.addColorStop(0.4, `rgba(${col},${0.5 * fade})`);
        dotGrad.addColorStop(1, `rgba(${col},0)`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringR * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = dotGrad;
        ctx.fill();

        // Spike outward
        const spikeLen = R * (0.06 + rPct * 0.06);
        const nx = p.x - cx, ny = p.y - cy;
        const nd = Math.sqrt(nx * nx + ny * ny) || 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (nx / nd) * spikeLen, p.y + (ny / nd) * spikeLen);
        ctx.strokeStyle = `rgba(${col},${0.55 * fade})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        const lx = p.x + (nx / nd) * (spikeLen + 5);
        const ly = p.y + (ny / nd) * (spikeLen + 5);
        ctx.font = "bold 10px 'Courier New', monospace";
        ctx.textAlign = lx > cx ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `rgba(${col},${Math.min(0.95, fade * 1.5)})`;
        ctx.shadowColor = `rgba(${col},0.8)`;
        ctx.shadowBlur = 6;
        ctx.fillText(zone.label, lx + (lx > cx ? 3 : -3), ly);
        ctx.shadowBlur = 0;
      }
    };

    draw();

    // Drag interaction
    const onDown = (e: MouseEvent) => {
      st.isDragging = true;
      st.lastX = e.clientX;
    };
    const onUp = () => { st.isDragging = false; };
    const onMove = (e: MouseEvent) => {
      if (!st.isDragging) return;
      st.rotY += (e.clientX - st.lastX) * (Math.PI / 500);
      st.lastX = e.clientX;
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legend
  const legendItems = [
    { hex: "#00f0ff", label: "HF Radyo" },
    { hex: "#ffaa00", label: "Elektrik Şebekesi" },
    { hex: "#39ff14", label: "GPS / Uydu" },
    { hex: "#cc44ff", label: "Uydu Operasyonu" },
    { hex: "#ff4444", label: "Havacılık" },
  ];

  return (
    <div className="relative w-full h-full bg-[#010913]">
      <canvas
        ref={canvasRef}
        width={900}
        height={560}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{ display: "block" }}
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1 bg-black/50 border border-white/10 rounded px-2 py-1.5 backdrop-blur-sm">
        {legendItems.map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.hex, boxShadow: `0 0 5px ${item.hex}` }} />
            <span className="font-mono text-[9px] text-white/60">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Kp badge */}
      <div className="absolute top-3 right-3 bg-black/50 border border-cyan-400/30 rounded px-2 py-1">
        <span className="font-display text-[9px] text-cyan-400/70 uppercase tracking-widest">Kp</span>
        <span className="font-mono text-sm text-cyan-300 ml-1.5">{(data?.kpIndex ?? 0).toFixed(1)}</span>
      </div>

      {/* Drag hint */}
      <div className="absolute top-3 left-3">
        <span className="font-mono text-[9px] text-white/25">↺ sürükle</span>
      </div>
    </div>
  );
}
