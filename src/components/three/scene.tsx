"use client";
/**
 * AEGIS network scene. Renders ONLY from MissionViewModel (or nothing, when idle). Particles
 * travel along a connection only when a recorded event made that node active — never fabricated.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";
import { NODE_META_2D } from "./node-meta";

export const NODE_POS: Record<NodeId, [number, number, number]> = {
  core: [0, 0, 0],
  interpreter: [-3.4, 1.5, 0],
  scout: [-2.6, -1.7, 0.8],
  risk: [0, 2.7, -0.8],
  optimizer: [2.6, -1.7, 0.8],
  policy: [3.4, 1.5, 0],
  human: [0, -2.45, 0.4],
  paypal: [4.9, -0.5, -0.8],
};

export const NODE_META = NODE_META_2D;


const SCENE_TINT: Record<string, string> = {
  BLOCKED: "#FF647C",
  FAILED: "#FF647C",
  APPROVAL_REQUIRED: "#F4BB61",
  CAPTURED: "#43D9A3",
};

export interface ProductMarker {
  id: string;
  label: string;
  decision: string | null;
}

interface SceneProps {
  vm: MissionViewModel | null;
  products?: ProductMarker[];
  paused: boolean;
  selected: NodeId | null;
  onSelect: (id: NodeId) => void;
  resetKey: number;
}

function AegisCore({ tint, paused }: { tint: string; paused: boolean }) {
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (paused) return;
    if (ring1.current) ring1.current.rotation.z += dt * 0.35;
    if (ring2.current) ring2.current.rotation.x += dt * 0.25;
    if (core.current) {
      const s = 1 + Math.sin(performance.now() / 700) * 0.04;
      core.current.scale.setScalar(s);
    }
  });
  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.55} wireframe />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={1.2} />
      </mesh>
      <mesh ref={ring1}>
        <torusGeometry args={[0.95, 0.012, 8, 64]} />
        <meshBasicMaterial color={tint} transparent opacity={0.7} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[1.2, 0.008, 8, 64]} />
        <meshBasicMaterial color="#6685FF" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function NodeShape({ id }: { id: NodeId }) {
  switch (id) {
    case "policy":
      return <octahedronGeometry args={[0.32, 0]} />;
    case "risk":
      return <tetrahedronGeometry args={[0.36, 0]} />;
    case "paypal":
      return <boxGeometry args={[0.46, 0.46, 0.46]} />;
    case "human":
      return <dodecahedronGeometry args={[0.3, 0]} />;
    default:
      return <sphereGeometry args={[0.24, 20, 20]} />;
  }
}

function SceneNode({ id, active, selected, onSelect, onHover }: { id: NodeId; active: boolean; selected: boolean; onSelect: (id: NodeId) => void; onHover: (id: NodeId | null) => void }) {
  const [hover, setHover] = useState(false);
  const meta = NODE_META[id];
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * (active ? 1.2 : 0.2);
  });
  return (
    <group position={NODE_POS[id]}>
      <mesh
        ref={mesh}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          onHover(id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
      >
        <NodeShape id={id} />
        <meshStandardMaterial color={meta.color} emissive={meta.color} emissiveIntensity={active || selected ? 0.9 : 0.25} transparent opacity={active || hover || selected ? 1 : 0.75} />
      </mesh>
      {(active || selected) && (
        <mesh>
          <torusGeometry args={[0.45, 0.01, 6, 48]} />
          <meshBasicMaterial color={meta.color} />
        </mesh>
      )}
    </group>
  );
}

function ProductNodes({ products }: { products: ProductMarker[] }) {
  const base = NODE_POS.scout;
  return (
    <group>
      {products.slice(0, 6).map((p, i) => {
        const a = (i / Math.max(products.length, 1)) * Math.PI * 1.2 + Math.PI * 0.9;
        const pos: [number, number, number] = [base[0] + Math.cos(a) * 1.25, base[1] + Math.sin(a) * 1.0, base[2] + 0.3];
        const color = p.decision === "BLOCK" ? "#FF647C" : p.decision === "REQUIRE_APPROVAL" ? "#F4BB61" : p.decision === "ALLOW_CHECKOUT" ? "#43D9A3" : "#8B9AAF";
        return (
          <group key={p.id} position={pos}>
            <Line points={[[0, 0, 0], [base[0] - pos[0], base[1] - pos[1], base[2] - pos[2]]]} color={color} lineWidth={0.6} transparent opacity={0.35} />
            <mesh>
              <boxGeometry args={[0.14, 0.14, 0.14]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ConnectionLine({ to, active }: { to: NodeId; active: boolean }) {
  return <Line points={[NODE_POS.core, NODE_POS[to]]} color={active ? NODE_META[to].color : "#263347"} lineWidth={active ? 1.6 : 0.8} transparent opacity={active ? 0.95 : 0.6} />;
}

/** Instanced particles; only spawned for a real transition (keyed by event seq). */
function DataParticles({ to, eventKey, paused }: { to: NodeId | null; eventKey: number; paused: boolean }) {
  const COUNT = 14;
  const ref = useRef<THREE.InstancedMesh>(null);
  const started = useRef<number | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    started.current = to && eventKey > 0 ? performance.now() : null;
  }, [eventKey, to]);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh || paused) return;
    const t0 = started.current;
    const from = new THREE.Vector3(...NODE_POS.core);
    const target = to ? new THREE.Vector3(...NODE_POS[to]) : from;
    for (let i = 0; i < COUNT; i++) {
      let p = -1;
      if (t0 !== null) {
        const elapsed = (performance.now() - t0) / 1600 - i * 0.06;
        p = elapsed >= 0 && elapsed <= 1 ? elapsed : -1;
      }
      if (p < 0) dummy.scale.setScalar(0);
      else {
        dummy.position.copy(from).lerp(target, p);
        dummy.scale.setScalar(0.05 * (1 - Math.abs(p - 0.5)));
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#56E0F0" />
    </instancedMesh>
  );
}

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 0, 4]} intensity={18} color="#56E0F0" />
      <pointLight position={[-5, 4, -2]} intensity={10} color="#6685FF" />
    </>
  );
}

