import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SpaceWeatherData, AIPrediction, InfrastructureRisk } from "@workspace/api-client-react/src/generated/api.schemas";

interface Globe3DProps {
  data?: SpaceWeatherData;
  pred?: AIPrediction;
  risk?: InfrastructureRisk;
}

// Affected region coordinates (lat, lon, label, system)
const IMPACT_ZONES = [
  { lat: 64, lon: -20,  label: "İzlanda",      system: "hfRadio",     color: 0x00f0ff },
  { lat: 70, lon: 25,   label: "Norveç",        system: "hfRadio",     color: 0x00f0ff },
  { lat: 65, lon: -148, label: "Alaska",        system: "powerGrid",   color: 0xffaa00 },
  { lat: 60, lon: -95,  label: "Kanada",        system: "powerGrid",   color: 0xffaa00 },
  { lat: 55, lon: 37,   label: "Moskova",       system: "gpsGnss",     color: 0x39ff14 },
  { lat: 52, lon: 5,    label: "Batı Avrupa",   system: "gpsGnss",     color: 0x39ff14 },
  { lat: 35, lon: 139,  label: "Tokyo",         system: "satelliteOps",color: 0xcc44ff },
  { lat: 40, lon: -74,  label: "New York",      system: "aviation",    color: 0xff4444 },
  { lat: -75, lon: 0,   label: "Antarktika",    system: "hfRadio",     color: 0x00f0ff },
  { lat: -55, lon: -68, label: "Güney Amerika", system: "gpsGnss",     color: 0x39ff14 },
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

// ── Shaders ────────────────────────────────────────────────────────────────

const earthVert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main(){
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;

const earthFrag = /* glsl */`
  uniform float uTime;
  uniform float uKp;
  varying vec2 vUv;
  varying vec3 vNormal;

  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p); vec2 f=fract(p);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
    vec2 u=f*f*(3.-2.*f);
    return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
  }
  float fbm(vec2 p){
    float v=0.;float a=.5;
    for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.2; a*=.5; }
    return v;
  }

  void main(){
    vec2 uv = vUv;
    // Land / ocean procedural
    float n = fbm(uv * 6.0);
    float land = smoothstep(0.46, 0.54, n);

    vec3 ocean = vec3(0.01, 0.06, 0.18);
    vec3 shallow = vec3(0.02, 0.10, 0.25);
    vec3 landCol = vec3(0.05, 0.14, 0.06);
    vec3 desert  = vec3(0.18, 0.13, 0.04);
    float detail = fbm(uv * 14.0 + 3.0);
    vec3 terrainCol = mix(landCol, desert, smoothstep(0.3, 0.7, detail));
    vec3 base = mix(mix(ocean, shallow, smoothstep(0.3,0.46,n)), terrainCol, land);

    // City lights (night side) — tiny bright dots on land
    float cityNoise = fbm(uv * 40.0 + 7.0);
    float cityMask  = land * smoothstep(0.7, 1.0, cityNoise);
    vec3 cityGlow   = vec3(0.9, 0.85, 0.5) * cityMask * 0.6;

    // Polar aurora bands
    float lat = (uv.y - 0.5) * 3.14159;
    float absLat = abs(lat);
    float auroraMinLat = mix(1.1, 0.7, smoothstep(0.0, 9.0, uKp)); // radians
    float auroraStrip = smoothstep(auroraMinLat-0.15, auroraMinLat, absLat)
                      * smoothstep(auroraMinLat+0.3,  auroraMinLat, absLat);
    float auroraWave = sin(uv.x * 30.0 + uTime * 0.8) * 0.5 + 0.5;
    float auroraWave2= sin(uv.x * 18.0 - uTime * 0.5 + 1.2) * 0.5 + 0.5;
    float aurora = auroraStrip * mix(auroraWave, auroraWave2, 0.5) * smoothstep(0.0, 2.0, uKp);
    vec3 auroraGreen = vec3(0.0, 1.0, 0.4);
    vec3 auroraRed   = vec3(1.0, 0.2, 0.0);
    vec3 auroraCol   = mix(auroraGreen, auroraRed, smoothstep(5.0, 9.0, uKp));

    // Diffuse lighting (fake sun from top-left)
    vec3 lightDir = normalize(vec3(1.0, 0.5, 1.0));
    float diff = max(0.0, dot(vNormal, lightDir));
    float ambient = 0.10;
    float light = ambient + diff * 0.55;

    vec3 col = base * light + cityGlow * (1.0 - diff * 0.9) + auroraCol * aurora;
    // Slight cyan tint on edges (sci-fi)
    float rim = pow(1.0 - dot(vNormal, vec3(0,0,1)), 2.5) * 0.15;
    col += vec3(0.0, 0.8, 1.0) * rim;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const atmosphereVert = /* glsl */`
  varying vec3 vNormal;
  void main(){
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;

const atmosphereFrag = /* glsl */`
  uniform float uKp;
  varying vec3 vNormal;
  void main(){
    float intensity = pow(0.65 - dot(vNormal, vec3(0,0,1)), 2.5);
    vec3 stormCol = mix(vec3(0.0, 0.5, 1.0), vec3(1.0, 0.15, 0.05), smoothstep(4.0, 8.0, uKp));
    gl_FragColor = vec4(stormCol, intensity * 0.55);
  }
`;

const gridVert = /* glsl */`
  void main(){
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;
const gridFrag = /* glsl */`
  void main(){
    gl_FragColor = vec4(0.0, 0.9, 1.0, 0.07);
  }
`;

class GlobeErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
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

function Globe3DInner({ data, pred, risk }: Globe3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    earth: THREE.Mesh;
    atmo: THREE.Mesh;
    earthMat: THREE.ShaderMaterial;
    atmoMat: THREE.ShaderMaterial;
    markers: THREE.Group;
    particles: THREE.Points;
    particlePosArr: Float32Array;
    raf: number;
    isDragging: boolean;
    lastMouse: { x: number; y: number };
    rotY: number;
    rotX: number;
    targetRotY: number;
    targetRotX: number;
  } | null>(null);

  const kp = data?.kpIndex ?? 2;
  const speed = data?.solarWind?.speed ?? 400;
  const riskData = risk;

  // Risk level for each zone
  const getRiskVal = (system: string): number => {
    if (!riskData) return 5;
    const v = (riskData as any)[system] as number | undefined;
    return v ?? 5;
  };

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const W = el.clientWidth  || 600;
    const H = el.clientHeight || 400;

    // ── Scene setup ──────────────────────────────────────────────────────
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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.z = 2.8;

    // ── Stars background ─────────────────────────────────────────────────
    const starGeo = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) starPos[i] = (Math.random() - 0.5) * 80;
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Points(starGeo, starMat));

    // ── Earth ────────────────────────────────────────────────────────────
    const earthGeo = new THREE.SphereGeometry(1, 64, 64);
    const earthMat = new THREE.ShaderMaterial({
      vertexShader: earthVert,
      fragmentShader: earthFrag,
      uniforms: { uTime: { value: 0 }, uKp: { value: kp } },
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);

    // ── Atmosphere ───────────────────────────────────────────────────────
    const atmoGeo = new THREE.SphereGeometry(1.08, 64, 64);
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVert,
      fragmentShader: atmosphereFrag,
      uniforms: { uKp: { value: kp } },
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
    });
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmo);

    // ── Sci-fi grid wireframe ─────────────────────────────────────────────
    const gridGeo = new THREE.SphereGeometry(1.01, 32, 16);
    const gridMat = new THREE.ShaderMaterial({
      vertexShader: gridVert,
      fragmentShader: gridFrag,
      transparent: true,
      wireframe: true,
    });
    scene.add(new THREE.Mesh(gridGeo, gridMat));

    // ── Impact zone markers ──────────────────────────────────────────────
    const markers = new THREE.Group();
    scene.add(markers);

    IMPACT_ZONES.forEach(zone => {
      const rval = getRiskVal(zone.system);
      const pos  = latLonToXYZ(zone.lat, zone.lon, 1.01);

      // Glowing disc on surface
      const discGeo = new THREE.CircleGeometry(0.045 + rval * 0.0012, 32);
      const discMat = new THREE.MeshBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.25 + rval * 0.006,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.copy(pos);
      disc.lookAt(new THREE.Vector3(0, 0, 0).multiplyScalar(-1).add(pos));
      markers.add(disc);

      // Outer ring pulse
      const ringGeo = new THREE.RingGeometry(0.055 + rval * 0.001, 0.07 + rval * 0.001, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(new THREE.Vector3(0, 0, 0).multiplyScalar(-1).add(pos));
      ring.userData.baseOpacity = 0.7;
      ring.userData.phase       = Math.random() * Math.PI * 2;
      markers.add(ring);

      // Vertical spike
      const spikeGeo = new THREE.CylinderGeometry(0.003, 0.001, 0.15 + rval * 0.002, 6);
      const spikeMat = new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.6 });
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      const mid = pos.clone().normalize().multiplyScalar(1.08);
      spike.position.copy(mid);
      spike.lookAt(mid.clone().multiplyScalar(2));
      spike.rotateX(Math.PI / 2);
      markers.add(spike);
    });

    // ── Aurora polar ring ─────────────────────────────────────────────────
    const auroraMinLat = 90 - Math.max(40, 75 - kp * 3.5);
    const auroraRadius = Math.cos((auroraMinLat * Math.PI) / 180);
    const auroraY      = Math.sin((auroraMinLat * Math.PI) / 180);
    const auroraGeo    = new THREE.TorusGeometry(auroraRadius, 0.018, 16, 120);
    const auroraColor  = kp > 6 ? 0xff2200 : kp > 4 ? 0xffaa00 : 0x00ff88;
    const auroraMat    = new THREE.MeshBasicMaterial({ color: auroraColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const auroraRingN  = new THREE.Mesh(auroraGeo, auroraMat);
    auroraRingN.position.y = auroraY;
    scene.add(auroraRingN);
    const auroraRingS  = auroraRingN.clone();
    auroraRingS.position.y = -auroraY;
    scene.add(auroraRingS);

    // ── Solar wind particles ──────────────────────────────────────────────
    const pCount = 600;
    const pPositions = new Float32Array(pCount * 3);
    const pVelocities = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const r = 2.5 + Math.random() * 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi   = (Math.random() - 0.5) * Math.PI * 0.5;
      pPositions[i*3]   = r * Math.cos(phi) * Math.cos(theta);
      pPositions[i*3+1] = r * Math.sin(phi);
      pPositions[i*3+2] = r * Math.cos(phi) * Math.sin(theta);
      pVelocities[i*3]   = (Math.random() - 0.5) * 0.002;
      pVelocities[i*3+1] = (Math.random() - 0.5) * 0.002;
      pVelocities[i*3+2] = -(0.004 + Math.random() * 0.006) * (speed / 400);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x44ddff,
      size: 0.018,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ── Interaction: drag to rotate ───────────────────────────────────────
    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let rotY = 0;
    let rotX = 0.15;
    let targetRotY = 0;
    let targetRotX = 0.15;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true; lastMouse = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      targetRotY += (e.clientX - lastMouse.x) * 0.005;
      targetRotX += (e.clientY - lastMouse.y) * 0.003;
      targetRotX  = Math.max(-0.6, Math.min(0.6, targetRotX));
      lastMouse    = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => { isDragging = false; };

    const onTouchStart = (e: TouchEvent) => {
      isDragging = true; lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      targetRotY += (e.touches[0].clientX - lastMouse.x) * 0.005;
      targetRotX += (e.touches[0].clientY - lastMouse.y) * 0.003;
      lastMouse    = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onMouseUp);

    // ── Animation loop ────────────────────────────────────────────────────
    let raf = 0;
    let t = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      t += 0.016;

      // Auto-rotate
      if (!isDragging) targetRotY += 0.0015;
      rotY += (targetRotY - rotY) * 0.06;
      rotX += (targetRotX - rotX) * 0.06;

      earth.rotation.y = rotY;
      earth.rotation.x = rotX;
      atmo.rotation.y  = rotY;
      atmo.rotation.x  = rotX;
      markers.rotation.y = rotY;
      markers.rotation.x = rotX;
      auroraRingN.rotation.y = rotY * 0.3;
      auroraRingS.rotation.y = rotY * 0.3;

      // Update uniforms
      earthMat.uniforms.uTime.value = t;

      // Pulse markers
      markers.children.forEach(child => {
        if (child.userData.phase !== undefined) {
          const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = child.userData.baseOpacity * (0.5 + 0.5 * Math.sin(t * 2 + child.userData.phase));
        }
      });

      // Solar wind particles drift inward
      const pos = particleGeo.attributes.position;
      for (let i = 0; i < pCount; i++) {
        pos.array[i*3]   += pVelocities[i*3];
        pos.array[i*3+1] += pVelocities[i*3+1];
        pos.array[i*3+2] += pVelocities[i*3+2];
        const dist = Math.sqrt(
          pos.array[i*3]**2 + pos.array[i*3+1]**2 + pos.array[i*3+2]**2
        );
        if (dist < 1.1) {
          const r2 = 2.5 + Math.random() * 1.5;
          const th = Math.random() * Math.PI * 2;
          const ph = (Math.random() - 0.5) * Math.PI * 0.5;
          pos.array[i*3]   = r2 * Math.cos(ph) * Math.cos(th);
          pos.array[i*3+1] = r2 * Math.sin(ph);
          pos.array[i*3+2] = r2 * Math.cos(ph) * Math.sin(th);
        }
      }
      pos.needsUpdate = true;

      renderer.render(scene, camera);
    };
    animate();

    // ── Resize handler ────────────────────────────────────────────────────
    const onResize = () => {
      const w = el.clientWidth  || 600;
      const h = el.clientHeight || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    stateRef.current = {
      renderer, scene, camera, earth, atmo, earthMat, atmoMat,
      markers, particles, particlePosArr: pPositions,
      raf, isDragging, lastMouse, rotY, rotX, targetRotY, targetRotX,
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onMouseUp);
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update uniforms on data change without remounting
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.earthMat.uniforms.uKp.value = kp;
    s.atmoMat.uniforms.uKp.value  = kp;
  }, [kp]);

  // Legend entries
  const legendItems = useMemo(() => [
    { color: "#00f0ff", label: "HF Radyo" },
    { color: "#ffaa00", label: "Elektrik Şebekesi" },
    { color: "#39ff14", label: "GPS/GNSS" },
    { color: "#cc44ff", label: "Uydu Operasyonları" },
    { color: "#ff4444", label: "Havacılık" },
  ], []);

  const stormLabel =
    kp >= 8 ? "G4-G5 AŞIRI FIRTINA" :
    kp >= 6 ? "G2-G3 ŞİDDETLİ FIRTINA" :
    kp >= 5 ? "G1 HAFIF FIRTINA" :
    kp >= 4 ? "YÜKSEK AKTİVİTE" : "SAKIN";

  const stormColor =
    kp >= 6 ? "#ff3333" : kp >= 4 ? "#ffaa00" : "#00ff88";

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden rounded-xl bg-[#020b16]">
      {/* Header overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: stormColor, boxShadow: `0 0 8px ${stormColor}` }} />
          <span className="font-display text-[10px] tracking-widest uppercase" style={{ color: stormColor }}>
            {stormLabel}
          </span>
        </div>
        <div className="font-mono text-[10px] text-cyan-400/70 tracking-wider">
          Kp {kp.toFixed(1)} · {(data?.solarWind?.speed ?? 0).toFixed(0)} km/s
        </div>
      </div>

      {/* Three.js canvas mount */}
      <div ref={mountRef} className="w-full flex-1 cursor-grab active:cursor-grabbing" />

      {/* Legend */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 py-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
          {legendItems.map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: item.color, boxShadow: `0 0 5px ${item.color}` }} />
              <span className="font-mono text-[9px] text-white/60">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="text-center font-display text-[9px] text-white/30 mt-0.5 tracking-widest">
          SÜRÜKLE → DÖNDÜREBİLİRSİN
        </div>
      </div>
    </div>
  );
}
