// Board editor — peg drag/drop, hole drag/resize, keyboard delete.

import { BOARD, MAX_PEGS, MIN_PEG_SEPARATION, SNAP_RADIUS } from './constants.js';
import { state, nextPegId } from './state.js';
import { canvas, SNAP_DOTS, isDotOccupied, getBoardCoords, drawBoard } from './renderer.js';

const { width: W, height: H, wallThickness: WALL, ballRadius: BR,
        pegRadius: PR, holeBandHeight: HBH, launchX: LX, launchY: LY } = BOARD;

const trashZone = document.getElementById('trashZone');

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function findPegAt(x, y) {
  const pegs = state.board.pegs;
  for (let i = pegs.length - 1; i >= 0; i--) {
    if (Math.hypot(pegs[i].x - x, pegs[i].y - y) <= PR + 4) return pegs[i];
  }
  return null;
}

function findHoleHandleAt(x, y) {
  const bandTop = H - HBH;
  if (y < bandTop - 6 || y > H) return null;
  for (const hole of state.board.holes) {
    if (x >= hole.x - 6 && x <= hole.x + 6)
      return { hole, mode: 'resize-left' };
    if (x >= hole.x + hole.width - 6 && x <= hole.x + hole.width + 6)
      return { hole, mode: 'resize-right' };
    if (x >= hole.x && x <= hole.x + hole.width)
      return { hole, mode: 'move' };
  }
  return null;
}

export function isValidPegPosition(x, y, excludeId = null) {
  if (x - PR < WALL || x + PR > W - WALL) return false;
  if (y - PR < LY + BR + 10 || y + PR > H - HBH - 10) return false;
  if (Math.hypot(x - LX, y - LY) < PR + BR + 26) return false;
  return !state.board.pegs.some(p =>
    p.id !== excludeId && Math.hypot(p.x - x, p.y - y) < MIN_PEG_SEPARATION
  );
}

