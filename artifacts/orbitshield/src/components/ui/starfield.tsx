import React, { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
}

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const NUM_STARS = 280;
    const SPEED = 0.4;
    const WARP_LINES = 60;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const stars: Star[] = Array.from({ length: NUM_STARS }, () => ({
      x: Math.random() * w - w / 2,
      y: Math.random() * h - h / 2,
      z: Math.random() * w,
      px: 0,
      py: 0,
    }));

    // Nebula blobs (static, painted once to offscreen)
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const octx = offscreen.getContext("2d")!;

    const nebulaColors = [
      "rgba(0,100,180,0.04)",
      "rgba(0,60,140,0.05)",
      "rgba(20,0,80,0.06)",
      "rgba(0,180,140,0.03)",
      "rgba(100,0,160,0.04)",
    ];
    for (let i = 0; i < 5; i++) {
      const gx = Math.random() * w;
      const gy = Math.random() * h;
      const gr = Math.max(w, h) * (0.3 + Math.random() * 0.4);
      const radial = octx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      radial.addColorStop(0, nebulaColors[i]);
      radial.addColorStop(1, "rgba(0,0,0,0)");
      octx.fillStyle = radial;
      octx.fillRect(0, 0, w, h);
    }

    let animId: number;

    function draw() {
      ctx!.clearRect(0, 0, w, h);

      // deep black background
      ctx!.fillStyle = "#03080f";
      ctx!.fillRect(0, 0, w, h);

      // nebula layer
      ctx!.drawImage(offscreen, 0, 0);

      ctx!.save();
      ctx!.translate(w / 2, h / 2);

      for (const star of stars) {
        star.px = star.x / star.z;
        star.py = star.y / star.z;

        star.z -= SPEED;

        if (star.z <= 0) {
          star.x = Math.random() * w - w / 2;
          star.y = Math.random() * h - h / 2;
          star.z = w;
          star.px = star.x / star.z;
          star.py = star.y / star.z;
        }

        const sx = star.x / star.z;
        const sy = star.y / star.z;
        const size = Math.max(0.3, (1 - star.z / w) * 2.5);
        const brightness = Math.min(1, (1 - star.z / w) * 1.4);

        // draw trail line
        const prevX = star.px;
        const prevY = star.py;
        const dist = Math.sqrt((sx - prevX) ** 2 + (sy - prevY) ** 2);

        if (dist > 0.3) {
          ctx!.beginPath();
          ctx!.moveTo(prevX, prevY);
          ctx!.lineTo(sx, sy);
          ctx!.strokeStyle = `rgba(160,220,255,${brightness * 0.5})`;
          ctx!.lineWidth = size * 0.6;
          ctx!.stroke();
        }

        // draw star dot
        ctx!.beginPath();
        ctx!.arc(sx, sy, size, 0, Math.PI * 2);

        // Colorize: some stars are warm, some cool
        const hue = star.x > 0 ? 200 : 220;
        ctx!.fillStyle = `hsla(${hue},80%,${70 + brightness * 30}%,${brightness})`;
        ctx!.fill();

        // Glow for bright stars
        if (brightness > 0.7) {
          ctx!.shadowBlur = 6;
          ctx!.shadowColor = `rgba(100,200,255,${brightness * 0.4})`;
          ctx!.fill();
          ctx!.shadowBlur = 0;
        }
      }

      ctx!.restore();

      // Subtle scanline overlay
      ctx!.fillStyle = "rgba(0,0,0,0.015)";
      for (let y = 0; y < h; y += 4) {
        ctx!.fillRect(0, y, w, 1);
      }

      // Vignette
      const vignette = ctx!.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.65)");
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
