// UI wiring — links sliders, number inputs, hole editor, expected-reward
// display, and session controls to state.

import { BOARD, HOLE_COLORS, MAX_HOLES } from './constants.js';
import { state } from './state.js';
import { calculateExpectedReward } from './expectedReward.js';
import { drawBoard } from './renderer.js';
import { clamp, preventHoleOverlap, clampHoleWidthForOverlap,
         setScheduleRecompute, setUpdateHoleEditorList,
         updatePegTrayLabel, clearAllPegs, setPegMode } from './editor.js';
import { startSession, stopSession, resetSessionStats,
         fireOneBall, setHoldActive, updateSessionUI, renderSessionStats } from './session.js';
import { saveToLocalStorage, loadFromLocalStorage, exportJsonToFile,
         importJsonFromFile, resetToDefaultLayout, flashStatus } from './persistence.js';
import { nextHoleId } from './state.js';
import { simulateShot } from './physics.js';

// ---------------------------------------------------------------------------
// Debounced expected-reward recompute
// ---------------------------------------------------------------------------
const DEBOUNCE_MS = 200;
let debounceTimer  = null;
let computeVersion = 0; // increments on each schedule to discard stale results

const calcStatusEl = document.getElementById('calcStatus');

export function scheduleRecompute(immediate = false) {
  setCalcStatus('updating');
  if (debounceTimer) clearTimeout(debounceTimer);
  computeVersion++;
  const myVersion = computeVersion;

  if (immediate) {
    runRecompute(myVersion);
  } else {
    debounceTimer = setTimeout(() => runRecompute(myVersion), DEBOUNCE_MS);
  }
}

function runRecompute(version) {
  debounceTimer = null;
  const t0 = performance.now();

  const result = calculateExpectedReward(
    state.board.forceMin, state.board.forceMax,
    state.board.angleDeg, state.board
  );

  // Discard if a newer computation has been scheduled
  if (version !== computeVersion) return;

  const elapsed = performance.now() - t0;
  state.expected = result;
  renderExpectedReward(result, elapsed);
  setCalcStatus('ready');
  renderSessionStats(); // refresh empirical diff with new ideal value
}

function setCalcStatus(mode) {
  if (mode === 'updating') {
    calcStatusEl.textContent = 'Computing…';
    calcStatusEl.classList.add('updating');
  } else {
    calcStatusEl.textContent = 'Ready';
    calcStatusEl.classList.remove('updating');
  }
}

