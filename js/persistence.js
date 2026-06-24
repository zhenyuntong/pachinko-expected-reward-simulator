// Save / load / import / export.

import { BOARD, MAX_PEGS, HOLE_COLORS } from './constants.js';
import { state, nextPegId, nextHoleId } from './state.js';
import { validateLayout } from './validation.js';
import { setPegMode } from './editor.js';
import { drawBoard } from './renderer.js';

const STORAGE_KEY = 'pachinko-simulator-v2';

// ---------------------------------------------------------------------------
// Serialise current board to a plain object (safe to JSON.stringify)
// ---------------------------------------------------------------------------
export function serializeLayout() {
  const b = state.board;
  return {
    version:     2,
    pegs:        b.pegs.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
    holes:       b.holes.map(h => ({ x: +h.x.toFixed(2), width: +h.width.toFixed(2), reward: h.reward })),
    forceMin:    b.forceMin,
    forceMax:    b.forceMax,
    angleDeg:    b.angleDeg,
    gravity:     b.gravity,
    restitution: b.restitution,
    pegMode:     state.pegMode
  };
}

// ---------------------------------------------------------------------------
// Apply a validated layout to state.
// `scheduleRecompute` and `updateHoleEditorList` are injected to avoid
// circular imports.
// ---------------------------------------------------------------------------
let _scheduleRecompute   = () => {};
let _syncControls        = () => {};
let _updateHoleEditor    = () => {};
let _updatePegTrayLabel  = () => {};

export function injectDeps({ scheduleRecompute, syncControls, updateHoleEditor, updatePegTrayLabel }) {
  _scheduleRecompute  = scheduleRecompute;
  _syncControls       = syncControls;
  _updateHoleEditor   = updateHoleEditor;
  _updatePegTrayLabel = updatePegTrayLabel;
}

export function applyLayout(raw) {
  const { ok, data, errors } = validateLayout(raw);

  if (errors.length > 0) {
    const msgEl = document.getElementById('saveLoadStatus');
    msgEl.textContent = errors.join(' ');
    msgEl.style.color = 'var(--accent)';
    // Still apply the sanitised data
  }

  if (!data) throw new Error('Layout validation failed completely.');

  // Assign IDs to pegs and holes
  state.board.pegs = data.pegs.map(p => ({ id: nextPegId(), x: p.x, y: p.y }));
  state.board.holes = data.holes.map(h => ({
    id: nextHoleId(), x: h.x, width: h.width, reward: h.reward
  }));
  state.board.forceMin    = data.forceMin;
  state.board.forceMax    = data.forceMax;
  state.board.angleDeg    = data.angleDeg;
  state.board.gravity     = data.gravity;
  state.board.restitution = data.restitution;

  setPegMode(data.pegMode);
  _syncControls();
  _updatePegTrayLabel();
  _updateHoleEditor();
  drawBoard();
  _scheduleRecompute(true);
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------
export function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeLayout()));
    flashStatus('Layout saved to this browser.');
  } catch (err) {
    flashStatus('Could not save: ' + err.message, true);
  }
}

export function loadFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { flashStatus('No saved layout found.', true); return; }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { flashStatus('Saved layout is corrupt.', true); return; }

  // Detect legacy v1 angle convention (range was -45..45)
  if ((parsed.version ?? 1) < 2 && typeof parsed.angleDeg === 'number') {
    // Wrap negative angles into 0-360 space
    parsed.angleDeg = ((parsed.angleDeg % 360) + 360) % 360;
    parsed.version  = 2;
  }

  try {
    applyLayout(parsed);
    flashStatus('Layout loaded from this browser.');
  } catch (err) {
    flashStatus('Could not apply saved layout: ' + err.message, true);
  }
}

// ---------------------------------------------------------------------------
// JSON file import / export
// ---------------------------------------------------------------------------
export function exportJsonToFile() {
  const blob = new Blob([JSON.stringify(serializeLayout(), null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'pachinko-layout.json' });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flashStatus('Layout exported as pachinko-layout.json.');
}

export function importJsonFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyLayout(JSON.parse(reader.result));
      flashStatus('Layout imported from ' + file.name + '.');
    } catch (err) {
      flashStatus('Import failed: ' + err.message, true);
    }
  };
  reader.onerror = () => flashStatus('Could not read file.', true);
  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// Default Pascal-triangle layout  (5 rows = 15 pegs, 6 holes)
// ---------------------------------------------------------------------------
export function buildDefaultLayout() {
  const COL_SPACING = 62, ROW_SPACING = 55;
  const startY = 150;
  const pegs   = [];

  for (let row = 1; row <= 5; row++) {
    const y      = startY + (row - 1) * ROW_SPACING;
    const leftX  = BOARD.launchX - ((row - 1) / 2) * COL_SPACING;
    for (let col = 0; col < row; col++) {
      pegs.push({ x: +(leftX + col * COL_SPACING).toFixed(2), y });
    }
  }

  // 6 equal-width holes beneath the triangle
  const usableW  = BOARD.width - BOARD.wallThickness * 2;
  const holeW    = +(usableW / 6).toFixed(2);
  const rewards  = [1, 5, 10, 10, 5, 1]; // binomial-weight inspired
  const holes    = rewards.map((reward, i) => ({
    x:      +(BOARD.wallThickness + i * holeW).toFixed(2),
    width:  holeW,
    reward
  }));

  return {
    version: 2, pegs, holes,
    forceMin: 30, forceMax: 70, angleDeg: 0,
    gravity: 600, restitution: 0.78, pegMode: 'free'
  };
}

export function resetToDefaultLayout() {
  applyLayout(buildDefaultLayout());
  flashStatus('Reset to default Pascal-triangle layout.');
}

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------
export function flashStatus(msg, isError = false) {
  const el = document.getElementById('saveLoadStatus');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
}
