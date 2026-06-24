// Multi-shot session — manages real-time ball simulation and session stats.

import { BOARD, MAX_BALLS_IN_FLIGHT, SESSION_STEPS_PER_FRAME,
         AUTO_FIRE_INTERVAL_MS, BALL_LINGER_FRAMES, HOLE_COLORS } from './constants.js';
import { state, nextBallId } from './state.js';
import { createBall, physicsStep } from './physics.js';
import { drawBoard } from './renderer.js';

const BOTTOM = BOARD.height - BOARD.holeBandHeight;

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
export function startSession() {
  if (state.session.active) return;
  state.session.active       = true;
  state.session.lastFireTime = 0;

  if (state.session.mode === 'auto') {
    scheduleNextFrame();
  }
  updateSessionUI();
}

export function stopSession() {
  state.session.active     = false;
  state.session.holdActive = false;
  updateSessionUI();
  // Let the rAF loop drain naturally (balls still in flight finish animating)
  scheduleNextFrame();
}

export function resetSessionStats() {
  state.session.balls         = [];
  state.session.shotsCompleted = 0;
  state.session.totalReward   = 0;
  state.session.holeHits      = [];
  state.session.misses        = 0;
  state.session.timedOuts     = 0;
  state.session.rafId         = null;
  renderSessionStats();
  drawBoard();
}

// ---------------------------------------------------------------------------
// Fire a single ball (any mode)
// ---------------------------------------------------------------------------
export function fireOneBall() {
  const activeBalls = state.session.balls.filter(b => !b.done).length;
  if (activeBalls >= MAX_BALLS_IN_FLIGHT) return;

  const { forceMin, forceMax, angleDeg } = state.board;
  const force = forceMin + Math.random() * (forceMax - forceMin);
  const ball  = createBall(nextBallId(), force, angleDeg);
  state.session.balls.push(ball);

  scheduleNextFrame();
}

// ---------------------------------------------------------------------------
// Hold mode
// ---------------------------------------------------------------------------
export function setHoldActive(active) {
  state.session.holdActive = active;
  if (active && !state.session.rafId) scheduleNextFrame();
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
function scheduleNextFrame() {
  if (!state.session.rafId) {
    state.session.rafId = requestAnimationFrame(runFrame);
  }
}

function runFrame(timestamp) {
  state.session.rafId = null;

  // Auto / hold firing
  if (state.session.active || state.session.holdActive) {
    const gap         = timestamp - state.session.lastFireTime;
    const shouldFire  = state.session.mode === 'auto'
      ? gap >= AUTO_FIRE_INTERVAL_MS
      : state.session.mode === 'hold' && state.session.holdActive;

    if (shouldFire) {
      const activeBalls = state.session.balls.filter(b => !b.done).length;
      if (activeBalls < MAX_BALLS_IN_FLIGHT) {
        fireOneBall();
        state.session.lastFireTime = timestamp;
      }
    }
  }

  // Advance physics for each live ball
  for (const ball of state.session.balls) {
    if (ball.done) {
      ball.lingerFrames++;
      continue;
    }

    for (let s = 0; s < SESSION_STEPS_PER_FRAME; s++) {
      const result = physicsStep(ball, state.board);

      // Record trail (every 3 steps)
      ball.trailCounter++;
      if (ball.trailCounter >= 3) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 120) ball.trail.shift(); // keep last 120 points
        ball.trailCounter = 0;
      }

      if (result.landed) {
        ball.done      = true;
        ball.reward    = result.reward;
        ball.holeIndex = result.holeIndex;
        ball.timedOut  = result.timedOut;
        ball.trail.push({ x: ball.x, y: ball.y });
        registerLanding(ball);
        break;
      }
    }
  }

  // Prune balls that have lingered long enough
  state.session.balls = state.session.balls.filter(
    b => !b.done || b.lingerFrames <= BALL_LINGER_FRAMES
  );

  drawBoard();
  renderSessionStats();

  // Keep loop alive while balls are in flight or session is active
  if (state.session.active || state.session.holdActive || state.session.balls.length > 0) {
    scheduleNextFrame();
  }
}

function registerLanding(ball) {
  if (ball.timedOut) {
    state.session.timedOuts++;
    showTimedOutWarning();
    return; // do not count in stats
  }

  state.session.shotsCompleted++;
  state.session.totalReward += ball.reward;

  if (ball.holeIndex === -1) {
    state.session.misses++;
  } else {
    while (state.session.holeHits.length <= ball.holeIndex) {
      state.session.holeHits.push(0);
    }
    state.session.holeHits[ball.holeIndex]++;
  }
}

