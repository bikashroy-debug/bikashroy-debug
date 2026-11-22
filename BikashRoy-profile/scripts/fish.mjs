// Draws your GitHub contribution graph as a pond, with a fish swimming through it.
//
//   node scripts/fish.mjs [output.svg] [--sample]
//
// Env: GH_LOGIN (GitHub username), GH_TOKEN (token with read access to public data)
// --sample skips the API call and draws made-up data (used for the first preview).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const sample = args.includes("--sample");
const outPath = args.find((a) => !a.startsWith("--")) ?? "assets/fish-contribution.svg";
const login = process.env.GH_LOGIN || "BikashRoy";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

// ---------- data ----------

async function fetchCalendar() {
  if (!token) throw new Error("Set GH_TOKEN (or GITHUB_TOKEN) to read your contributions.");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "fish-contribution-graph",
    },
    body: JSON.stringify({
      query: `query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks { contributionDays { contributionCount weekday } }
            }
          }
        }
      }`,
      variables: { login },
    }),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}. Try a personal access token.`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub API error: ${JSON.stringify(json.errors)}`);
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) =>
      w.contributionDays.map((d) => ({ count: d.contributionCount, weekday: d.weekday }))
    ),
  };
}

function sampleCalendar() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const busy = Math.sin(w / 5) * 0.5 + 0.5;
    const days = [];
    for (let d = 0; d < 7; d++) {
      const active = rnd() < 0.3 + busy * 0.4;
      days.push({ weekday: d, count: active ? 1 + Math.floor(rnd() * (3 + busy * 9)) : 0 });
    }
    weeks.push(days);
  }
  return { total: 0, weeks };
}

// ---------- layout ----------

const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;
const PAD_X = 32;
const GRID_Y = 50;
const H = 200;
const DUR = 16; // seconds for one crossing

const LEVELS = ["#12324f", "#1f6f8b", "#2aa5b3", "#4fd1c5", "#9ff5e0"];
const GLOW = { empty: "#3a8fbf", filled: "#e8fffb" };

const cal = sample ? sampleCalendar() : await fetchCalendar();
const cols = cal.weeks.length;
const W = PAD_X * 2 + cols * PITCH - GAP;
const max = Math.max(1, ...cal.weeks.flat().map((d) => d.count));
const levelOf = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));

// ---------- the fish's route ----------

const gridMid = GRID_Y + (7 * PITCH - GAP) / 2;
const AMP = 28;
const WAVELENGTH = 320;
const X0 = -50;
const X1 = W + 50;
const pts = [];
for (let x = X0; x <= X1; x += 6) {
  pts.push([x, gridMid + AMP * Math.sin(((x - X0) / WAVELENGTH) * 2 * Math.PI)]);
}
const cum = [0];
for (let i = 1; i < pts.length; i++) {
  cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
}
const routeLength = cum[cum.length - 1];
const route = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");

// where (as a fraction of the crossing) the fish passes a given x, and how high it is there
function fishAt(x) {
  const i = Math.max(0, pts.findIndex((p) => p[0] >= x));
  return { f: cum[i] / routeLength, y: pts[i][1] };
}

// ---------- cells ----------

let cellSvg = "";
cal.weeks.forEach((week, wi) => {
  for (const day of week) {
    const x = PAD_X + wi * PITCH;
    const y = GRID_Y + day.weekday * PITCH;
    const level = levelOf(day.count);
    const base = LEVELS[level];
    const near = fishAt(x + CELL / 2);
    const lit = Math.abs(y + CELL / 2 - near.y) <= 19;
    if (!lit) {
      cellSvg += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${base}"/>`;
      continue;
    }
    const glow = level === 0 ? GLOW.empty : GLOW.filled;
    const a = Math.max(0, near.f - 0.03);
    const c = Math.min(1, near.f + 0.08);
    cellSvg +=
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${base}">` +
      `<animate attributeName="fill" dur="${DUR}s" repeatCount="indefinite" ` +
      `values="${base};${base};${glow};${base};${base}" ` +
      `keyTimes="0;${a.toFixed(4)};${near.f.toFixed(4)};${c.toFixed(4)};1"/></rect>`;
  }
});

// ---------- water, bubbles, legend ----------

