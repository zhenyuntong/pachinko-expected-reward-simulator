// Pure canvas rendering.  Reads state; never mutates it.

import { BOARD, HOLE_COLORS } from './constants.js';
import { state } from './state.js';

const { width: W, height: H, wallThickness: WALL, ballRadius: R,
        pegRadius: PR, holeBandHeight: HBH, launchX: LX, launchY: LY } = BOARD;

export const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Triangular snap-dot grid for Dotted Assisted mode
// ---------------------------------------------------------------------------
export const SNAP_DOTS = (() => {
  const dots = [];
  const rowSp = 46, colSp = 46, mX = 50, mTop = 90, mBot = HBH + 40;
  let row = 0;
  for (let y = mTop; y <= H - mBot; y += rowSp) {
    const off = (row % 2 === 0) ? 0 : colSp / 2;
    for (let x = mX + off; x <= W - mX; x += colSp) dots.push({ x, y });
    row++;
  }
  return dots;
})();

export function isDotOccupied(dot, excludeId = null) {
  return state.board.pegs.some(p =>
    p.id !== excludeId && Math.hypot(p.x - dot.x, p.y - dot.y) < 4
  );
}

// ---------------------------------------------------------------------------
// getBoardCoords — converts pointer client coords to board pixel coords.
// ---------------------------------------------------------------------------
export function getBoardCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left)  * (W / rect.width),
    y: (clientY - rect.top)   * (H / rect.height)
  };
}

// ---------------------------------------------------------------------------
// Main draw entry point
// ---------------------------------------------------------------------------
export function drawBoard() {
  ctx.clearRect(0, 0, W, H);

  drawBackground();
  if (state.pegMode === 'assisted') drawSnapDots();
  drawWalls();
  drawLauncher();
  drawPegs();
  drawSessionBalls();
  drawPreviewAnimation();
  drawHoles();
}

function drawBackground() {
  ctx.fillStyle = '#0a090d';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.025)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawWalls() {
  ctx.fillStyle = '#2a2832';
  ctx.fillRect(0, 0, WALL, H);
  ctx.fillRect(W - WALL, 0, WALL, H);
}

function drawSnapDots() {
  SNAP_DOTS.forEach((dot, idx) => {
    const occupied = isDotOccupied(dot);
    const hovered  = idx === state.ui.hoverDotIndex;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, hovered ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = occupied ? 'rgba(227,166,79,0.18)'
                  : hovered  ? 'rgba(227,166,79,0.65)'
                             : 'rgba(255,255,255,0.10)';
    ctx.fill();
  });
}

