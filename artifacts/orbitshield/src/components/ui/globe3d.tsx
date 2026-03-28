import React, { useRef, useEffect } from "react";
import type { SpaceWeatherData, AIPrediction, InfrastructureRisk } from "@workspace/api-client-react/src/generated/api.schemas";

interface Globe3DProps {
  data?: SpaceWeatherData;
  pred?: AIPrediction;
  risk?: InfrastructureRisk;
}

const IMPACT_ZONES = [
  { lat: 64,  lon: -20,  label: "İzlanda",      system: "hfRadio",     hex: "#00f0ff" },
  { lat: 70,  lon: 25,   label: "Norveç",        system: "hfRadio",     hex: "#00f0ff" },
  { lat: 65,  lon: -148, label: "Alaska",        system: "powerGrid",   hex: "#ffaa00" },
  { lat: 60,  lon: -95,  label: "Kanada",        system: "powerGrid",   hex: "#ffaa00" },
  { lat: 55,  lon: 37,   label: "Moskova",       system: "gpsGnss",     hex: "#39ff14" },
  { lat: 52,  lon: 5,    label: "Batı Avrupa",   system: "gpsGnss",     hex: "#39ff14" },
  { lat: 35,  lon: 139,  label: "Tokyo",         system: "satelliteOps",hex: "#cc44ff" },
  { lat: 40,  lon: -74,  label: "New York",      system: "aviation",    hex: "#ff4444" },
  { lat: -75, lon: 0,    label: "Antarktika",    system: "hfRadio",     hex: "#00f0ff" },
  { lat: -55, lon: -68,  label: "G.Amerika",     system: "gpsGnss",     hex: "#39ff14" },
];

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
   [10,105],[5,103],[1,104],[5,100],[10,105],[15,100],
   [20,93],[22,92],[22,88],[20,85],[14,80],[8,78],
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

// Orthographic projection
function ortho(lat: number, lon: number, rotY: number, cx: number, cy: number, R: number) {
  const φ = (lat  * Math.PI) / 180;
  const λ = ((lon - rotY * 180 / Math.PI) * Math.PI) / 180;
  return {
    x: cx + R * Math.cos(φ) * Math.sin(λ),
    y: cy - R * Math.sin(φ),
    z: Math.cos(φ) * Math.cos(λ),
  };
}

function hexToRgb(hex: string) {
  return {
    r: parseInt(hex.slice(1,3),16),
    g: parseInt(hex.slice(3,5),16),
    b: parseInt(hex.slice(5,7),16),
  };
}