// ---------------------------------------------------------------------------
// Expected-reward panel
// ---------------------------------------------------------------------------
function renderExpectedReward(result, elapsedMs) {
  const erEl = document.getElementById('expectedRewardDisplay');
  erEl.textContent = result.expectedReward.toFixed(3);

  // Approximation badge
  const badge = document.getElementById('erApproxBadge');
  const banner = document.getElementById('erApproxBanner');
  if (result.capReached) {
    badge.style.display  = '';
    banner.style.display = '';
  } else {
    badge.style.display  = 'none';
    banner.style.display = 'none';
  }

  // Hole probability bars
  const list = document.getElementById('holeProbList');
  list.innerHTML = '';
  state.board.holes.forEach((hole, idx) => {
    const prob  = result.holeProbabilities[idx] ?? 0;
    const color = HOLE_COLORS[idx % HOLE_COLORS.length];
    const row   = document.createElement('div');
    row.className = 'hole-prob-row';
    row.style.flexDirection = 'column';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;width:100%">
        <span class="hole-color-chip" style="background:${color}"></span>
        <span class="hole-name">Hole ${idx + 1} &mdash; reward ${hole.reward}</span>
        <span class="hole-value">${(prob * 100).toFixed(1)}%</span>
      </div>
      <div class="prob-bar-track">
        <div class="prob-bar-fill" style="width:${(prob * 100).toFixed(1)}%;background:${color}"></div>
      </div>
    `;
    list.appendChild(row);
  });

  document.getElementById('zeroProb').textContent =
    (result.zeroProbability * 100).toFixed(1) + '%';
  document.getElementById('infoForceRange').textContent =
    `${state.board.forceMin} – ${state.board.forceMax}`;
  document.getElementById('infoAngle').textContent =
    `${state.board.angleDeg}° (${angleDescription(state.board.angleDeg)})`;
  document.getElementById('infoSamples').textContent = String(result.samplesUsed);
  document.getElementById('infoTime').textContent    = elapsedMs.toFixed(1) + ' ms';
}

function angleDescription(deg) {
  deg = ((deg % 360) + 360) % 360;
  if (deg < 15 || deg >= 345)      return '↑ up';
  if (deg < 75)                    return '↗ up-right';
  if (deg < 105)                   return '→ right';
  if (deg < 165)                   return '↘ down-right';
  if (deg < 195)                   return '↓ down';
  if (deg < 255)                   return '↙ down-left';
  if (deg < 285)                   return '← left';
  if (deg < 345)                   return '↖ up-left';
  return '';
}

// ---------------------------------------------------------------------------
// Hole editor list
// ---------------------------------------------------------------------------
export function updateHoleEditorList() {
  const listEl = document.getElementById('holeEditorList');
  listEl.innerHTML = '';

  state.board.holes.forEach((hole, idx) => {
    const color  = HOLE_COLORS[idx % HOLE_COLORS.length];
    const maxX   = BOARD.width - BOARD.wallThickness - hole.width;
    const card   = document.createElement('div');
    card.className = 'hole-card';
    card.innerHTML = `
      <div class="hole-card-header">
        <span class="hole-color-chip" style="background:${color}"></span>
        <span>Hole ${idx + 1}</span>
        <button class="btn btn-small btn-danger-outline hole-delete-btn" title="Remove">✕</button>
      </div>
      <div class="hole-card-row">
        <label>Position</label>
        <input type="number" class="hole-x-input"
          min="${BOARD.wallThickness}" max="${maxX}" step="1" value="${Math.round(hole.x)}">
      </div>
      <div class="hole-card-row">
        <label>Width</label>
        <input type="number" class="hole-width-input"
          min="16" max="${BOARD.width - BOARD.wallThickness * 2}" step="1" value="${Math.round(hole.width)}">
      </div>
      <div class="hole-card-row">
        <label>Reward</label>
        <input type="number" class="hole-reward-input" step="1" value="${hole.reward}">
      </div>
    `;

    card.querySelector('.hole-delete-btn').addEventListener('click', () => {
      if (state.board.holes.length <= 1) {
        flashStatus('At least one hole is required.', true); return;
      }
      state.board.holes = state.board.holes.filter(h => h.id !== hole.id);
      updateHoleEditorList();
      drawBoard();
      scheduleRecompute();
    });

    const xInput = card.querySelector('.hole-x-input');
    xInput.addEventListener('input', () => {
      const val  = clamp(Number(xInput.value) || 0, BOARD.wallThickness,
                         BOARD.width - BOARD.wallThickness - hole.width);
      hole.x     = preventHoleOverlap(hole.id, val, hole.width);
      xInput.value = Math.round(hole.x); // reflect clamped value
      drawBoard(); scheduleRecompute();
    });

    const wInput = card.querySelector('.hole-width-input');
    wInput.addEventListener('input', () => {
      const req  = Math.max(16, Number(wInput.value) || 16);
      hole.width = clampHoleWidthForOverlap(hole.id, hole.x, req);
      wInput.value = Math.round(hole.width);
      drawBoard(); scheduleRecompute();
    });

    card.querySelector('.hole-reward-input').addEventListener('input', (e) => {
      hole.reward = Number(e.target.value) ?? 0;
      drawBoard(); scheduleRecompute();
    });

    listEl.appendChild(card);
  });

  if (state.board.holes.length < MAX_HOLES) {
    const addBtn = document.createElement('button');
    addBtn.className   = 'btn btn-small';
    addBtn.style.width = '100%';
    addBtn.textContent = `+ Add Hole (${state.board.holes.length}/${MAX_HOLES})`;
    addBtn.addEventListener('click', addHole);
    listEl.appendChild(addBtn);
  }
}

function addHole() {
  if (state.board.holes.length >= MAX_HOLES) return;
  const minX   = BOARD.wallThickness;
  const maxX   = BOARD.width - BOARD.wallThickness;
  const sorted = [...state.board.holes].sort((a, b) => a.x - b.x);
  const gaps   = [];
  let cursor   = minX;
  for (const h of sorted) { gaps.push({ start: cursor, end: h.x }); cursor = h.x + h.width; }
  gaps.push({ start: cursor, end: maxX });
  const best  = gaps.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a), gaps[0]);
  const gapW  = best.end - best.start;
  const width = Math.max(16, Math.min(60, gapW - 4));
  if (width < 16) { flashStatus('No space for another hole.', true); return; }
  const x     = best.start + Math.max(0, (gapW - width) / 2);
  state.board.holes.push({ id: nextHoleId(), x, width, reward: 10 });
  updateHoleEditorList();
  drawBoard();
  scheduleRecompute();
}

// ---------------------------------------------------------------------------
// Linked slider ↔ number input pairs
// ---------------------------------------------------------------------------
function linkControl(rangeId, numberId, onChange, { min, max } = {}) {
  const rangeEl = document.getElementById(rangeId);
  const numEl   = document.getElementById(numberId);

  function apply(value) {
    let v = Number(value);
    if (!isFinite(v)) return;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    rangeEl.value = v;
    numEl.value   = v;
    onChange(v);
  }

  rangeEl.addEventListener('input', () => apply(rangeEl.value));
  numEl.addEventListener('input',   () => apply(numEl.value));
  return apply;
}

export function syncControlsFromState() {
  const b = state.board;
  document.getElementById('forceMin').value    = b.forceMin;
  document.getElementById('forceMinNum').value = b.forceMin;
  document.getElementById('forceMax').value    = b.forceMax;
  document.getElementById('forceMaxNum').value = b.forceMax;
  document.getElementById('angle').value       = b.angleDeg;
  document.getElementById('angleNum').value    = b.angleDeg;
  document.getElementById('gravity').value     = b.gravity;
  document.getElementById('gravityNum').value  = b.gravity;
  document.getElementById('restitution').value    = b.restitution;
  document.getElementById('restitutionNum').value = b.restitution;
}

// ---------------------------------------------------------------------------
// Preview animation
// ---------------------------------------------------------------------------
let previewRafId = null;

function playPreviewShot() {
  if (previewRafId) { cancelAnimationFrame(previewRafId); previewRafId = null; }

  const mode  = document.getElementById('previewForceMode').value;
  const { forceMin, forceMax, angleDeg } = state.board;
  const force = mode === 'min'    ? forceMin
              : mode === 'max'    ? forceMax
              : mode === 'random' ? forceMin + Math.random() * (forceMax - forceMin)
              : (forceMin + forceMax) / 2;

  const result = simulateShot(force, angleDeg, state.board, { recordTrajectory: true });

  if (result.timedOut) {
    calcStatusEl.textContent = '⚠ Preview shot timed out.';
    setTimeout(() => setCalcStatus('ready'), 3000);
    return;
  }

  state.preview = {
    trajectory: result.trajectory, progressIndex: 0,
    ballPos: result.trajectory[0] || { x: BOARD.launchX, y: BOARD.launchY },
    reward: result.reward, holeIndex: result.holeIndex, force
  };

  const total = result.trajectory.length;
  if (total === 0) return;

  const DURATION_MS = 1400;
  const t0 = performance.now();

  function step(now) {
    const t   = Math.min(1, (now - t0) / DURATION_MS);
    const idx = Math.floor(t * (total - 1));
    state.preview.progressIndex = idx;
    state.preview.ballPos       = state.preview.trajectory[idx];
    drawBoard();
    if (t < 1) {
      previewRafId = requestAnimationFrame(step);
    } else {
      previewRafId = null;
      const holeLabel = result.holeIndex >= 0 ? `Hole ${result.holeIndex + 1}` : 'Miss';
      calcStatusEl.textContent = `Preview: ${holeLabel}, reward ${result.reward}`;
      setTimeout(() => setCalcStatus('ready'), 2600);
    }
  }
  previewRafId = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Wire everything up
// ---------------------------------------------------------------------------
export function wireAllControls() {
  // Inject callbacks into modules that need them
  setScheduleRecompute(scheduleRecompute);
  setUpdateHoleEditorList(updateHoleEditorList);

  // Force range
  linkControl('forceMin', 'forceMinNum', (v) => {
    if (v >= state.board.forceMax) {
      v = state.board.forceMax - 1;
      document.getElementById('forceMin').value    = v;
      document.getElementById('forceMinNum').value = v;
    }
    state.board.forceMin = v;
    scheduleRecompute();
  }, { min: 1, max: 100 });

  linkControl('forceMax', 'forceMaxNum', (v) => {
    if (v <= state.board.forceMin) {
      v = state.board.forceMin + 1;
      document.getElementById('forceMax').value    = v;
      document.getElementById('forceMaxNum').value = v;
    }
    state.board.forceMax = v;
    scheduleRecompute();
  }, { min: 1, max: 100 });

  // Angle (0-360°)
  linkControl('angle', 'angleNum', (v) => {
    state.board.angleDeg = ((v % 360) + 360) % 360;
    drawBoard();
    scheduleRecompute();
  }, { min: 0, max: 360 });

  // Physics
  linkControl('gravity', 'gravityNum', (v) => {
    state.board.gravity = v; scheduleRecompute();
  }, { min: 50, max: 2000 });

  linkControl('restitution', 'restitutionNum', (v) => {
    state.board.restitution = v; scheduleRecompute();
  }, { min: 0.1, max: 1 });

  // Board actions
  document.getElementById('btnClearPegs').addEventListener('click',    clearAllPegs);
  document.getElementById('btnResetDefault').addEventListener('click', resetToDefaultLayout);

  // Save / load
  document.getElementById('btnSaveLocal').addEventListener('click',  saveToLocalStorage);
  document.getElementById('btnLoadLocal').addEventListener('click',  () => {
    // Prompt if there is already a valid-looking saved layout
    const raw = localStorage.getItem('pachinko-simulator-v2');
    if (raw) {
      const msg = 'Load your saved layout? (Cancel to keep current board)';
      if (!confirm(msg)) return;
    }
    loadFromLocalStorage();
  });
  document.getElementById('btnExportJson').addEventListener('click', exportJsonToFile);

  const importInput = document.getElementById('importFileInput');
  document.getElementById('btnImportJson').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importJsonFromFile(file);
    importInput.value = '';
  });

  // Preview
  document.getElementById('btnAnimateShot').addEventListener('click', playPreviewShot);

  // Session controls
  document.getElementById('sessionModeSelect').addEventListener('change', (e) => {
    state.session.mode = e.target.value;
    updateSessionUI();
  });

  document.getElementById('btnStartSession').addEventListener('click', startSession);
  document.getElementById('btnStopSession').addEventListener('click',  stopSession);
  document.getElementById('btnResetStats').addEventListener('click',   resetSessionStats);

  // Single-shot button
  document.getElementById('btnSingleShoot').addEventListener('click', () => {
    if (!state.session.active) startSession();
    fireOneBall();
  });

  // Hold-shoot button
  const holdBtn = document.getElementById('btnHoldShoot');
  holdBtn.addEventListener('mousedown',  () => { if (!state.session.active) startSession(); setHoldActive(true); });
  holdBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (!state.session.active) startSession(); setHoldActive(true); });
  document.addEventListener('mouseup',   () => setHoldActive(false));
  document.addEventListener('touchend',  () => setHoldActive(false));
}