function drawLauncher() {
  const aRad = (state.board.angleDeg * Math.PI) / 180;
  const len  = 30;
  const ex   = LX + len * Math.sin(aRad);
  const ey   = LY - len * Math.cos(aRad);

  ctx.save();
  ctx.strokeStyle = 'rgba(227,166,79,0.55)';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(LX, LY);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Arrowhead
  const headLen  = 8;
  const headAngle = 0.42; // radians
  const dir       = Math.atan2(ey - LY, ex - LX);
  ctx.strokeStyle = 'rgba(227,166,79,0.85)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(dir - headAngle), ey - headLen * Math.sin(dir - headAngle));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(dir + headAngle), ey - headLen * Math.sin(dir + headAngle));
  ctx.stroke();

  // Launch origin dot
  ctx.beginPath();
  ctx.arc(LX, LY, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#e3a64f';
  ctx.fill();
  ctx.restore();
}

function drawPegs() {
  const draggingId = state.ui.draggingPeg && !state.ui.draggingPeg.fromTray
    ? state.ui.draggingPeg.id : null;

  state.board.pegs.forEach(peg => {
    if (peg.id !== draggingId) drawPeg(peg, state.ui.selectedPegId === peg.id);
  });

  if (state.ui.draggingPeg) drawDragGhost(state.ui.draggingPeg);
}

function drawPeg(peg, selected = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(peg.x + 1.5, peg.y + 2, PR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  const grad = ctx.createRadialGradient(peg.x - 3, peg.y - 3, 1, peg.x, peg.y, PR);
  grad.addColorStop(0,    '#ffe2ad');
  grad.addColorStop(0.55, '#e3a64f');
  grad.addColorStop(1,    '#9c6f2c');

  ctx.beginPath();
  ctx.arc(peg.x, peg.y, PR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  if (selected) {
    ctx.lineWidth   = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.restore();
}

function drawDragGhost(dragging) {
  let gx = dragging.x, gy = dragging.y;
  if (state.pegMode === 'assisted' && state.ui.hoverDotIndex >= 0) {
    const dot = SNAP_DOTS[state.ui.hoverDotIndex];
    gx = dot.x; gy = dot.y;
  }

  ctx.save();
  ctx.globalAlpha = dragging.overTrash ? 0.3 : 0.85;

  ctx.beginPath();
  ctx.arc(gx + 1.5, gy + 2, PR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  const grad = ctx.createRadialGradient(gx - 3, gy - 3, 1, gx, gy, PR);
  grad.addColorStop(0,    '#ffe2ad');
  grad.addColorStop(0.55, '#e3a64f');
  grad.addColorStop(1,    '#9c6f2c');

  ctx.beginPath();
  ctx.arc(gx, gy, PR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth   = 2;
  ctx.strokeStyle = dragging.overTrash ? '#d9695f' : '#ffffff';
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------
export function drawHoles() {
  const bandTop = H - HBH;

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(WALL, bandTop, W - WALL * 2, HBH);

  state.board.holes.forEach((hole, idx) => {
    const color    = HOLE_COLORS[idx % HOLE_COLORS.length];
    const dragging = state.ui.draggingHole && state.ui.draggingHole.id === hole.id;

    ctx.save();
    if (dragging) ctx.globalAlpha = 0.75;

    ctx.fillStyle = color;
    ctx.fillRect(hole.x, bandTop, hole.width, HBH);

    // Resize handles
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(hole.x, bandTop, 4, HBH);
    ctx.fillRect(hole.x + hole.width - 4, bandTop, 4, HBH);

    // Reward label
    if (hole.width > 28) {
      ctx.fillStyle   = '#0a090d';
      ctx.font        = "600 12px 'JetBrains Mono', Menlo, monospace";
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(hole.reward), hole.x + hole.width / 2, bandTop + HBH / 2);
    }
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// Session balls (real-time)
// ---------------------------------------------------------------------------
function drawSessionBalls() {
  for (const ball of state.session.balls) {
    if (ball.lingerFrames > 0) {
      const alpha = Math.max(0, 1 - ball.lingerFrames / 60);
      drawBallShape(ball.x, ball.y, alpha);
      continue;
    }
    // Trail
    if (ball.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(227,166,79,0.30)';
      ctx.lineWidth   = 1.5;
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(ball.trail[0].x, ball.trail[0].y);
      for (let i = 1; i < ball.trail.length; i++) ctx.lineTo(ball.trail[i].x, ball.trail[i].y);
      ctx.stroke();
      ctx.restore();
    }
    drawBallShape(ball.x, ball.y, 1);
  }
}

// ---------------------------------------------------------------------------
// Preview animation
// ---------------------------------------------------------------------------
function drawPreviewAnimation() {
  const anim = state.preview;
  if (!anim) return;

  if (anim.trajectory && anim.trajectory.length > 1) {
    const end = anim.progressIndex !== undefined
      ? Math.min(anim.progressIndex + 1, anim.trajectory.length)
      : anim.trajectory.length;
    if (end >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(227,166,79,0.85)';
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(anim.trajectory[0].x, anim.trajectory[0].y);
      for (let i = 1; i < end; i++) ctx.lineTo(anim.trajectory[i].x, anim.trajectory[i].y);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (anim.ballPos) drawBallShape(anim.ballPos.x, anim.ballPos.y, 1);
}

function drawBallShape(x, y, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createRadialGradient(x - 2, y - 2, 0.5, x, y, R);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#cfcabf');
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth   = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.stroke();
  ctx.restore();
}
