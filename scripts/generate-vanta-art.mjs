/**
 * Generates VANTA's procedural landing-page art into public/vanta/ (SVG → WebP via sharp).
 * Deterministic: the same seed always produces the same images. Re-run with `node scripts/generate-vanta-art.mjs`.
 * Nothing here depicts a real transaction; the page labels the trust-gate composition as illustrative.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "vanta");
const C = { bg: "#050608", bg2: "#0b0d12", line: "#1a1e27", fg: "#f2eee6", muted: "#8b93a2", cyan: "#6fe3ee", ice: "#b8dcff", violet: "#9d8cf2", amber: "#f2b45a", red: "#ff5d6c" };
const MONO = "DejaVu Sans Mono, Menlo, monospace";

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Shared backdrop: graphite gradient, hairline grid, a soft key light and a vignette. */
function frame(w, h, { light = [0.62, 0.42], tint = C.cyan, body, label, index, border = true }) {
  const grid = [];
  for (let x = 0; x <= w; x += 40) grid.push(`<path d="M${x} 0V${h}"/>`);
  for (let y = 0; y <= h; y += 40) grid.push(`<path d="M0 ${y}H${w}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
    <radialGradient id="key" cx="${light[0]}" cy="${light[1]}" r="0.6"><stop offset="0" stop-color="${tint}" stop-opacity="0.22"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></radialGradient>
    <radialGradient id="dot" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8ecf2"/><stop offset="0.45" stop-color="#7d8696"/><stop offset="0.7" stop-color="#d9dee6"/><stop offset="1" stop-color="#3a404c"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#base)"/>
  <g stroke="${C.cyan}" stroke-opacity="0.045" stroke-width="1">${grid.join("")}</g>
  <rect width="${w}" height="${h}" fill="url(#key)"/>
  ${body}
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  ${border ? `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="none" stroke="${C.ice}" stroke-opacity="0.28" stroke-width="3"/>` : ""}
  ${label ? `<g font-family="${MONO}" font-size="${Math.round(h * 0.03)}" letter-spacing="4" fill="${C.muted}">
    <text x="${w * 0.05}" y="${h * 0.09}">${index ?? ""}</text>
    <text x="${w * 0.05 + h * 0.08}" y="${h * 0.09}" fill="${C.fg}" fill-opacity="0.85">${label}</text>
  </g>
  <path d="M${w * 0.05} ${h * 0.115}H${w * 0.16}" stroke="${tint}" stroke-opacity="0.7" stroke-width="2"/>` : ""}
</svg>`;
}

const W = 960;
const H = 640;

function scout() {
  const r = rng(11);
  const cx = W * 0.6, cy = H * 0.56;
  const rings = [70, 140, 210, 280].map((rad) => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${C.ice}" stroke-opacity="${0.22 - rad / 2000}"/>`).join("");
  const sweep = `<path d="M${cx} ${cy} L${cx + 300} ${cy - 40} A300 300 0 0 0 ${cx + 210} ${cy - 215}Z" fill="${C.cyan}" fill-opacity="0.10"/><path d="M${cx} ${cy} L${cx + 300} ${cy - 40}" stroke="${C.cyan}" stroke-opacity="0.8" stroke-width="2"/>`;
  const dots = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 50 + r() * 240, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
    const hot = i % 5 === 0;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${hot ? 16 : 9}" fill="url(#dot)" opacity="${hot ? 0.9 : 0.35}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${hot ? 3.5 : 2}" fill="${hot ? C.cyan : C.ice}"/>`);
    if (hot) dots.push(`<rect x="${(x + 14).toFixed(1)}" y="${(y - 12).toFixed(1)}" width="74" height="24" rx="3" fill="${C.bg2}" fill-opacity="0.8" stroke="${C.cyan}" stroke-opacity="0.45"/><path d="M${(x + 22).toFixed(1)} ${y.toFixed(1)}h40" stroke="${C.fg}" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>`);
  }
  return frame(W, H, { body: rings + sweep + dots.join(""), label: "SCOUT · DISCOVER", index: "01" });
}

function risk() {
  const r = rng(23);
  const cells = [];
  const cols = 14, rows = 8, size = 34, gap = 10, ox = W * 0.2, oy = H * 0.22;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const v = r();
      const px = ox + x * (size + gap), py = oy + y * (size + gap);
      if (v < 0.5) cells.push(`<rect x="${px}" y="${py}" width="${size}" height="${size}" rx="3" fill="${C.cyan}" fill-opacity="${0.12 + v * 0.5}"/>`);
      else if (v < 0.72) cells.push(`<rect x="${px}" y="${py}" width="${size}" height="${size}" rx="3" fill="${C.amber}" fill-opacity="0.35"/>`);
      else if (v < 0.78) cells.push(`<rect x="${px}" y="${py}" width="${size}" height="${size}" rx="3" fill="${C.red}" fill-opacity="0.45"/>`);
      else cells.push(`<rect x="${px + 0.5}" y="${py + 0.5}" width="${size - 1}" height="${size - 1}" rx="3" fill="none" stroke="${C.muted}" stroke-opacity="0.45" stroke-dasharray="3 4"/>`);
    }
  let d = `M${ox} ${H * 0.86}`;
  for (let i = 1; i <= 60; i++) d += ` L${ox + i * ((cols * (size + gap)) / 60)} ${H * 0.86 - Math.abs(Math.sin(i * 0.45) * 26 + (r() - 0.5) * 20)}`;
  const legend = `<g font-family="${MONO}" font-size="15" letter-spacing="2" fill="${C.muted}"><rect x="${ox}" y="${H * 0.92}" width="12" height="12" fill="${C.cyan}" fill-opacity="0.5"/><text x="${ox + 20}" y="${H * 0.92 + 11}">VERIFIED</text><rect x="${ox + 140}" y="${H * 0.92}" width="12" height="12" fill="${C.amber}" fill-opacity="0.5"/><text x="${ox + 160}" y="${H * 0.92 + 11}">UNCERTAIN</text><rect x="${ox + 300.5}" y="${H * 0.92 + 0.5}" width="11" height="11" fill="none" stroke="${C.muted}" stroke-dasharray="2 2"/><text x="${ox + 320}" y="${H * 0.92 + 11}">UNKNOWN ≠ SAFE</text></g>`;
  return frame(W, H, { light: [0.4, 0.5], body: cells.join("") + `<path d="${d}" fill="none" stroke="${C.ice}" stroke-opacity="0.7" stroke-width="2"/>` + legend, label: "RISK · ASSESS", index: "02" });
}

function optimizer() {
  const r = rng(37);
  const ox = W * 0.14, oy = H * 0.84, aw = W * 0.74, ah = H * 0.62;
  const axes = `<path d="M${ox} ${oy - ah}V${oy}H${ox + aw}" fill="none" stroke="${C.muted}" stroke-opacity="0.6"/><g font-family="${MONO}" font-size="14" letter-spacing="3" fill="${C.muted}"><text x="${ox + aw - 60}" y="${oy + 28}">PRICE</text><text x="${ox - 10}" y="${oy - ah - 14}">DELIVERY</text></g>`;
  const budget = ox + aw * 0.7;
  const band = `<rect x="${budget}" y="${oy - ah}" width="${ox + aw - budget}" height="${ah}" fill="${C.violet}" fill-opacity="0.06"/><path d="M${budget} ${oy - ah}V${oy}" stroke="${C.violet}" stroke-opacity="0.7" stroke-dasharray="6 6"/><text x="${budget + 10}" y="${oy - ah + 22}" font-family="${MONO}" font-size="13" letter-spacing="2" fill="${C.violet}">BUDGET CAP</text>`;
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const x = ox + 20 + r() * (aw - 40), y = oy - 20 - r() * (ah - 40);
    pts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${x > budget ? C.muted : C.ice}" fill-opacity="${x > budget ? 0.3 : 0.55}"/>`);
  }
  const frontier = `<path d="M${ox + 30} ${oy - ah + 40} C ${ox + aw * 0.2} ${oy - ah * 0.3}, ${ox + aw * 0.45} ${oy - ah * 0.12}, ${ox + aw * 0.68} ${oy - 30}" fill="none" stroke="${C.cyan}" stroke-width="2.5"/>`;
  const pick = `<circle cx="${ox + aw * 0.28}" cy="${oy - ah * 0.36}" r="22" fill="none" stroke="${C.cyan}" stroke-opacity="0.8"/><circle cx="${ox + aw * 0.28}" cy="${oy - ah * 0.36}" r="7" fill="${C.cyan}"/><circle cx="${ox + aw * 0.28}" cy="${oy - ah * 0.36}" r="44" fill="url(#dot)" opacity="0.25"/>`;
  return frame(W, H, { light: [0.3, 0.45], tint: C.ice, body: band + axes + pts.join("") + frontier + pick, label: "OPTIMIZER · COMPARE", index: "03" });
}

