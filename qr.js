// QR Code Generator - Pure JavaScript (No libraries)
// Supports: Byte mode, Error correction L/M/Q/H, Version 1-10, All 8 mask patterns

'use strict';

// ─── GF(256) Arithmetic ───────────────────────────────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG  = new Uint8Array(256);
(function buildGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D; // primitive polynomial x^8+x^4+x^3+x^2+1
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function gfPow(x, p) { return GF_EXP[(GF_LOG[x] * p) % 255]; }

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const factor = [1, gfPow(2, i)];
    const res = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++)
      for (let k = 0; k < factor.length; k++)
        res[j + k] ^= gfMul(poly[j], factor[k]);
    poly = res;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const msg = [...data, ...new Array(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0)
      for (let j = 0; j < gen.length; j++)
        msg[i + j] ^= gfMul(gen[j], coef);
  }
  return msg.slice(data.length);
}

// ─── QR Tables ────────────────────────────────────────────────────────────────
// [version][ecLevel(0=L,1=M,2=Q,3=H)] → [dataCodewords, [blockInfo...]]
// blockInfo: [ecPerBlock, [count, dataPerBlock], ...]
const EC_TABLE = (function() {
  // Source: ISO 18004:2015 Table 9
  // Format: [totalDataCW, ecCWperBlock, [g1blocks, g1dataCW], [g2blocks, g2dataCW]]
  const raw = [
    // v1
    [[19,7,[1,19]],[16,10,[1,16]],[13,13,[1,13]],[9,17,[1,9]]],
    // v2
    [[34,10,[1,34]],[28,16,[1,28]],[22,22,[1,22]],[16,28,[1,16]]],
    // v3
    [[55,15,[1,55]],[44,26,[1,44]],[34,18,[2,17]],[26,22,[2,13]]],
    // v4
    [[80,20,[1,80]],[64,18,[2,32]],[48,26,[2,24]],[36,16,[4,9]]],
    // v5
    [[108,26,[1,108]],[86,24,[2,43]],[62,18,[2,15],[2,16]],[46,22,[2,11],[2,12]]],
    // v6
    [[136,18,[2,68]],[108,16,[4,27]],[76,24,[4,19]],[60,28,[4,15]]],
    // v7
    [[156,20,[2,78]],[124,18,[4,31]],[88,18,[2,14],[4,15]],[66,26,[4,13],[1,14]]],
    // v8
    [[194,24,[2,97]],[154,22,[2,38],[2,39]],[110,22,[4,18],[2,19]],[86,26,[4,14],[2,15]]],
    // v9
    [[232,30,[2,116]],[182,22,[3,36],[2,37]],[132,20,[4,16],[4,17]],[100,24,[4,12],[4,13]]],
    // v10
    [[274,18,[2,68],[2,69]],[216,26,[4,43],[1,44]],[154,24,[6,19],[2,20]],[122,28,[6,15],[2,16]]],
  ];
  return raw.map(verArr => verArr.map(([totalData, ecPerBlock, g1, g2]) => ({
    totalData, ecPerBlock,
    groups: g2 ? [g1, g2] : [g1],
  })));
})();

// Format info strings (15 bits, pre-computed, masked with 101010000010010)
const FORMAT_INFO = [
  [0x77C4,0x72F3,0x7DAA,0x789D,0x662F,0x6318,0x6C41,0x6976], // L
  [0x5412,0x5125,0x5E7C,0x5B4B,0x45F9,0x40CE,0x4F97,0x4AA0], // M
  [0x355F,0x3068,0x3F31,0x3A06,0x24B4,0x2183,0x2EDA,0x2BED], // Q
  [0x1689,0x13BE,0x1CE7,0x19D0,0x0762,0x0255,0x0D0C,0x083B], // H
];

// Version info (only needed for v7+, skipping for v1-6)
// Alignment pattern centers per version (v2+)
const ALIGN_CENTERS = [
  [],       // v1
  [6,18],   // v2
  [6,22],   // v3
  [6,26],   // v4
  [6,30],   // v5
  [6,34],   // v6
  [6,22,38],// v7
  [6,24,42],// v8
  [6,26,46],// v9
  [6,28,50],// v10
];

// ─── BitStream ────────────────────────────────────────────────────────────────
class BitStream {
  constructor() { this.data = []; this.bitLen = 0; }
  push(val, bits) {
    for (let i = bits - 1; i >= 0; i--) {
      const b = (val >> i) & 1;
      const idx = this.bitLen >> 3;
      if (idx >= this.data.length) this.data.push(0);
      this.data[idx] |= b << (7 - (this.bitLen & 7));
      this.bitLen++;
    }
  }
  toBytes() { return [...this.data]; }
}