export function Globe3D({ data, risk }: Globe3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef({ rotY: 0.35, isDragging: false, lastX: 0 });

  const kp    = data?.kpIndex ?? 2;
  const speed = data?.solarWind?.speed ?? 400;

  const getRisk = (system: string): number => {
    if (!risk) return 5;
    const v = (risk as Record<string,unknown>)[system];
    return typeof v === "number" ? v : 5;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Fixed internal resolution — CSS stretches it to fill container
    canvas.width  = 960;
    canvas.height = 580;

    // Solar wind particles
    const NPART = 280;
    const parts: { x: number; y: number; vx: number; vy: number; a: number }[] = [];
    const newPart = (W: number, H: number) => ({
      x: -W * 0.05 - Math.random() * W * 0.55,
      y: (Math.random() - 0.5) * H * 1.2,
      vx: (1.8 + Math.random() * 2.2) * (speed / 400),
      vy: (Math.random() - 0.5) * 0.5,
      a:  0.15 + Math.random() * 0.45,
    });
    for (let i = 0; i < NPART; i++)
      parts.push({ ...newPart(900, 560), x: (Math.random() - 0.5) * 1400 });

    let raf = 0, t = 0;
    const st = stateRef.current;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.016;
      if (!st.isDragging) st.rotY += 0.004;

      const W = canvas.width;   // 960
      const H = canvas.height;  // 580
      const cx  = W / 2;
      const cy  = H / 2;
      const R   = Math.min(W, H) * 0.42;

      ctx.clearRect(0, 0, W, H);

      // ── Background ──────────────────────────────────────────────────────────
      ctx.fillStyle = "#010913";
      ctx.fillRect(0, 0, W, H);

      // Stars (deterministic positions)
      for (let i = 0; i < 140; i++) {
        const sx = (i * 137.5 + 23) % W;
        const sy = (i * 97.3  + 11) % H;
        const ss = i % 4 === 0 ? 1.2 : 0.6;
        ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.12})`;
        ctx.beginPath(); ctx.arc(sx, sy, ss, 0, Math.PI*2); ctx.fill();
      }

      // Solar wind particles
      const wc = kp < 4 ? "0,160,255" : kp < 7 ? "255,150,0" : "255,50,0";
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x > W * 0.65) Object.assign(p, newPart(W, H));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 6, p.y - p.vy * 6);
        ctx.strokeStyle = `rgba(${wc},${p.a * 0.45})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Atmosphere glow ─────────────────────────────────────────────────────
      const kpN = Math.min(kp / 9, 1);
      const aR = Math.round(kpN > 0.5 ? 160 + kpN*100 : 0);
      const aG = Math.round(kpN > 0.7 ? 20 : 120 * (1 - kpN));
      const aB = Math.round(220 * (1 - kpN * 0.65));
      const ag = ctx.createRadialGradient(cx, cy, R*0.88, cx, cy, R*1.28);
      ag.addColorStop(0,   `rgba(${aR},${aG},${aB},0.40)`);
      ag.addColorStop(0.45,`rgba(${aR},${aG},${aB},0.14)`);
      ag.addColorStop(1,   `rgba(0,0,0,0)`);
      ctx.beginPath(); ctx.arc(cx, cy, R*1.28, 0, Math.PI*2);
      ctx.fillStyle = ag; ctx.fill();

      // ── Ocean sphere ────────────────────────────────────────────────────────
      const og = ctx.createRadialGradient(cx - R*0.28, cy - R*0.28, R*0.04, cx, cy, R);
      og.addColorStop(0,   "#0d3055");
      og.addColorStop(0.45,"#061a35");
      og.addColorStop(1,   "#020d1f");
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
      ctx.fillStyle = og; ctx.fill();

      // ── CLIP TO GLOBE CIRCLE for all content ────────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R - 0.5, 0, Math.PI*2); ctx.clip();

      // Grid lines
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(0,100,180,0.22)";
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath(); let mv = true;
        for (let la = -90; la <= 90; la += 4) {
          const p = ortho(la, lon, st.rotY, cx, cy, R);
          if (p.z < 0) { mv = true; continue; }
          mv ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); mv = false;
        }
        ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath(); let mv = true;
        for (let lo = -180; lo <= 180; lo += 4) {
          const p = ortho(lat, lo, st.rotY, cx, cy, R);
          if (p.z < 0) { mv = true; continue; }
          mv ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); mv = false;
        }
        ctx.stroke();
      }

      // ── CONTINENTS ──────────────────────────────────────────────────────────
      for (const poly of LAND_POLYGONS) {
        // Split into visible segments (z > threshold)
        const segments: {x: number; y: number}[][] = [];
        let cur: {x: number; y: number}[] = [];

        for (const [la, lo] of poly) {
          const p = ortho(la, lo, st.rotY, cx, cy, R);
          if (p.z > 0.02) {
            cur.push({ x: p.x, y: p.y });
          } else {
            if (cur.length >= 2) segments.push(cur);
            cur = [];
          }
        }
        if (cur.length >= 2) segments.push(cur);

        // Draw fill only if the whole polygon is mostly visible
        const total = poly.length;
        const visible = poly.filter(([la, lo]) => ortho(la, lo, st.rotY, cx, cy, R).z > 0.02).length;
        if (visible / total > 0.55) {
          // Fill pass — use all visible points as one shape
          ctx.beginPath();
          let mv2 = true;
          for (const [la, lo] of poly) {
            const p = ortho(la, lo, st.rotY, cx, cy, R);
            if (p.z < 0.02) { mv2 = true; continue; }
            mv2 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
            mv2 = false;
          }
          ctx.closePath();
          ctx.fillStyle = "#1c5c2e";
          ctx.fill();
        }

        // Outline pass — draw each visible segment
        ctx.strokeStyle = "#00e870";
        ctx.lineWidth   = 1.6;
        for (const seg of segments) {
          if (seg.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(seg[0].x, seg[0].y);
          for (const pt of seg.slice(1)) ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }
      }

      // ── Aurora rings ────────────────────────────────────────────────────────
      const auroraOp  = Math.min(kp / 5.5, 1) * 0.9;
      const auroraCol = kp < 4 ? "0,255,140" : kp < 7 ? "255,160,0" : "255,40,0";
      for (const [aLat, sign] of [[67,1],[71,1],[67,-1],[71,-1]] as [number,number][]) {
        ctx.beginPath(); let mv = true;
        for (let lo = -180; lo <= 180; lo += 2) {
          const p = ortho(sign * aLat, lo, st.rotY, cx, cy, R * 1.005);
          if (p.z < 0) { mv = true; continue; }
          mv ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); mv = false;
        }
        ctx.strokeStyle = `rgba(${auroraCol},${auroraOp})`;
        ctx.lineWidth   = 2;
        ctx.stroke();
      }

      // ── Limb darkening (terminator shadow) ─────────────────────────────────
      const ld = ctx.createRadialGradient(cx, cy, R*0.55, cx, cy, R);
      ld.addColorStop(0, "rgba(0,0,0,0)");
      ld.addColorStop(0.8, "rgba(0,0,0,0)");
      ld.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
      ctx.fillStyle = ld; ctx.fill();

      ctx.restore(); // end globe clip

      // ── Globe edge ring ─────────────────────────────────────────────────────
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(0,200,255,0.35)";
      ctx.lineWidth   = 1.8; ctx.stroke();

      // Specular highlight
      const hl = ctx.createRadialGradient(cx - R*0.35, cy - R*0.32, 0, cx - R*0.35, cy - R*0.32, R*0.55);
      hl.addColorStop(0,   "rgba(200,240,255,0.10)");
      hl.addColorStop(0.5, "rgba(100,180,220,0.04)");
      hl.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
      ctx.fillStyle = hl; ctx.fill();

      // ── Impact zone markers (outside clip so spikes poke out) ───────────────
      for (const zone of IMPACT_ZONES) {
        const p = ortho(zone.lat, zone.lon, st.rotY, cx, cy, R);
        if (p.z < 0.08) continue;
        const fade    = Math.min(1, (p.z - 0.08) / 0.25);
        const rPct    = getRisk(zone.system) / 100;
        const { r, g, b } = hexToRgb(zone.hex);
        const col     = `${r},${g},${b}`;
        const pulse   = 1 + Math.sin(t * 3 + zone.lat * 0.1) * 0.22;
        const ringRad = R * (0.038 + rPct * 0.032) * pulse;

        // Glow
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, ringRad * 1.2);
        grd.addColorStop(0,   `rgba(${col},${0.9 * fade})`);
        grd.addColorStop(0.35,`rgba(${col},${0.5 * fade})`);
        grd.addColorStop(1,   `rgba(${col},0)`);
        ctx.beginPath(); ctx.arc(p.x, p.y, ringRad * 1.2, 0, Math.PI*2);
        ctx.fillStyle = grd; ctx.fill();

        // Outer ring
        ctx.beginPath(); ctx.arc(p.x, p.y, ringRad, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(${col},${0.8 * fade})`;
        ctx.lineWidth = 1.5; ctx.stroke();

        // Spike toward camera (normal direction)
        const nx = p.x - cx, ny = p.y - cy;
        const nd = Math.sqrt(nx*nx + ny*ny) || 1;
        const sl = R * (0.05 + rPct * 0.05);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (nx/nd)*sl, p.y + (ny/nd)*sl);
        ctx.strokeStyle = `rgba(${col},${0.55 * fade})`;
        ctx.lineWidth = 1; ctx.stroke();

        // Label
        const lx = p.x + (nx/nd) * (sl + 6);
        const ly = p.y + (ny/nd) * (sl + 6);
        ctx.font          = "bold 10px 'Courier New',monospace";
        ctx.textAlign     = lx >= cx ? "left" : "right";
        ctx.textBaseline  = "middle";
        ctx.shadowColor   = `rgba(${col},0.9)`;
        ctx.shadowBlur    = 7;
        ctx.fillStyle     = `rgba(255,255,255,${Math.min(0.95, fade * 1.4)})`;
        ctx.fillText(zone.label, lx + (lx >= cx ? 4 : -4), ly);
        ctx.shadowBlur = 0;
      }
    };

    draw();

    const onDown = (e: MouseEvent) => { st.isDragging = true; st.lastX = e.clientX; };
    const onUp   = () => { st.isDragging = false; };
    const onMove = (e: MouseEvent) => {
      if (!st.isDragging) return;
      st.rotY += (e.clientX - st.lastX) * (Math.PI / 480);
      st.lastX = e.clientX;
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("mousemove", onMove);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("mousemove", onMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        style={{ display: "block", width: "100%", height: "100%" }}
        className="cursor-grab active:cursor-grabbing"
      />

      <div className="absolute bottom-3 left-3 flex flex-col gap-1 bg-black/50 border border-white/10 rounded px-2 py-1.5 backdrop-blur-sm">
        {legendItems.map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.hex, boxShadow: `0 0 5px ${item.hex}` }} />
            <span className="font-mono text-[9px] text-white/60">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="absolute top-3 right-3 bg-black/50 border border-cyan-400/30 rounded px-2 py-1">
        <span className="font-display text-[9px] text-cyan-400/70 uppercase tracking-widest">Kp</span>
        <span className="font-mono text-sm text-cyan-300 ml-1.5">{(data?.kpIndex ?? 0).toFixed(1)}</span>
      </div>
      <div className="absolute top-3 left-3">
        <span className="font-mono text-[9px] text-white/30">↺ sürükle</span>
      </div>
    </div>
  );
}
