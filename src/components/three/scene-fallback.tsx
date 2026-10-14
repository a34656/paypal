"use client";
/** 2D SVG fallback for reduced motion, low-power devices, lost context or no WebGL. Same view-model, same node states. */
import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";
import { NODE_META_2D, nodeState, type AgentNode, type NodeVisualState } from "./node-meta";
import type { ProductMarker } from "./scene";
import { statusText } from "./scene-status";

const POS: Record<AgentNode | "core" | "gate", [number, number]> = {
  core: [320, 190],
  scout: [110, 140],
  risk: [225, 60],
  optimizer: [415, 60],
  policy: [530, 140],
  gate: [505, 235],
  paypal: [430, 295],
};
const AGENTS: AgentNode[] = ["scout", "risk", "optimizer", "policy", "paypal"];
const COLOR: Record<NodeVisualState, string> = { idle: "#3A4150", active: "#6FE3EE", done: "#B8DCFF", warning: "#F2B45A", blocked: "#FF5D6C", success: "#52D3A3" };
const decisionColor = (d: string | null) => (d === "BLOCK" ? "#FF5D6C" : d === "REQUIRE_APPROVAL" ? "#F2B45A" : d === "ALLOW_CHECKOUT" ? "#52D3A3" : "#5B6371");

export function SceneFallback({ vm, products = [], selected, onSelect }: { vm: MissionViewModel | null; products?: ProductMarker[]; selected: NodeId | null; onSelect: (id: NodeId) => void }) {
  const states = Object.fromEntries(AGENTS.map((id) => [id, nodeState(id, vm)])) as Record<AgentNode, NodeVisualState>;
  const gateLit = (vm?.approvals ?? 0) > 0;
  const chain: [keyof typeof POS, keyof typeof POS][] = [
    ["scout", "risk"],
    ["risk", "optimizer"],
    ["optimizer", "policy"],
    ["policy", "gate"],
    ["gate", "paypal"],
  ];
  const ranked = products.filter((p) => p.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const others = products.filter((p) => p.rank == null);
  return (
    <svg viewBox="0 0 640 380" className="h-full w-full" role="img" aria-label={`AEGIS agent network. ${AGENTS.map((a) => `${NODE_META_2D[a].label}: ${states[a]}`).join(", ")}.`}>
      {chain.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={POS[a][0]} y1={POS[a][1]} x2={POS[b][0]} y2={POS[b][1]} stroke={b === "gate" || a === "gate" ? (gateLit ? "#52D3A3" : "#272C37") : "#272C37"} strokeDasharray={b === "gate" || a === "gate" ? "4 4" : undefined} />
      ))}
      {AGENTS.map((id) => (
        <line key={`s-${id}`} x1={POS.core[0]} y1={POS.core[1]} x2={POS[id][0]} y2={POS[id][1]} stroke={states[id] === "idle" ? "#1A1E27" : COLOR[states[id]]} strokeOpacity={0.7} strokeWidth={vm?.activeNode === id ? 1.6 : 1} />
      ))}
      {/* Discovered candidates near Scout; ranked ones beside the Optimizer. */}
      {others.slice(0, 8).map((p, i) => (
        <rect key={p.id} x={40 + i * 16} y={205} width="9" height="9" fill={decisionColor(p.decision)} opacity={ranked.length ? 0.45 : 0.85}>
          <title>{`${p.label}: ${p.decision ?? "pending"}`}</title>
        </rect>
      ))}
      {ranked.slice(0, 6).map((p, i) => (
        <g key={p.id}>
          <rect x={385 + i * 18} y={14} width="11" height="11" fill={decisionColor(p.decision)} stroke={p.rank === 1 ? "#6FE3EE" : "none"}>
            <title>{`#${p.rank} ${p.label}: ${p.decision ?? "pending"}`}</title>
          </rect>
        </g>
      ))}
      <g>
        <circle cx={POS.core[0]} cy={POS.core[1]} r={30} fill="none" stroke="#6FE3EE" strokeOpacity="0.35" />
        <path d={`M${POS.core[0]} ${POS.core[1] - 16} l14 16 -14 16 -14 -16Z`} fill="rgb(111 227 238 / 0.1)" stroke="#F2EEE6" strokeOpacity="0.7" />
        <circle cx={POS.core[0]} cy={POS.core[1]} r={3.5} fill="#6FE3EE" />
        <text x={POS.core[0]} y={POS.core[1] + 50} textAnchor="middle" fill="#8B93A2" fontSize="9" letterSpacing="2" fontFamily="var(--font-mono)">
          AEGIS CORE
        </text>
      </g>
      <g>
        <rect x={POS.gate[0] - 6} y={POS.gate[1] - 6} width="12" height="12" transform={`rotate(45 ${POS.gate[0]} ${POS.gate[1]})`} fill={gateLit ? "#52D3A3" : "#3A4150"} />
        <text x={POS.gate[0] + 14} y={POS.gate[1] + 3} fill={gateLit ? "#52D3A3" : "#5B6371"} fontSize="8" letterSpacing="1.6" fontFamily="var(--font-mono)">
          HUMAN GATE
        </text>
      </g>
      {AGENTS.map((id) => {
        const [x, y] = POS[id];
        const st = states[id];
        const status = statusText(id, vm);
        return (
          <g
            key={id}
            role="button"
            tabIndex={0}
            aria-label={`${NODE_META_2D[id].label}: ${status ?? "idle"}`}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(id)}
            className="cursor-pointer focus:outline-none"
          >
            <circle cx={x} cy={y} r={16} fill="#0B0D12" stroke={COLOR[st]} strokeWidth={selected === id || st === "active" ? 2.2 : 1.2} />
            <circle cx={x} cy={y} r={4} fill={st === "idle" ? "#3A4150" : COLOR[st]} />
            <text x={x} y={y + 32} textAnchor="middle" fill={st === "idle" ? "#5B6371" : "#F2EEE6"} fontSize="10" letterSpacing="1.8" fontFamily="var(--font-mono)">
              {NODE_META_2D[id].label.toUpperCase()}
            </text>
            {status && (
              <text x={x} y={y + 44} textAnchor="middle" fill={COLOR[st]} fontSize="8.5" letterSpacing="1" fontFamily="var(--font-mono)">
                {status}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