// ─── Encode ───────────────────────────────────────────────────────────────────
function encodeData(text, version, ecLevel) {
  const info = EC_TABLE[version - 1][ecLevel];
  const charCountBits = version <= 9 ? 8 : 16;
  const bytes = [...new TextEncoder().encode(text)];

  const bs = new BitStream();
  bs.push(0b0100, 4);           // mode: byte
  bs.push(bytes.length, charCountBits);
  for (const b of bytes) bs.push(b, 8);

  // Terminator + padding
  const totalBits = info.totalData * 8;
  const remaining = totalBits - bs.bitLen;
  bs.push(0, Math.min(4, remaining));
  while (bs.bitLen % 8 !== 0) bs.push(0, 1);

  const padBytes = [0xEC, 0x11];
  let pi = 0;
  while (bs.bitLen < totalBits) { bs.push(padBytes[pi++ % 2], 8); }

  return bs.toBytes();
}

function buildCodewords(dataBytes, version, ecLevel) {
  const info = EC_TABLE[version - 1][ecLevel];
  // Split data into blocks
  const dataBlocks = [];
  let offset = 0;
  for (const [count, size] of info.groups) {
    for (let i = 0; i < count; i++) {
      dataBlocks.push(dataBytes.slice(offset, offset + size));
      offset += size;
    }
  }
  // Generate EC for each block
  const ecBlocks = dataBlocks.map(b => rsEncode(b, info.ecPerBlock));

  // Interleave data
  const result = [];
  const maxData = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxData; i++)
    for (const b of dataBlocks) if (i < b.length) result.push(b[i]);
  // Interleave EC
  for (let i = 0; i < info.ecPerBlock; i++)
    for (const b of ecBlocks) result.push(b[i]);

  return result;
}

// ─── Matrix ───────────────────────────────────────────────────────────────────
function createMatrix(version) {
  const size = version * 4 + 17;
  // null = free, true = dark, false = light
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function isInBounds(matrix, r, c) {
  return r >= 0 && c >= 0 && r < matrix.length && c < matrix.length;
}

function placeFinderPattern(matrix, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      if (!isInBounds(matrix, row + r, col + c)) continue;
      const dark =
        (r === -1 || r === 7 || c === -1 || c === 7) ? true  :
        (r >= 1 && r <= 5 && c >= 1 && c <= 5)       ? (r >= 2 && r <= 4 && c >= 2 && c <= 4) :
        false;
      matrix[row + r][col + c] = dark;
    }
  }
}

function placeAlignmentPattern(matrix, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (matrix[row + r][col + c] !== null) continue;
      const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
      matrix[row + r][col + c] = dark;
    }
  }
}

function placeTimingPatterns(matrix) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }
}

function reserveFormatArea(matrix) {
  const size = matrix.length;
  // Around top-left finder
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  // Dark module
  matrix[size - 8][8] = true;
  // Top-right finder column
  for (let i = 0; i < 8; i++) if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
  // Bottom-left finder row
  for (let i = 0; i < 8; i++) if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
}

function placeDataBits(matrix, codewords) {
  const size = matrix.length;
  let bitIdx = 0;
  let col = size - 1;
  let goingUp = true;

  while (col >= 1) {
    if (col === 6) col--; // skip timing column
    const cols = [col, col - 1];
    for (let ri = 0; ri < size; ri++) {
      const r = goingUp ? size - 1 - ri : ri;
      for (const c of cols) {
        if (matrix[r][c] !== null) continue;
        const byteIdx = bitIdx >> 3;
        const bitPos  = 7 - (bitIdx & 7);
        const bit = byteIdx < codewords.length ? (codewords[byteIdx] >> bitPos) & 1 : 0;
        matrix[r][c] = bit === 1;
        bitIdx++;
      }
    }
    col -= 2;
    goingUp = !goingUp;
  }
}

function applyMask(matrix, maskId) {
  const size = matrix.length;
  const masks = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  const fn = masks[maskId];
  const masked = matrix.map(row => [...row]);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (masked[r][c] !== null) masked[r][c] = fn(r, c) ? !masked[r][c] : masked[r][c];
  return masked;
}

function placeFormatInfo(matrix, ecLevel, maskId) {
  const size = matrix.length;
  const bits = FORMAT_INFO[ecLevel][maskId];
  // Top-left horizontal (bits 14..8 at cols 0..8 skipping col6)
  // Top-left vertical   (bits 0..6 at rows 8..0 skipping row6)
  const positions = [
    [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
    [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
  ];
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> (14 - i)) & 1;
    const [r, c] = positions[i];
    matrix[r][c] = bit === 1;
  }
  // Top-right
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = ((bits >> i) & 1) === 1;
  // Bottom-left
  for (let i = 0; i < 7; i++) matrix[size - 7 + i][8] = ((bits >> (14 - i)) & 1) === 1;
}

