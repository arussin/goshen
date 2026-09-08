import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

// Reuse the original companion artwork in a 440 x 280 store promotional tile.
// This is brand artwork, not a screenshot or a representation of a live chat.
const root = new URL('../', import.meta.url);
const context = vm.createContext({});
vm.runInContext(await readFile(new URL('extension/companion.js', root), 'utf8'), context);
const art = context.GoshenCompanion.create().frame({ now: 0, motion: false }).art;
const pixels = art.split('\n').flatMap((row, y) => Array.from(row).flatMap((symbol, x) => {
  if (symbol === ' ') return [];
  const height = symbol === '▀' ? 4.5 : 9;
  return [`<rect x="${230 + x * 6}" y="${73 + y * 9}" width="6" height="${height}" fill="${symbol === '░' ? '#7e6037' : '#efb866'}"/>`];
})).join('\n');
const bars = [48, 74, 42, 90, 66].map((width, i) => `<rect x="44" y="${101 + i * 17}" width="${width}" height="4" fill="${i === 1 ? '#a4d796' : '#7b8866'}"/>`).join('\n');
const lights = Array.from({ length: 10 }, (_, i) => `<rect x="${44 + i * 10}" y="197" width="5" height="10" fill="${i < 6 ? '#efb866' : '#343b2c'}"/>`).join('\n');
const tubes = [54, 90, 126].map(x => `<rect x="${x}" y="232" width="13" height="19" rx="6" fill="#14180f" stroke="#526040"/><path d="M${x + 4} 247v-9m5 9v-9" stroke="#e99147" stroke-width="2"/>`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280" role="img" aria-label="Goshen Terminal promotional artwork with HOPPER and phosphor instrument panels">
<defs>
  <radialGradient id="warm"><stop stop-color="#51452a" stop-opacity=".72"/><stop offset="1" stop-color="#10150e" stop-opacity="0"/></radialGradient>
  <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".28"/></pattern>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
<rect width="440" height="280" fill="#10140e"/>
<ellipse cx="306" cy="164" rx="225" ry="181" fill="url(#warm)"/>
<rect x="12.5" y="12.5" width="415" height="255" rx="3" fill="none" stroke="#4d583d"/>
<path d="M26 61.5h388" stroke="#4d583d"/>
<text x="28" y="43" font-family="Consolas,Liberation Mono,monospace" font-size="20" font-weight="700" letter-spacing="1.5" fill="#efb866">GOSHEN TERMINAL</text>
<circle cx="378" cy="36" r="3" fill="#a4d796"/><circle cx="391" cy="36" r="3" fill="#efb866"/><circle cx="404" cy="36" r="3" fill="#596348"/>
<rect x="29" y="79" width="152" height="139" fill="#0c100b" stroke="#4d583d"/>
${bars}
<path d="M44 182h122" stroke="#3b4830"/>
${lights}
<rect x="198" y="79" width="212" height="139" fill="#0c100b" stroke="#4d583d"/>
<g opacity=".55" filter="url(#glow)">${pixels}</g>
<g>${pixels}</g>
<path d="M219 203h24l5-4 4 8 5-4h35l4-6 5 9 4-3h26l3-4 5 7 4-3h47" fill="none" stroke="#a4d796"/>
${tubes}
<path d="M209 238h200m-200 6h156m-156 6h92" stroke="#36442b" stroke-width="2"/>
<rect x="28" y="64" width="384" height="191" fill="url(#scan)"/>
</svg>\n`;
await writeFile(new URL('docs/images/store-promo.svg', root), svg);
console.log('Generated docs/images/store-promo.svg (440 x 280).');
