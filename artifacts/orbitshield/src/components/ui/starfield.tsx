import React, { useEffect, useRef } from "react";

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use the canvas's CSS layout dimensions as a fallback to avoid 0-size
    let W = window.innerWidth || canvas.clientWidth || document.documentElement.clientWidth || 1280;
    let H = window.innerHeight || canvas.clientHeight || document.documentElement.clientHeight || 720;
    canvas.width = W;
    canvas.height = H;

    let animId: number;
    let t = 0;

    // ── HORIZONTAL DRIFTING STARS ────────────────────────────────────
    // Stars glide smoothly from right to left at varying speeds/depths
    interface DriftStar {
      x: number; y: number;
      speed: number;       // horizontal drift speed (px/frame)
      size: number;
      opacity: number;
      hue: number;
      twinkle: number;
      twinkleOff: number;
      trail: number;       // trail length
    }
    const NUM_DRIFT = 320;
    const driftStars: DriftStar[] = [];

    function spawnDrift(startX?: number): DriftStar {
      const depth = Math.random();  // 0 = far, 1 = close
      return {
        x: startX ?? Math.random() * (W + 200),
        y: Math.random() * H,
        speed: 0.15 + depth * 1.1,
        size: 0.3 + depth * 1.8,
        opacity: 0.1 + depth * 0.75,
        hue: 180 + Math.random() * 100,
        twinkle: 0.4 + Math.random() * 1.2,
        twinkleOff: Math.random() * Math.PI * 2,
        trail: 2 + depth * 22,
      };
    }

    for (let i = 0; i < NUM_DRIFT; i++) driftStars.push(spawnDrift());

    // ── SPIRAL GALAXY STARS ─────────────────────────────────────────
    interface GalaxyStar {
      angle: number; dist: number; arm: number;
      speed: number; hue: number; size: number;
      twinkle: number; twinkleOff: number;
      opacity: number;
    }
    const NUM_GALAXY = 600;
    const galaxyStars: GalaxyStar[] = [];
    const NUM_ARMS = 5;
    for (let i = 0; i < NUM_GALAXY; i++) {
      const arm = Math.floor(Math.random() * NUM_ARMS);
      const t0 = Math.pow(Math.random(), 0.7);
      const dist = t0 * 0.44;
      const spread = 0.18 * (0.2 + t0);
      const baseAngle = (arm / NUM_ARMS) * Math.PI * 2 + t0 * 3.5;
      const jitter = (Math.random() - 0.5) * spread;
      galaxyStars.push({
        angle: baseAngle + jitter,
        dist,
        arm,
        speed: 0.00015 + Math.random() * 0.00025,
        hue: arm % 2 === 0 ? 190 + Math.random() * 50 : 270 + Math.random() * 50,
        size: 0.4 + Math.random() * 1.6,
        twinkle: 0.8 + Math.random() * 1.6,
        twinkleOff: Math.random() * Math.PI * 2,
        opacity: 0.25 + t0 * 0.65 * Math.random(),
      });
    }

    // ── METEORS ──────────────────────────────────────────────────────
    interface Meteor {
      x: number; y: number; vx: number; vy: number;
      len: number; opacity: number; life: number;
      maxLife: number; hue: number;
    }
    const meteors: Meteor[] = [];
    function spawnMeteor(): Meteor {
      const angle = -Math.PI * 0.18 - Math.random() * 0.28;
      const speed = 12 + Math.random() * 20;
      return {
        x: Math.random() * W,
        y: Math.random() * H * 0.45,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: 80 + Math.random() * 180,
        opacity: 0.6 + Math.random() * 0.4,
        life: 0,
        maxLife: 40 + Math.random() * 50,
        hue: 190 + Math.random() * 60,
      };
    }

    // ── NEBULA PARTICLES ─────────────────────────────────────────────
    interface NebulaParticle {
      x: number; y: number; vx: number; vy: number;
      r: number; hue: number; opacity: number; pulse: number;
    }
    const NUM_NEBULA = 180;
    const nebulaParticles: NebulaParticle[] = [];
    for (let i = 0; i < NUM_NEBULA; i++) {
      nebulaParticles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.08,
        r: 40 + Math.random() * 130,
        hue: [200, 240, 270, 180, 300][Math.floor(Math.random() * 5)],
        opacity: 0.012 + Math.random() * 0.025,
        pulse: 0.3 + Math.random() * 0.8,
      });
    }

    // ── PLASMA RINGS ──────────────────────────────────────────────────
    interface PlasmaRing {
      x: number; y: number; r: number; maxR: number;
      opacity: number; speed: number; hue: number;
    }
    const plasmaRings: PlasmaRing[] = [];
    function spawnRing(): PlasmaRing {
      return {
        x: W * (0.2 + Math.random() * 0.6),
        y: H * (0.2 + Math.random() * 0.6),
        r: 0,
        maxR: 80 + Math.random() * 200,
        opacity: 0.35 + Math.random() * 0.3,
        speed: 0.8 + Math.random() * 1.4,
        hue: [190, 260, 180, 300][Math.floor(Math.random() * 4)],
      };
    }
    for (let i = 0; i < 3; i++) {
      const ring = spawnRing();
      ring.r = Math.random() * ring.maxR;
      plasmaRings.push(ring);
    }

    // ── STATIC DEEP SPACE LAYER ───────────────────────────────────────
    const deepCanvas = document.createElement("canvas");
    deepCanvas.width = W; deepCanvas.height = H;
    const dctx = deepCanvas.getContext("2d")!;

    function buildDeepSpace() {
      deepCanvas.width = W; deepCanvas.height = H;
      dctx.fillStyle = "#000409";
      dctx.fillRect(0, 0, W, H);

      const clouds = [
        { x: W * 0.15, y: H * 0.25, r: W * 0.45, h: 230, s: 75, a: 0.055 },
        { x: W * 0.8,  y: H * 0.7,  r: W * 0.4,  h: 270, s: 70, a: 0.05  },
        { x: W * 0.5,  y: H * 0.55, r: W * 0.35, h: 300, s: 60, a: 0.04  },
        { x: W * 0.3,  y: H * 0.8,  r: W * 0.3,  h: 200, s: 65, a: 0.035 },
        { x: W * 0.85, y: H * 0.15, r: W * 0.32, h: 180, s: 70, a: 0.03  },
      ];
      for (const c of clouds) {
        const g = dctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        g.addColorStop(0, `hsla(${c.h},${c.s}%,40%,${c.a * 1.8})`);
        g.addColorStop(0.4, `hsla(${c.h},${c.s}%,25%,${c.a})`);
        g.addColorStop(1, `hsla(${c.h},${c.s}%,10%,0)`);
        dctx.fillStyle = g;
        dctx.fillRect(0, 0, W, H);
      }

      // Static distant background stars
      for (let i = 0; i < 500; i++) {
        const sx = Math.random() * W;
        const sy = Math.random() * H;
        const sr = Math.random() * 0.65;
        const sa = 0.08 + Math.random() * 0.28;
        const sh = 180 + Math.random() * 120;
        dctx.beginPath();
        dctx.arc(sx, sy, sr, 0, Math.PI * 2);
        dctx.fillStyle = `hsla(${sh},60%,90%,${sa})`;
        dctx.fill();
      }
    }
    buildDeepSpace();

    // ── MAIN DRAW LOOP ───────────────────────────────────────────────
    function draw() {
      t += 0.016;

      // Guard: skip frame if canvas has no valid dimensions yet
      if (W <= 0 || H <= 0 || deepCanvas.width <= 0 || deepCanvas.height <= 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      ctx!.clearRect(0, 0, W, H);
      ctx!.drawImage(deepCanvas, 0, 0);

      const cx = W / 2;
      const cy = H / 2;
      const galR = Math.min(W, H) * 0.44;

      // ── Animated nebula particles ──
      for (const p of nebulaParticles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -p.r) p.x = W + p.r;
        if (p.x > W + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = H + p.r;
        if (p.y > H + p.r) p.y = -p.r;
        const alpha = p.opacity * (0.7 + 0.3 * Math.sin(t * p.pulse));
        const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `hsla(${p.hue},75%,45%,${alpha})`);
        g.addColorStop(1, `hsla(${p.hue},75%,20%,0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      // ── Spinning galaxy ──
      const galRotation = t * 0.012;
      for (const s of galaxyStars) {
        s.angle += s.speed;
        const a = s.angle + galRotation;
        const sx = cx + Math.cos(a) * s.dist * galR;
        const sy = cy + Math.sin(a) * s.dist * galR * 0.45;
        const tw = 0.7 + 0.3 * Math.sin(t * s.twinkle + s.twinkleOff);
        const op = s.opacity * tw;
        const sz = s.size * (0.85 + 0.15 * tw);

        ctx!.beginPath();
        ctx!.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${s.hue},75%,88%,${op})`;
        ctx!.fill();

        if (op > 0.5 && sz > 1) {
          ctx!.shadowBlur = sz * 6;
          ctx!.shadowColor = `hsla(${s.hue},90%,75%,${op * 0.5})`;
          ctx!.fill();
          ctx!.shadowBlur = 0;
        }
      }

      // ── Galactic core ──
      const pulse = 0.82 + 0.18 * Math.sin(t * 0.9);
      const coreR = galR * 0.09 * pulse;
      const core1 = ctx!.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core1.addColorStop(0, `rgba(255,235,160,${0.9 * pulse})`);
      core1.addColorStop(0.3, `rgba(230,160,80,${0.55 * pulse})`);
      core1.addColorStop(0.7, `rgba(140,70,200,${0.2 * pulse})`);
      core1.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = core1;
      ctx!.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);

      const core2 = ctx!.createRadialGradient(cx, cy, 0, cx, cy, galR * 0.22 * pulse);
      core2.addColorStop(0, `rgba(255,200,100,${0.12 * pulse})`);
      core2.addColorStop(0.5, `rgba(180,80,220,${0.06 * pulse})`);
      core2.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = core2;
      ctx!.fillRect(cx - galR * 0.25, cy - galR * 0.25, galR * 0.5, galR * 0.5);

      // ── Plasma rings ──
      for (const ring of plasmaRings) {
        ring.r += ring.speed;
        const progress = ring.r / ring.maxR;
        const alpha = ring.opacity * (1 - progress) * (1 - progress);
        if (alpha > 0.005) {
          ctx!.beginPath();
          ctx!.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
          ctx!.strokeStyle = `hsla(${ring.hue},90%,70%,${alpha})`;
          ctx!.lineWidth = 1.5 * (1 - progress * 0.5);
          ctx!.shadowBlur = 12;
          ctx!.shadowColor = `hsla(${ring.hue},90%,70%,${alpha * 0.5})`;
          ctx!.stroke();
          ctx!.shadowBlur = 0;
        }
        if (ring.r >= ring.maxR) Object.assign(ring, spawnRing());
      }
      if (Math.random() < 0.008 && plasmaRings.length < 6) plasmaRings.push(spawnRing());

      // ── Horizontal drifting stars (right → left) ──────────────────
      for (const s of driftStars) {
        s.x -= s.speed;

        // Wrap around to the right when off-screen left
        if (s.x < -s.trail - 4) {
          s.x = W + s.trail + 4;
          s.y = Math.random() * H;
        }

        const tw = 0.75 + 0.25 * Math.sin(t * s.twinkle + s.twinkleOff);
        const op = s.opacity * tw;
        const sz = s.size * tw;

        // Trail
        if (s.trail > 3) {
          const grad = ctx!.createLinearGradient(s.x + s.trail, s.y, s.x, s.y);
          grad.addColorStop(0, `hsla(${s.hue},80%,90%,0)`);
          grad.addColorStop(1, `hsla(${s.hue},80%,90%,${op * 0.45})`);
          ctx!.beginPath();
          ctx!.moveTo(s.x + s.trail, s.y);
          ctx!.lineTo(s.x, s.y);
          ctx!.strokeStyle = grad;
          ctx!.lineWidth = sz * 0.55;
          ctx!.stroke();
        }

        // Star dot
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, sz * 0.8, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${s.hue},75%,92%,${op})`;
        ctx!.fill();

        if (op > 0.55 && sz > 1.2) {
          ctx!.shadowBlur = sz * 5;
          ctx!.shadowColor = `hsla(${s.hue},85%,80%,${op * 0.55})`;
          ctx!.fill();
          ctx!.shadowBlur = 0;
        }
      }

      // ── Meteors ──
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx; m.y += m.vy; m.life++;
        const progress = m.life / m.maxLife;
        const alpha = m.opacity * Math.sin(progress * Math.PI);
        const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
        const tx = m.x - (m.vx / spd) * m.len;
        const ty = m.y - (m.vy / spd) * m.len;
        const grad = ctx!.createLinearGradient(tx, ty, m.x, m.y);
        grad.addColorStop(0, `hsla(${m.hue},90%,95%,0)`);
        grad.addColorStop(0.6, `hsla(${m.hue},90%,90%,${alpha * 0.5})`);
        grad.addColorStop(1, `hsla(${m.hue},90%,100%,${alpha})`);
        ctx!.beginPath();
        ctx!.moveTo(tx, ty);
        ctx!.lineTo(m.x, m.y);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.5;
        ctx!.shadowBlur = 10;
        ctx!.shadowColor = `hsla(${m.hue},90%,80%,${alpha * 0.4})`;
        ctx!.stroke();
        ctx!.shadowBlur = 0;
        if (m.life >= m.maxLife || m.x > W + 200 || m.y > H + 200) meteors.splice(i, 1);
      }
      if (Math.random() < 0.025 && meteors.length < 6) meteors.push(spawnMeteor());

      // ── Aurora bands ──
      const auroraA = 0.04 + 0.02 * Math.sin(t * 0.4);
      const aurora1 = ctx!.createLinearGradient(0, 0, 0, H * 0.35);
      aurora1.addColorStop(0, `rgba(0,200,120,${auroraA})`);
      aurora1.addColorStop(0.4, `rgba(0,150,200,${auroraA * 0.7})`);
      aurora1.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = aurora1;
      ctx!.fillRect(0, 0, W, H * 0.35);

      const aurora2 = ctx!.createLinearGradient(0, H, 0, H * 0.7);
      aurora2.addColorStop(0, `rgba(100,0,200,${auroraA * 0.8})`);
      aurora2.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = aurora2;
      ctx!.fillRect(0, H * 0.7, W, H * 0.3);

      // ── Vignette ──
      const vig = ctx!.createRadialGradient(cx, cy, H * 0.2, cx, cy, Math.max(W, H) * 0.85);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,4,0.82)");
      ctx!.fillStyle = vig;
      ctx!.fillRect(0, 0, W, H);

      animId = requestAnimationFrame(draw);
    }

    draw();

    const onResize = () => {
      const newW = window.innerWidth || canvas.clientWidth || document.documentElement.clientWidth || W;
      const newH = window.innerHeight || canvas.clientHeight || document.documentElement.clientHeight || H;
      if (newW <= 0 || newH <= 0) return;
      W = newW;
      H = newH;
      canvas.width = W;
      canvas.height = H;
      buildDeepSpace();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