function nearestSnapDot(x, y, excludeId = null) {
  let best = null, bestDist = Infinity;
  for (let i = 0; i < SNAP_DOTS.length; i++) {
    const dot = SNAP_DOTS[i];
    if (isDotOccupied(dot, excludeId)) continue;
    const d = Math.hypot(dot.x - x, dot.y - y);
    if (d < bestDist) { bestDist = d; best = { dot, index: i, dist: d }; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Hole overlap helpers
// ---------------------------------------------------------------------------
export function preventHoleOverlap(holeId, newLeft, width) {
  let adj = newLeft;
  for (const other of state.board.holes) {
    if (other.id === holeId) continue;
    if (adj < other.x + other.width && adj + width > other.x) {
      const pushR = other.x + other.width;
      const pushL = other.x - width;
      adj = Math.abs(pushR - newLeft) < Math.abs(pushL - newLeft) ? pushR : pushL;
    }
  }
  return clamp(adj, WALL, W - WALL - width);
}

export function clampHoleWidthForOverlap(holeId, left, width) {
  let maxW = width;
  for (const other of state.board.holes) {
    if (other.id === holeId) continue;
    if (other.x >= left) maxW = Math.min(maxW, other.x - left);
  }
  return Math.max(16, maxW);
}

// ---------------------------------------------------------------------------
// Peg add / remove
// ---------------------------------------------------------------------------
let scheduleRecomputeFn = () => {};
export function setScheduleRecompute(fn) { scheduleRecomputeFn = fn; }

export function addPeg(x, y) {
  if (state.board.pegs.length >= MAX_PEGS) return null;
  const peg = { id: nextPegId(), x, y };
  state.board.pegs.push(peg);
  state.ui.selectedPegId = peg.id;
  updatePegTrayLabel();
  scheduleRecomputeFn();
  return peg;
}

export function deletePeg(id) {
  const idx = state.board.pegs.findIndex(p => p.id === id);
  if (idx === -1) return;
  state.board.pegs.splice(idx, 1);
  if (state.ui.selectedPegId === id) state.ui.selectedPegId = null;
  updatePegTrayLabel();
  scheduleRecomputeFn();
  drawBoard();
}

export function clearAllPegs() {
  state.board.pegs = [];
  state.ui.selectedPegId = null;
  updatePegTrayLabel();
  scheduleRecomputeFn();
  drawBoard();
}

export function updatePegTrayLabel() {
  const used = state.board.pegs.length;
  const max  = MAX_PEGS;
  document.getElementById('pegCountLabel').textContent =
    `Peg bank: ${max - used} remaining (${used}/${max} placed)`;
  document.getElementById('pegTray').classList.toggle('tray-empty', used >= max);
}

// ---------------------------------------------------------------------------
// Hole editor DOM
// ---------------------------------------------------------------------------
let updateHoleEditorListFn = () => {};
export function setUpdateHoleEditorList(fn) { updateHoleEditorListFn = fn; }
export function triggerHoleEditorUpdate() { updateHoleEditorListFn(); }

// ---------------------------------------------------------------------------
// Trash zone
// ---------------------------------------------------------------------------
function showTrash(armed) {
  trashZone.classList.add('visible');
  trashZone.classList.toggle('armed', !!armed);
}
function hideTrash() { trashZone.classList.remove('visible', 'armed'); }

// ---------------------------------------------------------------------------
// Pointer events — canvas
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', onCanvasPointerDown);
window.addEventListener('pointermove',  onPointerMove);
window.addEventListener('pointerup',    onPointerUp);
canvas.addEventListener('contextmenu',  onCanvasRightClick);

function onCanvasPointerDown(e) {
  if (e.button === 2) return; // right-click handled in contextmenu
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  state.ui.isPointerDown = true;

  const holeHit = findHoleHandleAt(x, y);
  if (holeHit) {
    state.ui.draggingHole = {
      id: holeHit.hole.id, mode: holeHit.mode,
      startPointerX: x, startLeft: holeHit.hole.x, startWidth: holeHit.hole.width
    };
    state.ui.selectedPegId = null;
    return;
  }

  const peg = findPegAt(x, y);
  if (peg) {
    canvas.setPointerCapture(e.pointerId);
    state.ui.selectedPegId = peg.id;
    state.ui.draggingPeg   = { id: peg.id, fromTray: false, x: peg.x, y: peg.y };
    drawBoard();
    return;
  }

  state.ui.selectedPegId = null;
  drawBoard();
}

function onPointerMove(e) {
  if (!state.ui.isPointerDown) return;
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  if (state.ui.draggingPeg)  { handlePegDragMove(x, y, e); return; }
  if (state.ui.draggingHole) { handleHoleDragMove(x, y);   return; }
}

function onPointerUp(e) {
  if (state.ui.draggingPeg)  finishPegDrag(e);
  if (state.ui.draggingHole) {
    state.ui.draggingHole = null;
    scheduleRecomputeFn();
  }
  state.ui.isPointerDown = false;
  hideTrash();
}

function onCanvasRightClick(e) {
  e.preventDefault();
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  const peg = findPegAt(x, y);
  if (peg) deletePeg(peg.id);
}

function handlePegDragMove(x, y, e) {
  const dragging = state.ui.draggingPeg;
  dragging.x = x; dragging.y = y;

  const trashRect = trashZone.getBoundingClientRect();
  const overTrash = e.clientX >= trashRect.left && e.clientX <= trashRect.right &&
                    e.clientY >= trashRect.top  && e.clientY <= trashRect.bottom;
  showTrash(overTrash);
  dragging.overTrash = overTrash;

  if (state.pegMode === 'assisted' && !overTrash) {
    const excludeId = dragging.fromTray ? null : dragging.id;
    const nearest   = nearestSnapDot(x, y, excludeId);
    state.ui.hoverDotIndex = (nearest && nearest.dist <= SNAP_RADIUS) ? nearest.index : -1;
  } else {
    state.ui.hoverDotIndex = -1;
  }

  drawBoard();
}

function finishPegDrag(e) {
  const dragging = state.ui.draggingPeg;
  state.ui.draggingPeg   = null;
  state.ui.hoverDotIndex = -1;

  if (dragging.overTrash) {
    if (!dragging.fromTray) deletePeg(dragging.id);
    drawBoard();
    return;
  }

  let fx = dragging.x, fy = dragging.y;
  if (state.pegMode === 'assisted') {
    const nearest = nearestSnapDot(fx, fy, dragging.fromTray ? null : dragging.id);
    if (nearest && nearest.dist <= SNAP_RADIUS) { fx = nearest.dot.x; fy = nearest.dot.y; }
  }

  const excludeId = dragging.fromTray ? null : dragging.id;
  if (!isValidPegPosition(fx, fy, excludeId)) { drawBoard(); return; }

  if (dragging.fromTray) {
    addPeg(fx, fy);
  } else {
    const peg = state.board.pegs.find(p => p.id === dragging.id);
    if (peg) { peg.x = fx; peg.y = fy; }
    scheduleRecomputeFn();
  }
  drawBoard();
}

function handleHoleDragMove(x, y) {
  const ds   = state.ui.draggingHole;
  const hole = state.board.holes.find(h => h.id === ds.id);
  if (!hole) return;

  const MIN_W = 16;

  if (ds.mode === 'move') {
    const delta  = x - ds.startPointerX;
    let newLeft  = ds.startLeft + delta;
    newLeft      = clamp(newLeft, WALL, W - WALL - hole.width);
    hole.x       = preventHoleOverlap(hole.id, newLeft, hole.width);
  } else if (ds.mode === 'resize-left') {
    let newLeft  = clamp(x, WALL, ds.startLeft + ds.startWidth - MIN_W);
    const newW   = (ds.startLeft + ds.startWidth) - newLeft;
    const adjL   = preventHoleOverlap(hole.id, newLeft, newW);
    hole.x       = adjL;
    hole.width   = (ds.startLeft + ds.startWidth) - adjL;
  } else if (ds.mode === 'resize-right') {
    let newRight = clamp(x, ds.startLeft + MIN_W, W - WALL);
    let newW     = newRight - ds.startLeft;
    hole.width   = clampHoleWidthForOverlap(hole.id, ds.startLeft, newW);
  }

  // Reflect actual values back into inputs so typed values stay consistent
  updateHoleEditorListFn();
  drawBoard();
  scheduleRecomputeFn();
}

// ---------------------------------------------------------------------------
// Tray peg dragging
// ---------------------------------------------------------------------------
const trayPegEl = document.getElementById('trayPeg');
trayPegEl.addEventListener('pointerdown', (e) => {
  if (state.board.pegs.length >= MAX_PEGS) return;
  e.preventDefault();
  state.ui.isPointerDown = true;
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  state.ui.draggingPeg = { id: 'new-' + Date.now(), fromTray: true, x, y };
});

// ---------------------------------------------------------------------------
// Keyboard delete for selected peg
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.ui.selectedPegId !== null) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    deletePeg(state.ui.selectedPegId);
    e.preventDefault();
  }
});

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------
export function setPegMode(mode) {
  state.pegMode = mode;
  document.getElementById('modeFreeBtn').classList.toggle('active', mode === 'free');
  document.getElementById('modeAssistedBtn').classList.toggle('active', mode === 'assisted');
  document.getElementById('modeIndicator').innerHTML = mode === 'free'
    ? 'Mode: <strong>Free Edit</strong> — drag pegs anywhere on the board.'
    : 'Mode: <strong>Dotted Assisted</strong> — pegs snap to the triangular guide grid.';
  drawBoard();
}

document.getElementById('modeFreeBtn').addEventListener('click',     () => setPegMode('free'));
document.getElementById('modeAssistedBtn').addEventListener('click', () => setPegMode('assisted'));
