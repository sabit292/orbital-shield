import React, { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  hue: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  arm: number;
}

interface DustParticle {
  x: number;
  y: number;
  r: number;
  opacity: number;
  hue: number;
  saturation: number;
}

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    // Galaxy parameters
    const NUM_ARMS = 4;
    const STARS_PER_ARM = 180;
    const DUST_PER_ARM = 80;
    const CENTER_STARS = 120;
    const BACKGROUND_STARS = 350;

    // Generate galaxy stars
    function generateGalaxy(W: number, H: number) {
      const cx = W / 2;
      const cy = H / 2;
      const maxR = Math.min(W, H) * 0.42;
      const stars: Star[] = [];
      const dust: DustParticle[] = [];

      // Background field stars
      for (let i = 0; i < BACKGROUND_STARS; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 0.8 + 0.2,
          opacity: Math.random() * 0.4 + 0.05,
          hue: 200 + Math.random() * 60,
          twinkleSpeed: 0.5 + Math.random() * 1.5,
          twinkleOffset: Math.random() * Math.PI * 2,
          arm: -1,
        });
      }

      // Central bulge stars
      for (let i = 0; i < CENTER_STARS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 1.5) * maxR * 0.18;
        const jitter = (Math.random() - 0.5) * maxR * 0.05;
        stars.push({
          x: cx + Math.cos(angle) * dist + jitter,
          y: cy + Math.sin(angle) * dist * 0.5 + jitter * 0.5,
          r: Math.random() * 1.8 + 0.5,
          opacity: 0.5 + Math.random() * 0.5,
          hue: 30 + Math.random() * 40,
          twinkleSpeed: 0.3 + Math.random() * 0.8,
          twinkleOffset: Math.random() * Math.PI * 2,
          arm: -1,
        });
      }

      // Spiral arm stars
      for (let arm = 0; arm < NUM_ARMS; arm++) {
        const armOffset = (arm / NUM_ARMS) * Math.PI * 2;
        for (let i = 0; i < STARS_PER_ARM; i++) {
          const t = i / STARS_PER_ARM;
          const dist = t * maxR;
          const angle = armOffset + t * 3.2 + (Math.random() - 0.5) * 0.5;
          const spreadFactor = maxR * 0.06 * (0.3 + t * 0.7);
          const jx = (Math.random() - 0.5) * spreadFactor * 2;
          const jy = (Math.random() - 0.5) * spreadFactor;

          const hue = arm % 2 === 0
            ? 190 + Math.random() * 40   // cool blue-cyan arms
            : 260 + Math.random() * 40;  // purple-violet arms

          stars.push({
            x: cx + Math.cos(angle) * dist + jx,
            y: cy + Math.sin(angle) * dist * 0.55 + jy,
            r: Math.random() * 1.4 + 0.3,
            opacity: 0.3 + t * 0.6 * Math.random(),
            hue,
            twinkleSpeed: 0.4 + Math.random() * 1.2,
            twinkleOffset: Math.random() * Math.PI * 2,
            arm,
          });

          // Dust clouds along arms
          if (i % 2 === 0) {
            const dustHue = arm % 2 === 0 ? 200 : 270;
            dust.push({
              x: cx + Math.cos(angle) * dist + (Math.random() - 0.5) * spreadFactor * 3,
              y: cy + Math.sin(angle) * dist * 0.55 + (Math.random() - 0.5) * spreadFactor * 1.5,
              r: maxR * (0.04 + Math.random() * 0.07),
              opacity: 0.015 + Math.random() * 0.04,
              hue: dustHue,
              saturation: 60 + Math.random() * 30,
            });
          }
        }
      }

      return { stars, dust, cx, cy, maxR };
    }

    let galaxy = generateGalaxy(w, h);
    let animId: number;
    let t = 0;

    // Paint static nebula/dust layer to offscreen canvas
    function buildNebulaLayer(W: number, H: number, cx: number, cy: number, maxR: number, dust: DustParticle[]) {
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const octx = off.getContext("2d")!;

      // Deep space base gradient
      const bg = octx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, maxR * 1.6);
      bg.addColorStop(0, "rgba(18, 4, 35, 1)");
      bg.addColorStop(0.3, "rgba(5, 2, 20, 1)");
      bg.addColorStop(1, "rgba(1, 3, 10, 1)");
      octx.fillStyle = bg;
      octx.fillRect(0, 0, W, H);

      // Large nebula clouds
      const nebulae = [
        { x: cx * 0.7, y: cy * 0.6, r: maxR * 0.9, h: 240, s: 70, a: 0.055 },
        { x: cx * 1.3, y: cy * 1.3, r: maxR * 0.7, h: 280, s: 60, a: 0.04 },
        { x: cx * 0.5, y: cy * 1.2, r: maxR * 0.5, h: 180, s: 55, a: 0.035 },
        { x: cx * 1.5, y: cy * 0.7, r: maxR * 0.6, h: 200, s: 65, a: 0.03 },
        { x: cx, y: cy, r: maxR * 0.5, h: 220, s: 50, a: 0.05 },
      ];

      for (const n of nebulae) {
        const grad = octx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        grad.addColorStop(0, `hsla(${n.h},${n.s}%,35%,${n.a * 1.5})`);
        grad.addColorStop(0.5, `hsla(${n.h},${n.s}%,25%,${n.a})`);
        grad.addColorStop(1, `hsla(${n.h},${n.s}%,10%,0)`);
        octx.fillStyle = grad;
        octx.fillRect(0, 0, W, H);
      }

      // Dust particles
      for (const d of dust) {
        const grad = octx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        grad.addColorStop(0, `hsla(${d.hue},${d.saturation}%,55%,${d.opacity})`);
        grad.addColorStop(1, `hsla(${d.hue},${d.saturation}%,30%,0)`);
        octx.fillStyle = grad;
        octx.fillRect(0, 0, W, H);
      }

      // Galactic core glow
      const coreGlow = octx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.25);
      coreGlow.addColorStop(0, "rgba(255, 220, 140, 0.22)");
      coreGlow.addColorStop(0.2, "rgba(220, 140, 80, 0.12)");
      coreGlow.addColorStop(0.5, "rgba(120, 60, 180, 0.07)");
      coreGlow.addColorStop(1, "rgba(0,0,0,0)");
      octx.fillStyle = coreGlow;
      octx.fillRect(0, 0, W, H);

      return off;
    }

    let nebulaLayer = buildNebulaLayer(w, h, galaxy.cx, galaxy.cy, galaxy.maxR, galaxy.dust);

    function draw() {
      t += 0.016;

      ctx!.clearRect(0, 0, w, h);
      ctx!.drawImage(nebulaLayer, 0, 0);

      const { stars, cx, cy, maxR } = galaxy;

      for (const star of stars) {
        const twinkle = 0.7 + 0.3 * Math.sin(t * star.twinkleSpeed + star.twinkleOffset);
        const opacity = star.opacity * twinkle;
        const size = star.r * (0.85 + 0.15 * twinkle);

        ctx!.beginPath();
        ctx!.arc(star.x, star.y, size, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${star.hue},70%,90%,${opacity})`;
        ctx!.fill();

        // Bright star glow
        if (opacity > 0.55 && size > 0.9) {
          ctx!.shadowBlur = size * 5;
          ctx!.shadowColor = `hsla(${star.hue},80%,80%,${opacity * 0.6})`;
          ctx!.fill();
          ctx!.shadowBlur = 0;
        }
      }

      // Animated core pulse
      const pulse = 0.85 + 0.15 * Math.sin(t * 0.6);
      const coreAnim = ctx!.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.06 * pulse);
      coreAnim.addColorStop(0, `rgba(255,230,170,${0.55 * pulse})`);
      coreAnim.addColorStop(0.4, `rgba(220,150,80,${0.2 * pulse})`);
      coreAnim.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = coreAnim;
      ctx!.fillRect(cx - maxR * 0.08, cy - maxR * 0.08, maxR * 0.16, maxR * 0.16);

      // Vignette
      const vignette = ctx!.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, Math.max(w, h) * 0.8);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.75)");
      ctx!.fillStyle = vignette;
      ctx!.fillRect(0, 0, w, h);

      animId = requestAnimationFrame(draw);
    }

    draw();

    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      galaxy = generateGalaxy(w, h);
      nebulaLayer = buildNebulaLayer(w, h, galaxy.cx, galaxy.cy, galaxy.maxR, galaxy.dust);
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
