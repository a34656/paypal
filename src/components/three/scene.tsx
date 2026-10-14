"use client";
/**
 * AEGIS agent network. Renders ONLY from MissionViewModel (recorded events) and persisted
 * product rows. Nothing here runs on timers to imply work: particles spawn for a new recorded
 * event, candidate nodes exist only once Scout has stored them, and they move to ranked slots
 * only once the Optimizer has stored ranks. It never decides anything.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";
import { NODE_META_2D, nodeState, type AgentNode, type NodeVisualState } from "./node-meta";
import { statusText } from "./scene-status";

export { statusText };

export const AGENT_NODES: AgentNode[] = ["scout", "risk", "optimizer", "policy", "paypal"];

export const NODE_POS: Record<AgentNode | "core" | "gate", [number, number, number]> = {
  core: [0, 0, 0],
  scout: [-3.7, 0.9, 0.3],
  risk: [-1.7, 2.45, -0.6],
  optimizer: [1.7, 2.45, -0.6],
  policy: [3.7, 0.9, 0.3],
  gate: [3.25, -0.85, 0.55],
  paypal: [2.0, -1.85, 0.8],
};

export const NODE_META = NODE_META_2D;

export interface ProductMarker {
  id: string;
  label: string;
  decision: string | null;
  rank?: number | null;
  risk?: number | null;
  coverage?: number | null;
}

interface SceneProps {
  vm: MissionViewModel | null;
  products?: ProductMarker[];
  paused: boolean;
  selected: NodeId | null;
  onSelect: (id: NodeId) => void;
  resetKey: number;
  lowPower?: boolean;
  onContextLost?: () => void;
}

const STATE_COLOR: Record<NodeVisualState, string> = {
  idle: "#3A4150",
  active: "#6FE3EE",
  done: "#B8DCFF",
  warning: "#F2B45A",
  blocked: "#FF5D6C",
  success: "#52D3A3",
};

const DECISION_COLOR = (d: string | null) => (d === "BLOCK" ? "#FF5D6C" : d === "REQUIRE_APPROVAL" ? "#F2B45A" : d === "ALLOW_CHECKOUT" ? "#52D3A3" : "#5B6371");

function MiniCore({ tint, paused }: { tint: string; paused: boolean }) {
  const lattice = useRef<THREE.LineSegments>(null);
  const ring = useRef<THREE.Mesh>(null);
  const heart = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1)), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((state, dt) => {
    if (paused) return;
    if (lattice.current) lattice.current.rotation.y += dt * 0.12;
    if (ring.current) ring.current.rotation.z += dt * 0.18;
    if (heart.current) heart.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.2) * 0.05);
  });
  return (
    <group>
      <mesh>
        <octahedronGeometry args={[0.34, 0]} />
        <meshPhysicalMaterial color="#cfefff" roughness={0.08} transmission={0.9} thickness={0.6} ior={1.4} transparent opacity={0.9} />
      </mesh>
      <mesh ref={heart}>
        <sphereGeometry args={[0.09, 20, 20]} />
        <meshBasicMaterial color={tint} toneMapped={false} />
      </mesh>
      <lineSegments ref={lattice} geometry={geo}>
        <lineBasicMaterial color={tint} transparent opacity={0.35} />
      </lineSegments>
      <mesh ref={ring} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[0.95, 0.004, 6, 160]} />
        <meshBasicMaterial color={tint} transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

function NodeShape({ id }: { id: AgentNode }) {
  switch (id) {
    case "policy":
      return <octahedronGeometry args={[0.3, 0]} />;
    case "risk":
      return <tetrahedronGeometry args={[0.34, 0]} />;
    case "paypal":
      return <boxGeometry args={[0.38, 0.38, 0.38]} />;
    case "optimizer":
      return <dodecahedronGeometry args={[0.27, 0]} />;
    default:
      return <icosahedronGeometry args={[0.27, 0]} />;
  }
}

function AgentNodeMesh({ id, state, selected, onSelect, onHover, paused }: { id: AgentNode; state: NodeVisualState; selected: boolean; onSelect: (id: NodeId) => void; onHover: (id: NodeId | null) => void; paused: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const color = STATE_COLOR[state];
  const lit = state !== "idle";
  useFrame((st, dt) => {
    if (paused) return;
    if (mesh.current) mesh.current.rotation.y += dt * (state === "active" ? 0.9 : 0.15);
    if (halo.current) {
      const s = state === "active" ? 1 + Math.sin(st.clock.elapsedTime * 3) * 0.08 : 1;
      halo.current.scale.setScalar(s);
    }
  });
  return (
    <group position={NODE_POS[id]}>
      <mesh
        ref={mesh}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
      >
        <NodeShape id={id} />
        <meshStandardMaterial color={lit ? color : "#202530"} emissive={color} emissiveIntensity={lit ? 0.8 : 0.08} metalness={0.6} roughness={0.3} flatShading />
      </mesh>
      <mesh ref={halo}>
        <torusGeometry args={[0.46, selected ? 0.008 : 0.004, 6, 96]} />
        <meshBasicMaterial color={color} transparent opacity={lit || selected ? 0.85 : 0.25} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Link3D({ from, to, color, opacity, width = 0.8, dashed = false }: { from: [number, number, number]; to: [number, number, number]; color: string; opacity: number; width?: number; dashed?: boolean }) {
  return <Line points={[from, to]} color={color} lineWidth={width} transparent opacity={opacity} dashed={dashed} dashSize={0.12} gapSize={0.1} />;
}

/** Candidate products: discovered around Scout; once ranked, they settle into slots beside the Optimizer. */
function ProductNodes({ products, paused }: { products: ProductMarker[]; paused: boolean }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const list = products.slice(0, 10);
  const anyRanked = list.some((p) => p.rank != null);
  const layoutKey = list.map((p) => `${p.id}:${p.rank}`).join("|");
  const targets = useMemo(
    () =>
      list.map((p, i) => {
        if (anyRanked && p.rank != null) {
          const o = NODE_POS.optimizer;
          return new THREE.Vector3(o[0] - 0.2 + (p.rank - 1) * 0.42, o[1] + 0.95, o[2] + 0.2);
        }
        const s = NODE_POS.scout;
        const a = Math.PI * 0.55 + (i / Math.max(list.length, 1)) * Math.PI * 1.1;
        const r = anyRanked ? 1.35 : 1.05; // rejected ones drift outward once ranking exists
        return new THREE.Vector3(s[0] + Math.cos(a) * r, s[1] + Math.sin(a) * r * 0.9, s[2] + 0.25);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from product identity/rank only (layoutKey)
    [layoutKey, anyRanked],
  );
  useFrame((_, dt) => {
    const k = paused ? 1 : 1 - Math.exp(-dt * 2.4);
    refs.current.forEach((g, i) => {
      if (g && targets[i]) g.position.lerp(targets[i], k);
    });
  });
  const scout = new THREE.Vector3(...NODE_POS.scout);
  return (
    <group>
      {list.map((p, i) => {
        const color = DECISION_COLOR(p.decision);
        const rejected = anyRanked && p.rank == null;
        return (
          <group key={p.id} ref={(g) => void (refs.current[i] = g)} position={scout}>
            <mesh>
              <boxGeometry args={[0.11, 0.11, 0.11]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={rejected ? 0.15 : 0.7} transparent opacity={rejected ? 0.45 : 1} />
            </mesh>
            {p.rank === 1 && (
              <mesh>
                <torusGeometry args={[0.13, 0.006, 6, 48]} />
                <meshBasicMaterial color="#6FE3EE" toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** A short burst along core → node, triggered only by a new recorded event (keyed by its seq). */
function EventParticles({ to, eventKey, paused, count }: { to: AgentNode | "gate" | null; eventKey: number; paused: boolean; count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const started = useRef<number | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const from = useMemo(() => new THREE.Vector3(...NODE_POS.core), []);
  const target = useMemo(() => new THREE.Vector3(...NODE_POS[to ?? "core"]), [to]);
  const mid = useMemo(() => from.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.5, 0.4)), [from, target]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(from, mid, target), [from, mid, target]);
  useEffect(() => {
    started.current = to && eventKey > 0 ? -1 : null; // -1 = start on next frame (clock-relative)
  }, [eventKey, to]);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || paused) return;
    const now = state.clock.elapsedTime;
    if (started.current === -1) started.current = now;
    const t0 = started.current;
    for (let i = 0; i < count; i++) {
      let p = -1;
      if (t0 !== null) {
        const e = (now - t0) / 1.5 - i * 0.05;
        p = e >= 0 && e <= 1 ? e : -1;
      }
      if (p < 0) dummy.scale.setScalar(0);
      else {
        curve.getPoint(p, dummy.position);
        dummy.scale.setScalar(0.035 * Math.sin(p * Math.PI) + 0.008);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#6FE3EE" toneMapped={false} />
    </instancedMesh>
  );
}

function Dust({ count }: { count: number }) {
  const geo = useMemo(() => {
    let seed = 0x1e9a;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 16;
      pos[i * 3 + 1] = (rnd() - 0.5) * 9;
      pos[i * 3 + 2] = (rnd() - 0.5) * 8 - 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.018} color="#B8DCFF" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function CameraRig({ resetKey, paused }: { resetKey: number; paused: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0.4, 9.2);
    controls.current?.target.set(0, 0.2, 0);
    controls.current?.update();
  }, [resetKey, camera]);
  useFrame(({ pointer }, dt) => {
    if (paused || !controls.current) return;
    const k = 1 - Math.exp(-dt * 1.5);
    const t = controls.current.target;
    t.x += (pointer.x * 0.35 - t.x) * k;
    t.y += (0.2 + pointer.y * 0.2 - t.y) * k;
    controls.current.update();
  });
  // Zoom disabled so the page scroll is never captured by the canvas.
  return <OrbitControls ref={controls} enablePan={false} enableZoom={false} minPolarAngle={Math.PI * 0.32} maxPolarAngle={Math.PI * 0.62} minAzimuthAngle={-0.6} maxAzimuthAngle={0.6} enableDamping />;
}

/** Projects anchor positions to screen space each frame and moves the DOM labels. */
function LabelProjector({ labels }: { labels: RefObject<Record<string, HTMLDivElement | null>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const id of Object.keys(NODE_POS) as (keyof typeof NODE_POS)[]) {
      const el = labels.current?.[id];
      if (!el) continue;
      v.set(...NODE_POS[id]).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      // Imperative DOM write from the render loop (avoids a React render per frame).
      el.style.setProperty("transform", `translate(-50%, 0) translate(${x}px, ${y + (id === "core" ? 52 : id === "gate" ? 14 : 26)}px)`);
      el.style.setProperty("opacity", v.z < 1 ? "1" : "0");
    }
  });
  return null;
}

export default function AegisScene({ vm, products = [], paused, selected, onSelect, resetKey, lowPower = false, onContextLost }: SceneProps) {
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  const [hover, setHover] = useState<NodeId | null>(null);
  const states = useMemo(() => Object.fromEntries(AGENT_NODES.map((id) => [id, nodeState(id, vm)])) as Record<AgentNode, NodeVisualState>, [vm]);
  const coreTint = vm?.scene === "FAILED" || vm?.scene === "BLOCKED" ? "#FF5D6C" : vm?.scene === "CAPTURED" ? "#52D3A3" : vm?.scene === "APPROVAL_REQUIRED" ? "#F2B45A" : "#6FE3EE";
  const active = vm?.activeNode ?? null;
  const particleTarget: AgentNode | "gate" | null = active === "human" ? "gate" : active && (AGENT_NODES as string[]).includes(active) ? (active as AgentNode) : null;
  const gateLit = (vm?.approvals ?? 0) > 0;

  const pipeline: [keyof typeof NODE_POS, keyof typeof NODE_POS][] = [
    ["scout", "risk"],
    ["risk", "optimizer"],
    ["optimizer", "policy"],
    ["policy", "gate"],
    ["gate", "paypal"],
  ];

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [0, 0.4, 9.2], fov: 42 }}
        dpr={lowPower ? 1 : [1, 1.6]}
        frameloop={paused ? "demand" : "always"}
        gl={{ antialias: !lowPower, alpha: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.domElement.addEventListener(
            "webglcontextlost",
            (e) => {
              e.preventDefault();
              onContextLost?.();
            },
            { once: true },
          );
        }}
      >
        <fog attach="fog" args={["#050608", 9, 19]} />
        <ambientLight intensity={0.25} />
        <pointLight position={[0, 1, 5]} intensity={22} color="#6FE3EE" />
        <pointLight position={[-6, 4, -3]} intensity={10} color="#9D8CF2" />
        <Dust count={lowPower ? 120 : 360} />
        <MiniCore tint={coreTint} paused={paused} />
        {AGENT_NODES.map((id) => (
          <Link3D key={`s-${id}`} from={NODE_POS.core} to={NODE_POS[id]} color={states[id] === "idle" ? "#272C37" : STATE_COLOR[states[id]]} opacity={states[id] === "idle" ? 0.55 : 0.75} width={active === id ? 1.4 : 0.7} />
        ))}
        {pipeline.map(([a, b]) => (
          <Link3D key={`p-${a}-${b}`} from={NODE_POS[a]} to={NODE_POS[b]} color={b === "paypal" || b === "gate" ? (gateLit ? "#52D3A3" : "#272C37") : "#272C37"} opacity={0.5} width={0.6} dashed={b === "gate" || a === "gate"} />
        ))}
        <mesh position={NODE_POS.gate} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.16, 0.16, 0.02]} />
          <meshBasicMaterial color={gateLit ? "#52D3A3" : "#3A4150"} toneMapped={false} />
        </mesh>
        {AGENT_NODES.map((id) => (
          <AgentNodeMesh key={id} id={id} state={states[id]} selected={selected === id} onSelect={onSelect} onHover={setHover} paused={paused} />
        ))}
        <ProductNodes products={products} paused={paused} />
        <EventParticles to={particleTarget} eventKey={vm?.lastEvent?.seq ?? 0} paused={paused} count={lowPower ? 8 : 16} />
        <CameraRig resetKey={resetKey} paused={paused} />
        <LabelProjector labels={labels} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {(["core", ...AGENT_NODES, "gate"] as const).map((id) => {
          const isAgent = id !== "core" && id !== "gate";
          const st = isAgent ? states[id] : null;
          const status = isAgent ? statusText(id, vm) : null;
          return (
            <div
              key={id}
              ref={(el) => {
                labels.current[id] = el;
              }}
              className="absolute left-0 top-0 whitespace-nowrap text-center"
            >
              {id === "gate" ? (
                <span className={`font-mono text-[9px] tracking-[0.18em] ${gateLit ? "text-success" : "text-faint"}`}>HUMAN GATE</span>
              ) : id === "core" ? (
                <span className="font-mono text-[9.5px] tracking-[0.24em] text-muted">AEGIS CORE</span>
              ) : (
                <>
                  <span className={`block font-mono text-[10px] tracking-[0.2em] ${st === "idle" ? "text-faint" : "text-fg"}`}>{NODE_META[id].label.toUpperCase()}</span>
                  {status && (
                    <span className="mt-0.5 block font-mono text-[9px] tracking-[0.12em]" style={{ color: STATE_COLOR[st ?? "idle"] }}>
                      {status}
                    </span>
                  )}
                  {hover === id && !status && <span className="mt-0.5 block font-mono text-[9px] text-faint">{NODE_META[id].kind}</span>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