// ---------------------------------------------------------------------------
// Stats display
// ---------------------------------------------------------------------------
export function renderSessionStats() {
  const s  = state.session;
  const el = id => document.getElementById(id);

  el('statShots').textContent  = s.shotsCompleted;
  el('statTotal').textContent  = s.totalReward.toFixed(1);

  if (s.shotsCompleted > 0) {
    const avg = s.totalReward / s.shotsCompleted;
    el('statEmpAvg').textContent = avg.toFixed(3);

    const ideal = state.expected?.expectedReward;
    if (ideal !== undefined && ideal !== null) {
      const diff = avg - ideal;
      const diffEl = el('statDiff');
      diffEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(3);
      diffEl.style.color = diff >= 0 ? 'var(--success)' : 'var(--danger)';
    } else {
      el('statDiff').textContent = '—';
      el('statDiff').style.color = '';
    }
  } else {
    el('statEmpAvg').textContent = '—';
    el('statDiff').textContent   = '—';
    el('statDiff').style.color   = '';
  }

  // Per-hole distribution
  const distEl  = el('statHoleDist');
  distEl.innerHTML = '';

  const total = s.shotsCompleted + s.misses; // includes misses

  state.board.holes.forEach((hole, idx) => {
    const count = s.holeHits[idx] || 0;
    const pct   = s.shotsCompleted > 0 ? count / s.shotsCompleted * 100 : 0;
    const color = HOLE_COLORS[idx % HOLE_COLORS.length];
    const row   = document.createElement('div');
    row.className = 'stat-dist-row';
    row.innerHTML = `
      <span class="hole-color-chip" style="background:${color}"></span>
      <span class="stat-dist-label">Hole ${idx + 1}</span>
      <span class="stat-dist-count">${count}</span>
      <span class="stat-dist-pct">${pct.toFixed(1)}%</span>
      <div class="stat-dist-bar-track" style="grid-column:1/-1">
        <div class="stat-dist-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div>
      </div>
    `;
    distEl.appendChild(row);
  });

  if (s.shotsCompleted > 0) {
    const missRow = document.createElement('div');
    missRow.className = 'stat-dist-row stat-dist-miss';
    const missPct = s.misses / s.shotsCompleted * 100;
    missRow.innerHTML = `
      <span class="hole-color-chip" style="background:var(--line)"></span>
      <span class="stat-dist-label">Miss</span>
      <span class="stat-dist-count">${s.misses}</span>
      <span class="stat-dist-pct">${missPct.toFixed(1)}%</span>
      <div class="stat-dist-bar-track" style="grid-column:1/-1">
        <div class="stat-dist-bar" style="width:${missPct.toFixed(1)}%;background:var(--line)"></div>
      </div>
    `;
    distEl.appendChild(missRow);
  }

  if (s.timedOuts > 0) {
    el('statTimedOuts').textContent = `⚠ ${s.timedOuts} shot(s) timed out and were excluded.`;
    el('statTimedOuts').style.display = '';
  } else {
    el('statTimedOuts').style.display = 'none';
  }
}

function showTimedOutWarning() {
  // The renderSessionStats call handles displaying the count.
}

export function updateSessionUI() {
  const s       = state.session;
  const startBtn = document.getElementById('btnStartSession');
  const stopBtn  = document.getElementById('btnStopSession');
  const modeEl   = document.getElementById('sessionModeSelect');

  startBtn.disabled = s.active;
  stopBtn.disabled  = !s.active && !state.session.balls.some(b => !b.done);
  modeEl.disabled   = s.active;

  // For Hold mode, the shoot button handles its own hold behaviour.
  // For Single mode, one button appears per click.
  const holdShootBtn = document.getElementById('btnHoldShoot');
  const singleShootBtn = document.getElementById('btnSingleShoot');

  if (s.mode === 'single') {
    singleShootBtn.style.display = '';
    holdShootBtn.style.display   = 'none';
  } else if (s.mode === 'hold') {
    singleShootBtn.style.display = 'none';
    holdShootBtn.style.display   = '';
  } else {
    singleShootBtn.style.display = 'none';
    holdShootBtn.style.display   = 'none';
  }
}
