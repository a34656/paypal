"use client";
/** 2D SVG fallback for reduced motion, low-power devices, or no WebGL. Same view-model. */
import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";
import { NODE_META_2D } from "./node-meta";
import type { ProductMarker } from "./scene";

const POS: Record<NodeId, [number, number]> = {
  core: [300, 180],
  interpreter: [110, 95],
  scout: [150, 290],
  risk: [300, 50],
  optimizer: [450, 290],
  policy: [490, 95],
  human: [300, 320],
  paypal: [560, 200],
};

export function SceneFallback({ vm, products = [], selected, onSelect }: { vm: MissionViewModel | null; products?: ProductMarker[]; selected: NodeId | null; onSelect: (id: NodeId) => void }) {
  const active = vm?.activeNode ?? null;
  const ids = Object.keys(POS) as NodeId[];
  return (
    <svg viewBox="0 0 640 360" className="h-full w-full" role="img" aria-label={`AEGIS workflow network. Active node: ${active ? NODE_META_2D[active].label : "none"}.`}>
      {ids
        .filter((id) => id !== "core")
        .map((id) => (
          <line key={`l-${id}`} x1={POS.core[0]} y1={POS.core[1]} x2={POS[id][0]} y2={POS[id][1]} stroke={active === id ? NODE_META_2D[id].color : "#263347"} strokeWidth={active === id ? 2 : 1} />
        ))}
      {products.slice(0, 6).map((p, i) => {
        const x = 60 + i * 26;
        const y = 340;
        const c = p.decision === "BLOCK" ? "#FF647C" : p.decision === "REQUIRE_APPROVAL" ? "#F4BB61" : p.decision === "ALLOW_CHECKOUT" ? "#43D9A3" : "#8B9AAF";
        return (
          <g key={p.id}>
            <rect x={x} y={y} width="12" height="12" fill={c} opacity="0.85">
              <title>{`${p.label}: ${p.decision ?? "pending"}`}</title>
            </rect>
          </g>
        );
      })}
      {ids.map((id) => {
        const [x, y] = POS[id];
        const m = NODE_META_2D[id];
        const isActive = active === id;
        return (
          <g
            key={id}
            role="button"
            tabIndex={0}
            aria-label={`${m.label} (${m.kind})${isActive ? ", active" : ""}`}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(id)}
            className="cursor-pointer focus:outline-none"
          >
            <circle cx={x} cy={y} r={id === "core" ? 26 : 15} fill="#0D1420" stroke={m.color} strokeWidth={isActive || selected === id ? 3 : 1.5} />
            {id === "core" && <circle cx={x} cy={y} r={9} fill={m.color} />}
            <text x={x} y={y + (id === "core" ? 44 : 32)} textAnchor="middle" fill="#F3F7FB" fontSize="11" fontFamily="var(--font-mono)">
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
