import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import type { SpaceWeatherData, AIPrediction, InfrastructureRisk } from "@workspace/api-client-react/src/generated/api.schemas";

interface Globe3DProps {
  data?: SpaceWeatherData;
  pred?: AIPrediction;
  risk?: InfrastructureRisk;
}

const IMPACT_ZONES = [
  { lat: 64,  lon: -20,  label: "İzlanda",       system: "hfRadio",     color: 0x00f0ff },
  { lat: 70,  lon: 25,   label: "Norveç",         system: "hfRadio",     color: 0x00f0ff },
  { lat: 65,  lon: -148, label: "Alaska",         system: "powerGrid",   color: 0xffaa00 },
  { lat: 60,  lon: -95,  label: "Kanada",         system: "powerGrid",   color: 0xffaa00 },
  { lat: 55,  lon: 37,   label: "Moskova",        system: "gpsGnss",     color: 0x39ff14 },
  { lat: 52,  lon: 5,    label: "Batı Avrupa",    system: "gpsGnss",     color: 0x39ff14 },
  { lat: 35,  lon: 139,  label: "Tokyo",          system: "satelliteOps",color: 0xcc44ff },
  { lat: 40,  lon: -74,  label: "New York",       system: "aviation",    color: 0xff4444 },
  { lat: -75, lon: 0,    label: "Antarktika",     system: "hfRadio",     color: 0x00f0ff },
  { lat: -55, lon: -68,  label: "Güney Amerika",  system: "gpsGnss",     color: 0x39ff14 },
];

function latLonToXYZ(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat)  * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

// ── Simplified continent outlines [lat, lon] ─────────────────────────────────
const LAND_POLYGONS: [number, number][][] = [
  // North America
  [
    [71,-153],[72,-131],[75,-88],[72,-76],[63,-64],[45,-53],[45,-60],
    [35,-75],[25,-80],[22,-90],[16,-88],[16,-92],[20,-103],[22,-110],
    [32,-117],[38,-123],[48,-124],[55,-133],[60,-145],[65,-168],[71,-153],
  ],
  // Greenland
  [
    [83,-25],[82,-15],[80,-18],[76,-19],[72,-24],[70,-24],
    [70,-35],[72,-40],[76,-42],[80,-40],[83,-35],[83,-25],
  ],
  // South America
  [
    [12,-72],[10,-62],[8,-60],[5,-52],[0,-50],[-5,-35],[-10,-37],
    [-15,-40],[-23,-43],[-28,-49],[-34,-54],[-42,-63],[-54,-67],
    [-56,-68],[-53,-74],[-42,-73],[-35,-57],[-25,-44],[-10,-37],
    [0,-48],[5,-52],[8,-60],[12,-72],
  ],
  // Europe (main body)
  [
    [36,-8],[36,2],[43,3],[48,2],[51,2],[52,4],[55,8],
    [58,5],[65,14],[70,20],[70,28],[65,25],[60,25],[57,22],
    [55,18],[50,18],[48,18],[46,28],[44,28],[42,28],[40,18],
    [38,14],[37,15],[36,10],[36,-8],
  ],
  // Scandinavia
  [
    [56,8],[58,5],[63,5],[65,14],[68,18],[70,20],[72,26],
    [70,28],[68,28],[65,25],[60,25],[57,22],[56,8],
  ],
  // Africa
  [
    [37,10],[37,12],[33,15],[28,33],[22,37],[12,44],[12,43],
    [5,35],[0,42],[-5,40],[-10,38],[-22,35],[-34,26],[-34,18],
    [-29,16],[-22,14],[-17,12],[-5,10],[0,8],[5,2],[5,-5],
    [10,-15],[15,-17],[20,-17],[22,-14],[28,-10],[33,-5],[37,10],
  ],
  // Asia (main body)
  [
    [70,28],[72,50],[73,80],[73,120],[70,130],[60,140],[55,135],
    [50,140],[48,135],[40,127],[35,122],[25,120],[22,114],[20,110],
    [10,105],[5,100],[5,103],[1,104],[5,100],[10,105],[15,100],
    [20,93],[22,92],[22,88],[20,85],[14,80],[8,78],[8,77],
    [20,70],[22,60],[25,57],[22,55],[15,45],[12,44],[22,37],
    [28,33],[33,35],[37,36],[40,36],[38,26],[41,29],[45,30],
    [50,30],[55,38],[60,50],[65,60],[68,70],[70,80],[70,28],
  ],
  // Arabian Peninsula
  [
    [22,55],[24,58],[22,60],[18,57],[12,44],[15,42],[22,55],
  ],
  // Indian Subcontinent bump
  [
    [22,68],[22,88],[8,78],[8,77],[20,68],[22,68],
  ],
  // Southeast Asia peninsula
  [
    [22,100],[18,100],[10,99],[5,103],[1,104],[3,106],
    [10,105],[16,103],[20,106],[22,105],[22,100],
  ],
  // Australia
  [
    [-16,130],[-16,136],[-18,140],[-22,150],[-28,154],[-38,146],
    [-38,140],[-34,136],[-32,128],[-28,122],[-22,114],[-20,118],[-16,130],
  ],
  // Japan (Honshu)
  [
    [41,140],[38,141],[35,136],[33,130],[34,131],[36,136],[38,141],[41,140],
  ],
  // UK
  [
    [50,-5],[52,-4],[58,-3],[60,-3],[58,0],[55,2],[52,2],[50,0],[50,-5],
  ],
];

