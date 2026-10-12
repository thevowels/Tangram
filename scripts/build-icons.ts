// Generates the favicon, Apple touch icon and social preview image into public/.
// Usage: npx tsx scripts/build-icons.ts   (re-run if the logo or piece colours change)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PIECES } from "../src/geometry/pieces";

const out = join(import.meta.dirname, "../public");
const BG = "#1a1240";

/** The seven tans in their classic square, turned 45° into a diamond (same as the in-app logo). */
function logo(size: number, x = 0, y = 0, stroke = BG) {
  const c = Math.SQRT2; // centre of the 2√2 square
  const s = size / 4.15; // the diamond spans ~4 units
  const paths = PIECES.map((p) => {
    const pts = p.shape.map(([px, py]) => [px + p.home[0], py + p.home[1]]);
    return `<path d="M${pts.map(([a, b]) => `${a},${b}`).join("L")}Z" fill="${p.color}" stroke="${stroke}" stroke-width="0.06" stroke-linejoin="round"/>`;
  }).join("");
  return `<g transform="translate(${x + size / 2},${y + size / 2}) scale(${s}) rotate(45) translate(${-c},${-c})">${paths}</g>`;
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// favicon: the logo on a transparent background (scales crisply in tabs)
writeFileSync(join(out, "favicon.svg"), svg(64, 64, logo(64)) + "\n");

// Apple touch icon: logo on the app's dark violet, with padding (iOS rounds the corners)
await sharp(Buffer.from(svg(180, 180, `<rect width="180" height="180" fill="${BG}"/>${logo(136, 22, 22)}`)))
  .png()
  .toFile(join(out, "apple-touch-icon.png"));

// social preview (Open Graph / Twitter), 1200×630
const og = svg(
  1200,
  630,
  `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#3a1585"/><stop offset="0.45" stop-color="#2a1670"/><stop offset="1" stop-color="#10215e"/>
    </linearGradient>
    <radialGradient id="pink" cx="0.08" cy="0.02" r="0.7"><stop offset="0" stop-color="#ff4d6d" stop-opacity="0.55"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient>
    <radialGradient id="blue" cx="1" cy="0.35" r="0.65"><stop offset="0" stop-color="#3a86ff" stop-opacity="0.5"/><stop offset="1" stop-color="#3a86ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="purple" cx="0.45" cy="1.05" r="0.7"><stop offset="0" stop-color="#c77dff" stop-opacity="0.45"/><stop offset="1" stop-color="#c77dff" stop-opacity="0"/></radialGradient>
    <linearGradient id="hot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff6b8b"/><stop offset="0.55" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#pink)"/>
  <rect width="1200" height="630" fill="url(#blue)"/>
  <rect width="1200" height="630" fill="url(#purple)"/>
  ${logo(400, 90, 115, "#2a1670")}
  <text x="560" y="290" font-family="system-ui, sans-serif" font-size="112" font-weight="900" fill="url(#hot)">Tangram</text>
  <text x="564" y="360" font-family="system-ui, sans-serif" font-size="36" fill="#f4f0ff" opacity="0.9">Free online tangram puzzles</text>
  <text x="564" y="410" font-family="system-ui, sans-serif" font-size="28" fill="#f4f0ff" opacity="0.7">Drag, rotate and flip seven pieces</text>
  <text x="564" y="450" font-family="system-ui, sans-serif" font-size="28" fill="#f4f0ff" opacity="0.7">to build animals, people and shapes.</text>`,
);
await sharp(Buffer.from(og)).png().toFile(join(out, "og-image.png"));

console.log("Wrote public/favicon.svg, apple-touch-icon.png, og-image.png");
