// Physics simulation — shared between batch (expected-reward) and
// real-time (session animation) modes.

import { BOARD, FORCE_TO_SPEED, SIM_DT } from './constants.js';

const { wallThickness: WALL, ballRadius: R, pegRadius: PR, holeBandHeight: HBH,
        launchX: LX, launchY: LY, width: W, height: H } = BOARD;

const LEFT   = WALL + R;
const RIGHT  = W - WALL - R;
const BOTTOM = H - HBH;
const TOP    = R;

// ---------------------------------------------------------------------------
// Core step — advances a ball by one SIM_DT, returns landing info if done.
// `ball` is mutated in place.  Returns { landed, reward, holeIndex, timedOut }.
// ---------------------------------------------------------------------------
export function physicsStep(ball, boardState) {
  const { pegs, holes, gravity, restitution } = boardState;

  // Speed-based substep count: prevent tunnelling through pegs at high speed.
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const subs  = Math.max(1, Math.ceil(speed * SIM_DT / (R * 0.4)));
  const dt    = SIM_DT / subs;

  for (let s = 0; s < subs; s++) {
    ball.vy += gravity * dt;
    ball.x  += ball.vx * dt;
    ball.y  += ball.vy * dt;

    // Wall bounces (tangential velocity unaffected)
    if (ball.x < LEFT)  { ball.x = LEFT;  ball.vx = -ball.vx * restitution; }
    else if (ball.x > RIGHT) { ball.x = RIGHT; ball.vx = -ball.vx * restitution; }

    // Top boundary (upward shots bounce back down)
    if (ball.y < TOP) { ball.y = TOP; ball.vy = Math.abs(ball.vy) * restitution; }

    // Peg collisions
    for (let i = 0; i < pegs.length; i++) {
      const peg = pegs[i];
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const distSq = dx * dx + dy * dy;
      const minDist = R + PR;

      if (distSq < minDist * minDist && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        let nx = dx / dist;
        let ny = dy / dist;

        // Break perfect-vertical symmetry (deterministic, peg-index-dependent)
        if (Math.abs(nx) < 1e-3) {
          nx += (i % 2 === 0 ? 1 : -1) * 0.02;
          const L = Math.sqrt(nx * nx + ny * ny);
          nx /= L; ny /= L;
        }

        // Positional correction — push ball out of peg
        const overlap = minDist - dist;
        ball.x += nx * overlap;
        ball.y += ny * overlap;

        // Reflect only the normal velocity component; tangential is unchanged.
        // v_new = v_t - e * v_n  ==>  v_new = v - v_n*(1+e)
        const vDotN = ball.vx * nx + ball.vy * ny;
        if (vDotN < 0) {
          ball.vx -= nx * vDotN * (1 + restitution);
          ball.vy -= ny * vDotN * (1 + restitution);
        }
      }
    }

    // Bottom — resolve hole outcome
    if (ball.y >= BOTTOM) {
      ball.y = BOTTOM;
      let holeIndex = -1;
      let reward    = 0;
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        if (ball.x >= hole.x && ball.x <= hole.x + hole.width) {
          holeIndex = h;
          reward    = hole.reward;
          break;
        }
      }
      return { landed: true, reward, holeIndex, timedOut: false };
    }
  }

  return { landed: false };
}

// ---------------------------------------------------------------------------
// Create a ball for real-time session animation.
// ---------------------------------------------------------------------------
export function createBall(id, force, angleDeg) {
  const speed    = force * FORCE_TO_SPEED;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    id,
    x: LX, y: LY,
    vx: speed * Math.sin(angleRad),
    vy: -speed * Math.cos(angleRad),
    force,
    done:          false,
    reward:        0,
    holeIndex:     -1,
    timedOut:      false,
    lingerFrames:  0,
    trail:         [{ x: LX, y: LY }],
    trailCounter:  0
  };
}

// ---------------------------------------------------------------------------
// Batch simulation — runs to completion, returns outcome + trajectory.
// Used by the expected-reward calculator and preview animation.
// ---------------------------------------------------------------------------
export function simulateShot(force, angleDeg, boardState, opts = {}) {
  const record = !!opts.recordTrajectory;
  const { gravity } = boardState;

  const speed    = force * FORCE_TO_SPEED;
  const angleRad = (angleDeg * Math.PI) / 180;

  const ball = {
    x: LX, y: LY,
    vx: speed * Math.sin(angleRad),
    vy: -speed * Math.cos(angleRad)
  };

  // Dynamic time horizon: time for ball to reach bottom under worst-case gravity.
  const discriminant = ball.vy * ball.vy + 2 * gravity * (BOTTOM - LY);
  const tMin = discriminant >= 0
    ? (-ball.vy + Math.sqrt(Math.max(0, discriminant))) / gravity
    : 10;
  const timeHorizon = Math.max(tMin * 10, 5);
  const maxSteps    = Math.ceil(timeHorizon / SIM_DT);

  const trajectory   = record ? [{ x: ball.x, y: ball.y }] : null;
  let trailCounter   = 0;
  const RECORD_EVERY = 2;

  for (let step = 0; step < maxSteps; step++) {
    const result = physicsStep(ball, boardState);

    if (record) {
      trailCounter++;
      if (trailCounter >= RECORD_EVERY) {
        trajectory.push({ x: ball.x, y: ball.y });
        trailCounter = 0;
      }
    }

    if (result.landed) {
      if (record) trajectory.push({ x: ball.x, y: ball.y });
      return { reward: result.reward, holeIndex: result.holeIndex,
               trajectory: trajectory || [], timedOut: false };
    }
  }

  // Emergency fallback — timeout, not counted as normal miss.
  if (record) trajectory.push({ x: ball.x, y: ball.y });
  return { reward: 0, holeIndex: -1, trajectory: trajectory || [], timedOut: true };
}
