// codes.js — one-time gift codes, redeemed from the garage.
//
// Only SHA-256 hashes of the codes live here (see tools/make-codes.mjs), so
// the page source does not give them away. A redeemed hash is remembered in
// localStorage: every code works once per device.

const SALT = "hillclimb-gift-v1:";

/** Uppercase, no spaces or dashes: "hc-ab12 cd34" and "HCAB12CD34" match. */
export const normalizeCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function hashCode(code) {
  const bytes = new TextEncoder().encode(SALT + normalizeCode(code));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// hash -> reward: { coins: n } or { unlock: "levels" }
export const CODES = {
  "17058c4ac1dfa1a00f2245458e68eab20f236a1972cf48a191bb381455a65d04": {coins: 10000},
  "afa980d0784af0a2d870064501fd5acef4707be4eb93a1623691e782d24fc027": {coins: 10000},
  "27a9fa781ea6e3a0ffab4cb4a6a3ba6216a3552a8ca84cf4f25e7b7840411fdd": {coins: 10000},
  "8d472a8768caf2805571224d23f06c6756ebd80fd8cfbc677c8df2091d414850": {coins: 10000},
  "dedf72433e4d15f9aa37c83772466ed9696c313bbd0334f1dad6a6dc1118e8fc": {coins: 10000},
  "6f431d994290ed5308144bd30f03cca478c63fbe2596a49d080bfb6dc297f967": {coins: 50000},
  "bee6eadaea931c416e828dd7a62f7b111142b57f19831fc4ac97a75d13d42d45": {coins: 50000},
  "85e359cd92827a837e859768ccf8678ca6b856922f246f367cc9b2f4c9291d5c": {coins: 50000},
  "90ccca7591df3921b341c4377929ccb4b7af18f6127dc667e24ba1f5e630a873": {coins: 50000},
  "219148eba9bdcebad296faea52fe59cbd38cc190e024ea9ccb70d5a5925fd3b3": {coins: 50000},
  "034fe78084b86e9ac95eada6cd16c19b3e079ca6e2c93a198ab75457fcf26af6": {coins: 100000},
  "7cd164ae3a44ed9ee9e7f63f05489e41114dc17a03734403441566927ab3d8f1": {coins: 100000},
  "86252d1f64a24c33f4c07d33252996e1977f7f6e21bc899510fd03d7d2dba8cd": {coins: 100000},
  "b50c5bb9507f4d24490691733533e08afdc502cb9c712457a6367daf53e2ebbf": {coins: 100000},
  "ee108f7b29db3fffaca953f5438719cc07634bbbbeecb2f41267e7f8b3b82cfa": {coins: 100000},
  "407b1de762ebb962c27dcf0b3b4876260e6ee90a59f1e009665bc6ecbbf6e645": {coins: 250000},
  "9cde9da15acd2e66c825078b3181f7df90db5ac085a4893e6a69f40cce57be72": {coins: 250000},
  "6cf71d9ad976d1fe10c324588c23c8ec75695ddf64280638ed83cf8cd56dde53": {coins: 250000},
  "1d9ce72384e8d6655116ec0817170607b504e3c2b08029faf6a817f4dd52a0ca": {coins: 250000},
  "8301c21d4124a513052bc4131f9d03d53a5d4a6f60bf5fc539d3c687a1519fdd": {coins: 250000},
  "89f2333571f37512f9a514d71fc97b2f946f0b59d6a8b8a34352af0d17231395": {coins: 1000000},
  "7c6848df8a1790206418a0a9bf5d620c4a4f7933984054231ce77e2fa7cee10c": {coins: 1000000},
  "e78379915090900f7c100cc911890f0c1eb882a7c3149cd3abf6541701fdc188": {coins: 1000000},
  "21e1eadc7d897217c9c04f07afe6843378736c54472b613acb3f593fc8724105": {coins: 1000000},
  "4ea2c874a8958fa3036d24b6ad58a862d87c221870d2caa7961d515958a686ac": {coins: 1000000},
  "1badfc4de0a662f50e98ac4b9690e61d02d4c1adda37e223ad478c786d1077f6": {unlock: "levels"},
  "1ebf58d49dd754835fe6121134d063b0335f1d6631458e4924b9fb22628bc967": {unlock: "levels"},
  "12d4306ce378deb6c1f08c8525b92be6bb84bd4adc0a00273fe24f2836c820cd": {unlock: "levels"},
  "eb4e8b02d6a784664b7c670c1016377d6d2a0142543ccceb6dbb7779f50311b6": {unlock: "levels"},
  "7f0a9e6b7dd5065dff0f58a1139ec478d0f0a83fc16c0e5773ca4eedd7b12832": {unlock: "levels"},
};
