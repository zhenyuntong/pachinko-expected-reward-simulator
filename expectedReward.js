// Deterministic numerical estimator for expected reward.
// Uses adaptive midpoint refinement so narrow winning force windows
// between two losing endpoints are not silently missed.

import { simulateShot } from './physics.js';

const SAMPLER = {
  initialSamples:        19,   // odd — guarantees a sample exactly at midpoint of range
  maxDepth:              8,
  maxTotalSamples:       800,
  rewardDeltaThreshold:  0.5   // refine if |Δreward| / maxReward > this
};

// ---------------------------------------------------------------------------
// Memoised evaluator for one calculateExpectedReward() call.
// ---------------------------------------------------------------------------
function makeShotEvaluator(angleDeg, boardState) {
  const cache = new Map();
  let evalCount = 0;
  return {
    eval(force) {
      const key = Math.round(force * 1e4); // 0.1‑unit resolution
      if (cache.has(key)) return cache.get(key);
      const r = simulateShot(force, angleDeg, boardState);
      cache.set(key, r);
      evalCount++;
      return r;
    },
    get count() { return evalCount; }
  };
}

// ---------------------------------------------------------------------------
// Main estimator.
// ---------------------------------------------------------------------------
export function calculateExpectedReward(forceMin, forceMax, angleDeg, boardState) {
  // Degenerate: single force value
  if (!(forceMax > forceMin)) {
    const ev   = makeShotEvaluator(angleDeg, boardState);
    const res  = ev.eval(forceMin);
    const probs = boardState.holes.map((_, i) => (res.holeIndex === i ? 1 : 0));
    return {
      expectedReward:  res.reward,
      holeProbabilities: probs,
      zeroProbability: res.holeIndex === -1 ? 1 : 0,
      samplesUsed:     1,
      capReached:      false,
      debug: { intervals: 1, maxDepthHit: false }
    };
  }

  const ev       = makeShotEvaluator(angleDeg, boardState);
  const numHoles = boardState.holes.length;
  const maxMag   = Math.max(1, ...boardState.holes.map(h => Math.abs(h.reward)));

  // --- Step 1: coarse uniform grid including endpoints and midpoint --------
  const n0 = SAMPLER.initialSamples;
  let points = [];
  for (let i = 0; i < n0; i++) {
    const f = forceMin + (forceMax - forceMin) * (i / (n0 - 1));
    points.push({ force: f, result: ev.eval(f) });
  }

  // --- Step 2: adaptive midpoint refinement --------------------------------
  // For each adjacent pair (a, b), always compute the midpoint m.
  // If (a, m) or (m, b) disagree in outcome — or reward delta is large —
  // recurse on both halves.  This guarantees no transition between a and b
  // is missed even when a and b have the same outcome.
  let maxDepthHit = false;

  function refine(pts, depth) {
    if (depth >= SAMPLER.maxDepth) { maxDepthHit = true; return pts; }
    if (ev.count >= SAMPLER.maxTotalSamples) return pts;

    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];

      if (ev.count >= SAMPLER.maxTotalSamples) {
        out.push(b);
        continue;
      }

      const mf = (a.force + b.force) / 2;
      const m  = { force: mf, result: ev.eval(mf) };

      const leftDiffers  = a.result.holeIndex !== m.result.holeIndex ||
        Math.abs(a.result.reward - m.result.reward) / maxMag > SAMPLER.rewardDeltaThreshold;
      const rightDiffers = m.result.holeIndex !== b.result.holeIndex ||
        Math.abs(m.result.reward - b.result.reward) / maxMag > SAMPLER.rewardDeltaThreshold;

      if (leftDiffers || rightDiffers) {
        // Insert midpoint and recurse on each half
        const leftSeg  = refine([a, m], depth + 1);
        const rightSeg = refine([m, b], depth + 1);
        // leftSeg ends with m, rightSeg starts with m — merge without duplicating
        for (let k = 0; k < leftSeg.length - 1; k++) out.push(leftSeg[k]);
        out.push(...rightSeg);
      } else {
        out.push(b);
      }
    }
    return out;
  }

  points = refine(points, 0);

  const capReached = maxDepthHit || ev.count >= SAMPLER.maxTotalSamples;

  // --- Step 3: composite trapezoid integral --------------------------------
  const totalWidth = forceMax - forceMin;
  let integral = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    integral += (b.force - a.force) * (a.result.reward + b.result.reward) / 2;
  }
  const expectedReward = integral / totalWidth;

  // --- Step 4: per-hole probability mass (midpoint representative) ---------
  const holeMass = new Array(numHoles).fill(0);
  let   zeroMass = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const w = b.force - a.force;

    if (a.result.holeIndex === b.result.holeIndex) {
      if (a.result.holeIndex === -1) zeroMass += w;
      else holeMass[a.result.holeIndex] += w;
    } else {
      // Endpoints disagree — split mass evenly at finest resolution
      const half = w / 2;
      (a.result.holeIndex === -1 ? (zeroMass += half) : (holeMass[a.result.holeIndex] += half));
      (b.result.holeIndex === -1 ? (zeroMass += half) : (holeMass[b.result.holeIndex] += half));
    }
  }

  return {
    expectedReward,
    holeProbabilities: holeMass.map(m => m / totalWidth),
    zeroProbability:   zeroMass / totalWidth,
    samplesUsed:       ev.count,
    capReached,
    debug: { intervals: points.length - 1, maxDepthHit }
  };
}