function policy() {
  const cx = W * 0.5, cy = H * 0.55;
  const hex = (rad) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`; }).join(" ");
  const shells = [190, 150, 110].map((rad, i) => `<polygon points="${hex(rad)}" fill="${i === 2 ? C.cyan : "none"}" fill-opacity="0.06" stroke="${i === 0 ? "url(#chrome)" : C.ice}" stroke-opacity="${0.8 - i * 0.2}" stroke-width="${i === 0 ? 3 : 1.2}"/>`).join("");
  const rules = [];
  for (let i = 0; i < 7; i++) {
    const y = H * 0.24 + i * 44, pass = i !== 4;
    rules.push(`<path d="M${W * 0.06} ${y}H${cx - 200}" stroke="${C.fg}" stroke-opacity="0.18"/><path d="M${cx + 200} ${y}H${W * 0.94}" stroke="${pass ? C.cyan : C.amber}" stroke-opacity="${pass ? 0.55 : 0.8}" stroke-width="${pass ? 1.5 : 2}"/>`);
    rules.push(pass ? `<path d="M${W * 0.9} ${y - 6}l6 6 12-12" fill="none" stroke="${C.cyan}" stroke-width="2"/>` : `<path d="M${W * 0.9} ${y - 7}l12 12M${W * 0.9 + 12} ${y - 7}l-12 12" stroke="${C.amber}" stroke-width="2"/>`);
  }
  const bar = `<path d="M${cx} ${cy - 120}V${cy + 120}" stroke="${C.cyan}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="10" fill="${C.cyan}"/><circle cx="${cx}" cy="${cy}" r="60" fill="url(#dot)" opacity="0.25"/>`;
  return frame(W, H, { light: [0.5, 0.55], body: rules.join("") + shells + bar, label: "POLICY GUARD · GOVERN", index: "04" });
}

function human() {
  const cx = W * 0.32, cy = H * 0.56;
  const arcs = Array.from({ length: 9 }, (_, i) => `<path d="M${cx - 20 - i * 14} ${cy + 60} A${30 + i * 14} ${36 + i * 16} 0 1 1 ${cx + 20 + i * 14} ${cy + 60}" fill="none" stroke="${C.ice}" stroke-opacity="${0.55 - i * 0.045}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${i % 2 ? "40 10" : "none"}"/>`).join("");
  const card = `<g transform="translate(${W * 0.5} ${H * 0.24})"><rect width="${W * 0.42}" height="${H * 0.56}" rx="10" fill="${C.bg2}" fill-opacity="0.9" stroke="${C.line}"/><rect width="${W * 0.42}" height="${H * 0.56}" rx="10" fill="none" stroke="${C.cyan}" stroke-opacity="0.35"/>
    <g font-family="${MONO}" font-size="14" letter-spacing="3" fill="${C.muted}"><text x="24" y="40">EXACT SNAPSHOT</text><text x="24" y="${H * 0.56 - 24}" fill="${C.violet}">ILLUSTRATIVE</text></g>
    ${[0, 1, 2, 3].map((i) => `<path d="M24 ${80 + i * 42}H${W * 0.42 - 24 - (i % 2) * 80}" stroke="${C.fg}" stroke-opacity="${0.35 - i * 0.05}" stroke-width="10" stroke-linecap="round"/>`).join("")}
    <rect x="24" y="${H * 0.56 - 100}" width="${W * 0.42 - 48}" height="44" rx="6" fill="${C.cyan}" fill-opacity="0.14" stroke="${C.cyan}" stroke-opacity="0.7"/></g>`;
  return frame(W, H, { light: [0.32, 0.5], tint: C.ice, body: arcs + card, label: "HUMAN · AUTHORIZE", index: "05" });
}

function payment() {
  const y = H * 0.55;
  const xs = [W * 0.16, W * 0.38, W * 0.62, W * 0.84];
  const names = ["ORDER", "BUYER", "VERIFY", "CAPTURE"];
  const lane = `<path d="M${xs[0]} ${y}H${xs[3]}" stroke="${C.ice}" stroke-opacity="0.25" stroke-width="2"/><path d="M${xs[0]} ${y}H${xs[2]}" stroke="${C.cyan}" stroke-width="2.5"/>`;
  const nodes = xs.map((x, i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 26 : 20}" fill="${C.bg2}" stroke="${i === 3 ? "url(#chrome)" : C.cyan}" stroke-width="${i === 3 ? 3 : 2}"/><circle cx="${x}" cy="${y}" r="5" fill="${i === 3 ? C.fg : C.cyan}"/><text x="${x}" y="${y + 62}" text-anchor="middle" font-family="${MONO}" font-size="15" letter-spacing="3" fill="${C.muted}">${names[i]}</text>`).join("");
  const gates = [xs[1] + (xs[2] - xs[1]) / 2, xs[2] + (xs[3] - xs[2]) / 2].map((x) => `<rect x="${x - 7}" y="${y - 46}" width="14" height="92" rx="3" fill="${C.bg}" stroke="${C.violet}" stroke-opacity="0.8"/>`).join("");
  const env = `<rect x="${W * 0.05}" y="${H * 0.78}" width="200" height="34" rx="4" fill="none" stroke="${C.amber}" stroke-opacity="0.6"/><text x="${W * 0.05 + 16}" y="${H * 0.78 + 23}" font-family="${MONO}" font-size="14" letter-spacing="3" fill="${C.amber}">SANDBOX ONLY</text>`;
  return frame(W, H, { light: [0.62, 0.5], body: lane + gates + nodes + env, label: "PAYMENT AGENT · TRANSACT", index: "06" });
}

/** Full-bleed final panel: agents converge into the Trust Core, one gated lane leaves toward checkout. */
function trustGate() {
  const w = 1920, h = 1080, cx = w / 2, cy = h * 0.52;
  const r = rng(91);
  const agents = [
    [cx - 560, cy - 250, "SCOUT"],
    [cx - 640, cy + 40, "RISK"],
    [cx - 500, cy + 280, "OPTIMIZER"],
    [cx - 260, cy - 330, "POLICY"],
  ];
  const links = agents.map(([x, y]) => `<path d="M${x} ${y} Q ${(x + cx) / 2} ${y} ${cx - 120} ${cy}" fill="none" stroke="${C.ice}" stroke-opacity="0.35" stroke-width="1.5"/>`).join("");
  const nodes = agents.map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="40" fill="url(#dot)" opacity="0.25"/><circle cx="${x}" cy="${y}" r="9" fill="${C.cyan}"/><text x="${x}" y="${y - 26}" text-anchor="middle" font-family="${MONO}" font-size="20" letter-spacing="5" fill="${C.muted}">${n}</text>`).join("");
  const rings = [260, 200, 150].map((rad, i) => `<ellipse cx="${cx}" cy="${cy}" rx="${rad}" ry="${rad * (i === 1 ? 0.34 : 1)}" transform="rotate(${[-8, -24, 0][i]} ${cx} ${cy})" fill="none" stroke="${i === 0 ? "url(#chrome)" : i === 1 ? C.ice : C.cyan}" stroke-opacity="${[0.7, 0.55, 0.35][i]}" stroke-width="${[2.5, 1.5, 1][i]}"/>`).join("");
  const core = `<circle cx="${cx}" cy="${cy}" r="240" fill="url(#dot)" opacity="0.18"/><path d="M${cx} ${cy - 110} L${cx + 80} ${cy} L${cx} ${cy + 110} L${cx - 80} ${cy}Z" fill="${C.cyan}" fill-opacity="0.10" stroke="url(#chrome)" stroke-width="3"/><path d="M${cx} ${cy - 110}V${cy + 110}M${cx - 80} ${cy}H${cx + 80}" stroke="${C.cyan}" stroke-opacity="0.5"/><circle cx="${cx}" cy="${cy}" r="12" fill="${C.cyan}"/>`;
  const lane = `<path d="M${cx + 120} ${cy}H${cx + 700}" stroke="${C.cyan}" stroke-width="3"/><rect x="${cx + 330}" y="${cy - 70}" width="18" height="140" rx="4" fill="${C.bg}" stroke="${C.violet}"/><rect x="${cx + 500}" y="${cy - 70}" width="18" height="140" rx="4" fill="${C.bg}" stroke="${C.violet}"/><circle cx="${cx + 720}" cy="${cy}" r="34" fill="${C.bg2}" stroke="url(#chrome)" stroke-width="3"/><circle cx="${cx + 720}" cy="${cy}" r="8" fill="${C.fg}"/>
    <g font-family="${MONO}" font-size="18" letter-spacing="4" fill="${C.muted}"><text x="${cx + 339}" y="${cy - 90}" text-anchor="middle">POLICY</text><text x="${cx + 509}" y="${cy - 90}" text-anchor="middle">HUMAN</text><text x="${cx + 720}" y="${cy + 72}" text-anchor="middle">CHECKOUT</text></g>`;
  const stars = Array.from({ length: 120 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(r() * 1.4 + 0.3).toFixed(2)}" fill="${C.fg}" fill-opacity="${(r() * 0.35).toFixed(2)}"/>`).join("");
  // The page overlays an "illustrative" label on this panel, so none is baked in.
  return frame(w, h, { light: [0.5, 0.52], border: false, body: stars + links + rings + core + lane + nodes });
}

const jobs = { "agent-scout": scout, "agent-risk": risk, "agent-optimizer": optimizer, "agent-policy": policy, "agent-human": human, "agent-payment": payment, "trust-gate": trustGate };

await mkdir(OUT, { recursive: true });
for (const [name, make] of Object.entries(jobs)) {
  const file = path.join(OUT, `${name}.webp`);
  const info = await sharp(Buffer.from(make())).webp({ quality: 82 }).toFile(file);
  console.log(`${name}.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`);
}
