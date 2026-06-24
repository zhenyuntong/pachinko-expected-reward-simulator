// Centralised layout validation and normalisation.
// validateLayout(raw) → { ok, data, errors }
// All physics and rendering agree on the normalised `data` shape.

import { BOARD, MAX_PEGS, MAX_HOLES, MIN_PEG_SEPARATION } from './constants.js';

const { width: W, height: H, wallThickness: WALL,
        pegRadius: PR, ballRadius: BR, holeBandHeight: HBH,
        launchX: LX, launchY: LY } = BOARD;

function safeNum(v, fallback) {
  const n = Number(v);
  return (isFinite(n) && !isNaN(n)) ? n : fallback;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function validateLayout(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, data: null, errors: ['Layout must be a JSON object.'] };
  }

  const errors = [];

  // ---- Physics params -------------------------------------------------------
  let forceMin    = clamp(safeNum(raw.forceMin, 30), 1, 100);
  let forceMax    = clamp(safeNum(raw.forceMax, 70), 1, 100);
  let angleDeg    = ((safeNum(raw.angleDeg, 0) % 360) + 360) % 360; // wrap to 0-360
  let gravity     = clamp(safeNum(raw.gravity, 600), 50, 2000);
  let restitution = clamp(safeNum(raw.restitution, 0.78), 0.1, 1.0);

  if (forceMin >= forceMax) {
    forceMin = Math.max(1, forceMax - 1);
    errors.push('forceMin must be less than forceMax; adjusted.');
  }

  // ---- Pegs ----------------------------------------------------------------
  const rawPegs = Array.isArray(raw.pegs) ? raw.pegs.slice(0, MAX_PEGS) : [];
  const pegMinX = WALL + PR;
  const pegMaxX = W - WALL - PR;
  const pegMinY = LY + PR + 10;
  const pegMaxY = H - HBH - PR - 10;
  const launcherClear = PR + BR + 26;

  const pegs = [];
  for (const p of rawPegs) {
    const x = clamp(safeNum(p.x, LX), pegMinX, pegMaxX);
    const y = clamp(safeNum(p.y, 200), pegMinY, pegMaxY);

    if (Math.hypot(x - LX, y - LY) < launcherClear) {
      errors.push(`Peg near launcher removed.`);
      continue;
    }

    // Remove if it overlaps an already-accepted peg
    const overlaps = pegs.some(q => Math.hypot(q.x - x, q.y - y) < MIN_PEG_SEPARATION);
    if (overlaps) {
      errors.push(`Overlapping peg removed.`);
      continue;
    }

    pegs.push({ x, y });
  }

  // ---- Holes ---------------------------------------------------------------
  const rawHoles = Array.isArray(raw.holes) ? raw.holes : [];
  if (rawHoles.length === 0) {
    errors.push('No holes found; using default single hole.');
    rawHoles.push({ x: WALL, width: W - WALL * 2, reward: 10 });
  }

  const holeMinW = 16;
  const holeMaxW = W - WALL * 2;
  const holeMinX = WALL;
  const holeMaxX = W - WALL;

  // Sort by x, normalise, then drop overlaps
  const sortedHoles = rawHoles
    .slice(0, MAX_HOLES)
    .map(h => ({
      x:      clamp(safeNum(h.x, WALL), holeMinX, holeMaxX - holeMinW),
      width:  clamp(safeNum(h.width, 60), holeMinW, holeMaxW),
      reward: safeNum(h.reward, 0)
    }))
    .sort((a, b) => a.x - b.x);

  const holes = [];
  for (const h of sortedHoles) {
    // Clamp right edge within board
    const right = Math.min(h.x + h.width, holeMaxX);
    const width = right - h.x;
    if (width < holeMinW) { errors.push('Hole too narrow after boundary clamp; skipped.'); continue; }

    // Reject if overlaps previous accepted hole
    const prev = holes[holes.length - 1];
    if (prev && h.x < prev.x + prev.width) {
      errors.push('Overlapping hole removed.');
      continue;
    }

    holes.push({ x: h.x, width, reward: h.reward });
  }

  if (holes.length === 0) {
    errors.push('All holes were invalid; one default hole added.');
    holes.push({ x: WALL, width: W - WALL * 2, reward: 10 });
  }

  const data = {
    pegs, holes, forceMin, forceMax,
    angleDeg, gravity, restitution,
    pegMode: raw.pegMode === 'assisted' ? 'assisted' : 'free',
    version: 2
  };

  return { ok: errors.length === 0, data, errors };
}