const WAVE = 80;
function wave(yMid, amp) {
  let d = `M${-WAVE},${yMid}`;
  for (let x = -WAVE, i = 0; x < W + WAVE; x += WAVE / 2, i++) {
    d += ` Q${x + WAVE / 4},${yMid + (i % 2 === 0 ? -amp : amp)} ${x + WAVE / 2},${yMid}`;
  }
  return d + ` L${W + WAVE},${H} L${-WAVE},${H} Z`;
}

const bubbles = [
  [0.06, 2.5, 9], [0.17, 1.8, 7], [0.31, 3, 11], [0.44, 2, 8],
  [0.58, 2.8, 10], [0.71, 1.6, 7], [0.84, 2.4, 12], [0.95, 2, 9],
]
  .map(
    ([fx, r, dur], i) =>
      `<circle cx="${Math.round(fx * W)}" cy="${H}" r="${r}" fill="none" stroke="#bfe8ff" stroke-opacity=".55">` +
      `<animate attributeName="cy" values="${H - 12};34" dur="${dur}s" begin="-${i * 1.7}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;.9;0" dur="${dur}s" begin="-${i * 1.7}s" repeatCount="indefinite"/></circle>`
  )
  .join("");

const legendX = W - PAD_X - (5 * PITCH - GAP) - 34;
const legend =
  `<text x="${legendX - 6}" y="${H - 16}" text-anchor="end" fill="#7fb7d9" font-size="11">Less</text>` +
  LEVELS.map(
    (c, i) => `<rect x="${legendX + i * PITCH}" y="${H - 26}" width="${CELL}" height="${CELL}" rx="3" fill="${c}"/>`
  ).join("") +
  `<text x="${legendX + 5 * PITCH + 2}" y="${H - 16}" fill="#7fb7d9" font-size="11">More</text>`;

const caption = sample
  ? "Sample pond. Run the workflow to load your real contributions."
  : `${cal.total.toLocaleString("en-US")} contributions in the last year`;

// ---------- the fish ----------

const fish = `
<g>
  <animateMotion dur="${DUR}s" repeatCount="indefinite" rotate="auto" path="${route}"/>
  <g transform="scale(.85)">
    <g>
      <animateTransform attributeName="transform" type="rotate" values="-16 -12 0;16 -12 0;-16 -12 0" dur=".55s" repeatCount="indefinite"/>
      <path d="M-12,0 L-31,-12 Q-25,0 -31,12 Z" fill="#ff7a45"/>
    </g>
    <path d="M-3,-10 L4,-18 L11,-9 Z" fill="#ff7a45"/>
    <path d="M-15,0 C-8,-14 15,-14 23,0 C15,14 -8,14 -15,0 Z" fill="#ffa24a"/>
    <path d="M-9,4 C-2,11 12,11 19,3 C12,8 -2,8 -9,4 Z" fill="#ffd9a8"/>
    <path d="M2,-10 Q7,0 2,10" fill="none" stroke="#ffe3bd" stroke-width="2" stroke-linecap="round"/>
    <circle cx="15" cy="-2.5" r="2.6" fill="#10243f"/>
    <circle cx="15.8" cy="-3.3" r=".9" fill="#fff"/>
  </g>
</g>`;

// ---------- assemble ----------

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif">
<title id="t">Contribution pond</title>
<desc id="d">A fish swims across ${login}'s GitHub contribution graph, lighting up the squares it passes.</desc>
<defs>
  <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d3157"/>
    <stop offset="1" stop-color="#06172b"/>
  </linearGradient>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="16"/></clipPath>
</defs>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#water)"/>
  <path d="${wave(26, 5)}" fill="#7cc4ff" fill-opacity=".10">
    <animateTransform attributeName="transform" type="translate" from="0 0" to="${WAVE} 0" dur="6s" repeatCount="indefinite"/>
  </path>
  <path d="${wave(32, 4)}" fill="#7cc4ff" fill-opacity=".08">
    <animateTransform attributeName="transform" type="translate" from="0 0" to="-${WAVE} 0" dur="9s" repeatCount="indefinite"/>
  </path>
  ${cellSvg}
  ${bubbles}
  ${fish}
  <text x="${PAD_X}" y="${H - 16}" fill="#7fb7d9" font-size="12">${caption}</text>
  ${legend}
</g>
</svg>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, svg);
console.log(`Wrote ${outPath} (${(svg.length / 1024).toFixed(1)} KB, ${cols} weeks${sample ? ", sample data" : ""})`);