// ── Build canvas texture with continent fills + outlines ──────────────────────
function buildEarthTexture(): THREE.CanvasTexture {
  const W = 2048, H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const toXY = (lat: number, lon: number): [number, number] => [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];

  // Ocean
  ctx.fillStyle = "#020d1f";
  ctx.fillRect(0, 0, W, H);

  // Subtle lat/lon grid
  ctx.strokeStyle = "rgba(0,80,140,0.25)";
  ctx.lineWidth = 0.7;
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = toXY(0, lon);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const [, y] = toXY(lat, 0);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Draw each continent
  for (const poly of LAND_POLYGONS) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    const [sx, sy] = toXY(poly[0][0], poly[0][1]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < poly.length; i++) {
      const [x, y] = toXY(poly[i][0], poly[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Fill — dark muted green
    ctx.fillStyle = "#132b18";
    ctx.fill();
    // Border — bright cyan-green
    ctx.strokeStyle = "#00cc70";
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  // Polar ice
  const iceGrad = ctx.createLinearGradient(0, 0, 0, H * 0.08);
  iceGrad.addColorStop(0, "rgba(180,210,230,0.45)");
  iceGrad.addColorStop(1, "rgba(180,210,230,0)");
  ctx.fillStyle = iceGrad;
  ctx.fillRect(0, 0, W, H * 0.08);

  const iceGrad2 = ctx.createLinearGradient(0, H * 0.92, 0, H);
  iceGrad2.addColorStop(0, "rgba(160,200,220,0)");
  iceGrad2.addColorStop(1, "rgba(160,200,220,0.55)");
  ctx.fillStyle = iceGrad2;
  ctx.fillRect(0, H * 0.92, W, H * 0.08);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ── Atmosphere shaders (glow + aurora band) ───────────────────────────────────
const atmoVert = /* glsl */`
  varying vec3 vNormal;
  void main(){
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;
const atmoFrag = /* glsl */`
  uniform float uKp;
  varying vec3 vNormal;
  void main(){
    float rim = pow(0.62 - dot(vNormal, vec3(0,0,1)), 2.5);
    vec3 baseAtmo = mix(vec3(0.0, 0.45, 1.0), vec3(0.0, 0.8, 0.3), 0.3);
    vec3 stormCol = mix(baseAtmo, vec3(1.0, 0.12, 0.0), smoothstep(4.0, 8.0, uKp));
    gl_FragColor = vec4(stormCol, rim * 0.65);
  }
`;

// ── Create glowing circle texture for markers ─────────────────────────────────
function makeMarkerTexture(hex: number): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const col = `${r},${g},${b}`;

  // Outer glow
  const grd = ctx.createRadialGradient(S/2, S/2, S*0.05, S/2, S/2, S*0.5);
  grd.addColorStop(0,   `rgba(${col},1.0)`);
  grd.addColorStop(0.3, `rgba(${col},0.6)`);
  grd.addColorStop(0.6, `rgba(${col},0.15)`);
  grd.addColorStop(1,   `rgba(${col},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, S, S);

  // Inner bright core
  ctx.beginPath();
  ctx.arc(S/2, S/2, S*0.08, 0, Math.PI*2);
  ctx.fillStyle = `rgb(${col})`;
  ctx.fill();

  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

// ── Create text label sprite texture ─────────────────────────────────────────
function makeTextSprite(label: string, hex: number): THREE.CanvasTexture {
  const PX = 22;
  const padding = 10;
  const tmpC = document.createElement("canvas");
  tmpC.width = 2; tmpC.height = 2;
  const tmpCtx = tmpC.getContext("2d")!;
  tmpCtx.font = `bold ${PX}px monospace`;
  const textW = tmpCtx.measureText(label).width;

  const W = Math.ceil(textW + padding * 2);
  const H = PX + padding * 2;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;

  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const col = `${r},${g},${b}`;

  // Pill background
  ctx.fillStyle = `rgba(0,0,0,0.72)`;
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
    ctx.beginPath();
    (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
      .roundRect(0, 0, W, H, 6);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, W, H);
  }

  // Border glow
  ctx.strokeStyle = `rgba(${col},0.85)`;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Text
  ctx.font = `bold ${PX}px monospace`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgb(${col})`;
  ctx.shadowColor = `rgb(${col})`;
  ctx.shadowBlur = 8;
  ctx.fillText(label, padding, H / 2);

  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

// ── Error boundary ────────────────────────────────────────────────────────────
class GlobeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 bg-[#020b16]">
          <div className="text-4xl mb-4">🌍</div>
          <div className="font-display text-sm text-primary/70 uppercase tracking-widest mb-2">3D Görüntüleme</div>
          <div className="font-mono text-xs text-muted-foreground">WebGL bu ortamda desteklenmiyor.</div>
          <div className="font-mono text-xs text-muted-foreground">Gerçek tarayıcınızda çalışacaktır.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Globe3D(props: Globe3DProps) {
  return (
    <GlobeErrorBoundary>
      <Globe3DInner {...props} />
    </GlobeErrorBoundary>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function Globe3DInner({ data, risk }: Globe3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  const kp    = data?.kpIndex ?? 2;
  const speed = data?.solarWind?.speed ?? 400;
  const riskData = risk;

  const getRiskVal = (system: string): number => {
    if (!riskData) return 5;
    const v = (riskData as Record<string, unknown>)[system];
    return typeof v === "number" ? v : 5;
  };

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const W = el.clientWidth  || 700;
    const H = el.clientHeight || 500;

    // Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      throw new Error("WebGL context creation failed");
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    // Scene / Camera
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0, 2.8);

    // Lighting
    const ambient = new THREE.AmbientLight(0x223344, 1.8);
    scene.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
    sunLight.position.set(3, 1.5, 3);
    scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x112244, 0.8);
    fillLight.position.set(-2, -1, -2);
    scene.add(fillLight);

    // Earth sphere
    const earthGeo = new THREE.SphereGeometry(1, 64, 48);
    const earthTex = buildEarthTexture();
    const earthMat = new THREE.MeshPhongMaterial({
      map: earthTex,
      shininess: 30,
      specular: new THREE.Color(0x113355),
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);

    // Atmosphere glow
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      uniforms: { uKp: { value: kp } },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const atmoGeo = new THREE.SphereGeometry(1.055, 48, 32);
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmo);

    // Aurora rings (polar)
    const makeAuroraRing = (latDeg: number, sign: number) => {
      const pts: THREE.Vector3[] = [];
      const R = 1.012;
      for (let i = 0; i <= 128; i++) {
        const lon = (i / 128) * 360 - 180;
        pts.push(latLonToXYZ(sign * latDeg, lon, R));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const auroraColor = kp < 4 ? 0x00ff88 : kp < 7 ? 0xffaa00 : 0xff2200;
      const mat = new THREE.LineBasicMaterial({
        color: auroraColor,
        transparent: true,
        opacity: Math.min(kp / 6, 1) * 0.8,
        blending: THREE.AdditiveBlending,
      });
      return new THREE.Line(geo, mat);
    };
    scene.add(makeAuroraRing(68, 1), makeAuroraRing(68, -1));
    scene.add(makeAuroraRing(72, 1), makeAuroraRing(72, -1));

    // Impact zone markers
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    IMPACT_ZONES.forEach(zone => {
      const riskPct = getRiskVal(zone.system) / 100;
      const pos = latLonToXYZ(zone.lat, zone.lon, 1.015);
      const tex = makeMarkerTexture(zone.color);

      // Sprite billboard
      const sSize = 0.14 + riskPct * 0.16;
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.92,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.setScalar(sSize);
      sprite.position.copy(pos);
      markerGroup.add(sprite);

      // Outer ring
      const ringPts: THREE.Vector3[] = [];
      const ringR = 1.016;
      const ringRadius = 0.04 + riskPct * 0.04;
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const p = latLonToXYZ(zone.lat, zone.lon, ringR);
        // Offset in tangential plane
        const north = latLonToXYZ(zone.lat + 0.1, zone.lon, ringR).sub(p).normalize();
        const east  = new THREE.Vector3().crossVectors(p.clone().normalize(), north).normalize();
        ringPts.push(
          p.clone()
           .add(north.clone().multiplyScalar(Math.cos(a) * ringRadius))
           .add(east.clone().multiplyScalar(Math.sin(a) * ringRadius))
        );
      }
      const rGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      const rMat = new THREE.LineBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      markerGroup.add(new THREE.Line(rGeo, rMat));

      // Spike out from surface
      const spikeLen = 0.06 + riskPct * 0.07;
      const spikeMat = new THREE.LineBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
      });
      const spikeGeo = new THREE.BufferGeometry().setFromPoints([
        pos.clone(),
        pos.clone().multiplyScalar(1.0 + spikeLen),
      ]);
      markerGroup.add(new THREE.Line(spikeGeo, spikeMat));

      // Text label at spike tip
      const labelTex = makeTextSprite(zone.label, zone.color);
      const labelMat = new THREE.SpriteMaterial({
        map: labelTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        opacity: 0.95,
      });
      const labelSprite = new THREE.Sprite(labelMat);
      // Scale to keep text readable — aspect ratio from canvas
      const aspect = labelTex.image.width / labelTex.image.height;
      const labelH = 0.085;
      labelSprite.scale.set(labelH * aspect, labelH, 1);
      // Position at spike tip + small offset
      const labelPos = pos.clone().multiplyScalar(1.0 + spikeLen + 0.055);
      labelSprite.position.copy(labelPos);
      markerGroup.add(labelSprite);
    });

    // Solar wind particles
    const NPART = 800;
    const pPos = new Float32Array(NPART * 3);
    const pVel = new Float32Array(NPART);
    for (let i = 0; i < NPART; i++) {
      pPos[i*3]   = (Math.random() - 0.5) * 6;
      pPos[i*3+1] = (Math.random() - 0.5) * 4;
      pPos[i*3+2] = -2 - Math.random() * 3;
      pVel[i]     = 0.008 + Math.random() * 0.012;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x00aaff,
      size: 0.025,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // Drag to rotate
    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let rotY = 0, rotX = 0.12;
    let targetRotY = 0, targetRotX = 0.12;

    const onDown = (e: MouseEvent) => { isDragging = true; lastMouse = { x: e.clientX, y: e.clientY }; };
    const onUp   = () => { isDragging = false; };
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      targetRotY += (e.clientX - lastMouse.x) * 0.008;
      targetRotX += (e.clientY - lastMouse.y) * 0.005;
      targetRotX = Math.max(-0.6, Math.min(0.6, targetRotX));
      lastMouse = { x: e.clientX, y: e.clientY };
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);

    // Animation loop
    let raf = 0;
    let t = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      t += 0.01;

      // Auto-rotate
      if (!isDragging) targetRotY += 0.002;
      rotY += (targetRotY - rotY) * 0.07;
      rotX += (targetRotX - rotX) * 0.07;
      earth.rotation.set(rotX, rotY, 0);
      atmo.rotation.set(rotX, rotY, 0);
      markerGroup.rotation.set(rotX, rotY, 0);

      // Pulse markers
      markerGroup.children.forEach((child, i) => {
        if (child instanceof THREE.Sprite) {
          const base = 0.14 + (getRiskVal(IMPACT_ZONES[Math.floor(i / 3)]?.system ?? "") / 100) * 0.16;
          const pulse = 1 + Math.sin(t * 3 + i) * 0.18;
          child.scale.setScalar(base * pulse);
        }
      });

      // Solar wind: move particles toward earth
      const windSpeed = (speed / 400) * 0.012;
      const posArr = pGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < NPART; i++) {
        posArr[i*3+2] += pVel[i] * (windSpeed / 0.012);
        if (posArr[i*3+2] > 1.5) {
          posArr[i*3]   = (Math.random() - 0.5) * 6;
          posArr[i*3+1] = (Math.random() - 0.5) * 4;
          posArr[i*3+2] = -4;
        }
      }
      pGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      renderer.dispose();
      earthTex.dispose();
      earthMat.dispose();
      atmoMat.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legend data
  const legendItems = [
    { color: "#00f0ff", label: "HF Radyo" },
    { color: "#ffaa00", label: "Elektrik Şebekesi" },
    { color: "#39ff14", label: "GPS / Uydu" },
    { color: "#cc44ff", label: "Uydu Operasyonu" },
    { color: "#ff4444", label: "Havacılık" },
  ];

  return (
    <div className="relative w-full h-full bg-[#010913]">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 backdrop-blur-sm">
        {legendItems.map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color, boxShadow: `0 0 4px ${item.color}` }} />
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