// Penalty score (ISO 18004 Section 7.8.3)
function penaltyScore(matrix) {
  const size = matrix.length;
  let score = 0;
  // Rule 1: 5+ consecutive same-color
  for (let r = 0; r < size; r++) {
    for (let isRow of [true, false]) {
      let run = 1;
      for (let i = 1; i < size; i++) {
        const a = isRow ? matrix[r][i - 1] : matrix[i - 1][r];
        const b = isRow ? matrix[r][i]     : matrix[i][r];
        if (a === b) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
    }
  }
  // Rule 2: 2×2 same-color boxes
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++)
      if (matrix[r][c] === matrix[r+1][c] && matrix[r][c] === matrix[r][c+1] && matrix[r][c] === matrix[r+1][c+1])
        score += 3;
  // Rule 3: finder-like patterns
  const pat1 = [true,false,true,true,true,false,true,false,false,false,false];
  const pat2 = [false,false,false,false,true,false,true,true,true,false,true];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let m1 = true, m2 = true;
      for (let i = 0; i < 11; i++) {
        if (matrix[r][c+i] !== pat1[i]) m1 = false;
        if (matrix[r][c+i] !== pat2[i]) m2 = false;
        if (!m1 && !m2) break;
      }
      if (m1 || m2) score += 40;
      m1 = m2 = true;
      for (let i = 0; i < 11; i++) {
        if (matrix[c+i]?.[r] !== pat1[i]) m1 = false;
        if (matrix[c+i]?.[r] !== pat2[i]) m2 = false;
        if (!m1 && !m2) break;
      }
      if (m1 || m2) score += 40;
    }
  }
  // Rule 4: dark/light ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r][c]) dark++;
  const pct = (dark / (size * size)) * 100;
  const prev = Math.floor(Math.abs(pct - 50) / 5);
  const next = Math.ceil(Math.abs(pct - 50) / 5);
  score += Math.min(prev, next) * 10;
  return score;
}

// ─── Version selection ────────────────────────────────────────────────────────
// Byte mode capacity per version/ec
const CAPACITY = [
  [17,14,11,7],[32,26,20,14],[53,42,32,24],[78,62,46,34],
  [106,84,60,44],[134,106,74,58],[154,122,86,64],[192,152,108,84],
  [230,180,130,98],[271,213,151,119],
];

function selectVersion(text, ecLevel) {
  const len = new TextEncoder().encode(text).length;
  for (let v = 1; v <= 10; v++) {
    if (CAPACITY[v - 1][ecLevel] >= len) return v;
  }
  return null; // too long
}

// ─── Public API ───────────────────────────────────────────────────────────────
const EC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };

function generateQR(text, { ecLevel = 'M', moduleSize = 10, margin = 4 } = {}) {
  const ec = EC_LEVELS[ecLevel] ?? 1;
  const version = selectVersion(text, ec);
  if (version === null) throw new Error('テキストが長すぎます（最大~271バイト at L）');

  const size = version * 4 + 17;
  const matrix = createMatrix(version);

  // Place functional patterns
  placeFinderPattern(matrix, 0, 0);
  placeFinderPattern(matrix, 0, size - 7);
  placeFinderPattern(matrix, size - 7, 0);
  placeTimingPatterns(matrix);
  reserveFormatArea(matrix);

  const centers = ALIGN_CENTERS[version - 1];
  for (let i = 0; i < centers.length; i++)
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length-1) || (i === centers.length-1 && j === 0)) continue;
      placeAlignmentPattern(matrix, centers[i], centers[j]);
    }

  const dataBytes  = encodeData(text, version, ec);
  const codewords  = buildCodewords(dataBytes, version, ec);
  placeDataBits(matrix, codewords);

  // Choose best mask
  let bestMask = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const masked = applyMask(matrix, m);
    const s = penaltyScore(masked);
    if (s < bestScore) { bestScore = s; bestMask = m; }
  }

  const finalMatrix = applyMask(matrix, bestMask);
  placeFormatInfo(finalMatrix, ec, bestMask);

  return { matrix: finalMatrix, version, size, moduleSize, margin };
}

function renderToCanvas(canvas, text, options = {}) {
  const qr = generateQR(text, options);
  const { matrix, size, moduleSize, margin } = qr;
  const px = (size + margin * 2) * moduleSize;
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (matrix[r][c])
        ctx.fillRect((c + margin) * moduleSize, (r + margin) * moduleSize, moduleSize, moduleSize);
  return qr;
}

export { generateQR, renderToCanvas, EC_LEVELS };