function CameraRig({ resetKey, paused }: { resetKey: number; paused: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, pointer } = useThree();
  useEffect(() => {
    camera.position.set(0, 0.6, 9.5);
    controls.current?.target.set(0.6, 0, 0);
    controls.current?.update();
  }, [resetKey, camera]);
  useFrame(() => {
    if (paused || !controls.current) return;
    // Subtle pointer-responsive parallax; OrbitControls remains in charge.
    controls.current.target.x += ((0.6 + pointer.x * 0.25) - controls.current.target.x) * 0.02;
    controls.current.target.y += (pointer.y * 0.15 - controls.current.target.y) * 0.02;
    controls.current.update();
  });
  return <OrbitControls ref={controls} enablePan={false} enableZoom minDistance={5} maxDistance={14} enableDamping />;
}

/** Projects node positions to screen space each frame and moves the DOM labels (one overlay, no portals). */
function LabelProjector({ labels }: { labels: RefObject<Partial<Record<NodeId, HTMLDivElement | null>>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const id of Object.keys(NODE_POS) as NodeId[]) {
      const el = labels.current?.[id];
      if (!el) continue;
      v.set(...NODE_POS[id]).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      // Imperative DOM write from the render loop (intentional: avoids a React render per frame).
      el.style.setProperty("transform", `translate(-50%, 0) translate(${x}px, ${y + (id === "core" ? 46 : 22)}px)`);
      el.style.setProperty("opacity", v.z < 1 ? "1" : "0");
    }
  });
  return null;
}

function statusFor(id: NodeId, vm: MissionViewModel | null): string | null {
  if (!vm) return null;
  switch (id) {
    case "scout":
      return vm.steps.SCOUT;
    case "risk":
      return vm.steps.RISK;
    case "optimizer":
      return vm.steps.OPTIMIZE;
    case "policy":
      return vm.decision ?? vm.steps.POLICY;
    case "paypal":
      return vm.paymentStatus;
    default:
      return null;
  }
}

export default function AegisScene({ vm, products = [], paused, selected, onSelect, resetKey }: SceneProps) {
  const tint = vm ? (SCENE_TINT[vm.scene] ?? "#56E0F0") : "#56E0F0";
  const active = vm?.activeNode && vm.activeNode !== "core" ? vm.activeNode : null;
  const ids = Object.keys(NODE_POS).filter((k) => k !== "core") as NodeId[];
  const labels = useRef<Partial<Record<NodeId, HTMLDivElement | null>>>({});
  const [hover, setHover] = useState<NodeId | null>(null);
  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 0.6, 9.5], fov: 45 }} dpr={[1, 1.75]} frameloop={paused ? "demand" : "always"} gl={{ antialias: true, powerPreference: "low-power" }}>
        <color attach="background" args={["#05070B"]} />
        <fog attach="fog" args={["#05070B", 9, 20]} />
        <SceneLighting />
        <AegisCore tint={tint} paused={paused} />
        {ids.map((id) => (
          <ConnectionLine key={`l-${id}`} to={id} active={active === id} />
        ))}
        {ids.map((id) => (
          <SceneNode key={id} id={id} active={active === id} selected={selected === id} onSelect={onSelect} onHover={setHover} />
        ))}
        <ProductNodes products={products} />
        <DataParticles to={active} eventKey={vm?.lastEvent?.seq ?? 0} paused={paused} />
        <CameraRig resetKey={resetKey} paused={paused} />
        <LabelProjector labels={labels} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {(Object.keys(NODE_POS) as NodeId[]).map((id) => {
          const status = statusFor(id, vm);
          return (
            <div
              key={id}
              ref={(el) => {
                labels.current[id] = el;
              }}
              className="absolute left-0 top-0 whitespace-nowrap rounded border border-line bg-bg/80 px-1.5 py-0.5 text-center font-mono text-[10px] text-fg"
            >
              {NODE_META[id].label}
              {(hover === id || selected === id) && status && <div className="text-[9px] text-muted">{status}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
