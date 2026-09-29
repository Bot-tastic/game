// make-codes.mjs — generate one-time gift codes for the garage.
//
// The game runs as static files (GitHub Pages), so there is no server to ask
// whether a code is valid. Instead only a SHA-256 hash of each code is
// shipped in codes.js; the codes themselves never enter the repository, so
// reading the page source does not reveal them. The game remembers which
// hashes it has redeemed in localStorage, which makes each code single-use
// per device (clearing site data resets that — there is no way around it
// without a server).
//
// Run: node tools/make-codes.mjs <out-file> [count-per-reward]
//   Writes the plain codes to <out-file> (keep it OUTSIDE the repo) and adds
//   their hashes to codes.js. Existing hashes are kept, so old codes stay valid.
import { writeFileSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { hashCode, CODES } from "../codes.js";

const out = process.argv[2];
const per = Number(process.argv[3] || 5);
if (!out) {
  console.error("usage: node tools/make-codes.mjs <out-file> [count-per-reward]");
  process.exit(1);
}

// No 0/O, 1/I/L: codes get read aloud and typed on phones.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const newCode = () => `HC-${group()}-${group()}-${group()}`;

const REWARDS = [
  { label: "10.000 Münzen", reward: { coins: 10000 } },
  { label: "50.000 Münzen", reward: { coins: 50000 } },
  { label: "100.000 Münzen", reward: { coins: 100000 } },
  { label: "250.000 Münzen", reward: { coins: 250000 } },
  { label: "1.000.000 Münzen", reward: { coins: 1000000 } },
  { label: "Alle Level freischalten", reward: { unlock: "levels" } },
];

const table = { ...CODES };
const lines = [];
for (const { label, reward } of REWARDS) {
  lines.push(`${label}:`);
  for (let i = 0; i < per; i++) {
    const code = newCode();
    table[await hashCode(code)] = reward;
    lines.push(`  ${code}`);
  }
  lines.push("");
}
writeFileSync(out, lines.join("\n"));

const src = readFileSync(new URL("../codes.js", import.meta.url), "utf8");
const body = Object.entries(table)
  .map(([h, r]) => `  "${h}": ${JSON.stringify(r).replace(/"(\w+)":/g, "$1: ")},`)
  .join("\n");
const next = src.replace(/export const CODES = \{[\s\S]*?\n\};/, `export const CODES = {\n${body}\n};`);
writeFileSync(new URL("../codes.js", import.meta.url), next);
console.log(`${Object.keys(table).length} codes in codes.js; plain codes written to ${out}`);
