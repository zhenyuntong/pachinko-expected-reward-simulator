'use strict';
/* =========================================================================
   Pachinko Expected Reward Simulator — single-file build
   No ES-module imports; works via file:// without a server.
   ========================================================================= */

/* =========================================================================
   0. WEB WORKER SOURCE  (Blob-based, works with file://)
   Physics + sampler duplicated here so the worker is self-contained.
   ========================================================================= */

const WORKER_SRC = `
'use strict';
const W=640,H=720,WALL=6,R=7,PR=8,HBH=30,LX=320,LY=34;
const BL=WALL+R,BR=W-WALL-R,BB=H-HBH,BT=R,F2S=4,DT=1/240;
const S={n0:25,maxD:10,maxN:1500,rdt:0.5};

function step(b,bs){
  const{pegs,holes,gravity:g,restitution:e}=bs;
  const spd=Math.sqrt(b.vx*b.vx+b.vy*b.vy);
  const ns=Math.max(1,Math.ceil(spd*DT/(R*0.4))),dt=DT/ns;
  for(let s=0;s<ns;s++){
    b.vy+=g*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.x<BL){b.x=BL;b.vx=-b.vx*e;}else if(b.x>BR){b.x=BR;b.vx=-b.vx*e;}
    if(b.y<BT){b.y=BT;b.vy=Math.abs(b.vy)*e;}
    for(let i=0;i<pegs.length;i++){
      const p=pegs[i],dx=b.x-p.x,dy=b.y-p.y,dSq=dx*dx+dy*dy,md=R+PR;
      if(dSq<md*md&&dSq>1e-9){
        const d=Math.sqrt(dSq);let nx=dx/d,ny=dy/d;
        if(Math.abs(nx)<1e-3){nx+=(i%2?-1:1)*.02;const L=Math.sqrt(nx*nx+ny*ny);nx/=L;ny/=L;}
        const ov=md-d;b.x+=nx*ov;b.y+=ny*ov;
        const vn=b.vx*nx+b.vy*ny;if(vn<0){b.vx-=nx*vn*(1+e);b.vy-=ny*vn*(1+e);}
      }
    }
    if(b.y>=BB){
      b.y=BB;let hi=-1,rw=0;
      for(let h=0;h<holes.length;h++){const ho=holes[h];if(b.x>=ho.x&&b.x<=ho.x+ho.width){hi=h;rw=ho.reward;break;}}
      return{landed:true,reward:rw,holeIndex:hi};
    }
  }
  return{landed:false};
}

function sim(force,ang,bs){
  const spd=force*F2S,rad=ang*Math.PI/180;
  const b={x:LX,y:LY,vx:spd*Math.sin(rad),vy:-spd*Math.cos(rad)};
  const disc=b.vy*b.vy+2*bs.gravity*(BB-LY);
  const tMin=disc>=0?(-b.vy+Math.sqrt(Math.max(0,disc)))/bs.gravity:10;
  const maxSt=Math.ceil(Math.max(tMin*10,5)/DT);
  for(let i=0;i<maxSt;i++){const r=step(b,bs);if(r.landed)return r;}
  return{landed:true,reward:0,holeIndex:-1};
}

function makeEv(ang,bs){
  const cache=new Map();let n=0;
  return{eval(f){const k=Math.round(f*1e4);if(cache.has(k))return cache.get(k);const r=sim(f,ang,bs);cache.set(k,r);n++;return r;},get count(){return n;}};
}

function calcER(fMin,fMax,ang,bs){
  if(!(fMax>fMin)){
    const e=makeEv(ang,bs),r=e.eval(fMin);
    return{expectedReward:r.reward,holeProbabilities:bs.holes.map((_,i)=>r.holeIndex===i?1:0),zeroProbability:r.holeIndex===-1?1:0,samplesUsed:1,capReached:false};
  }
  const e=makeEv(ang,bs),nH=bs.holes.length;
  const maxM=Math.max(1,...bs.holes.map(h=>Math.abs(h.reward)));
  let pts=[];
  for(let i=0;i<S.n0;i++){const f=fMin+(fMax-fMin)*(i/(S.n0-1));pts.push({force:f,result:e.eval(f)});}
  let mDH=false;
  function refine(p,d){
    if(d>=S.maxD){mDH=true;return p;}
    if(e.count>=S.maxN)return p;
    const out=[p[0]];
    for(let i=0;i<p.length-1;i++){
      const a=p[i],b=p[i+1];
      if(e.count>=S.maxN){out.push(b);continue;}
      const mf=(a.force+b.force)/2,m={force:mf,result:e.eval(mf)};
      const ld=a.result.holeIndex!==m.result.holeIndex||Math.abs(a.result.reward-m.result.reward)/maxM>S.rdt;
      const rd=m.result.holeIndex!==b.result.holeIndex||Math.abs(m.result.reward-b.result.reward)/maxM>S.rdt;
      if(ld||rd){const ls=refine([a,m],d+1),rs=refine([m,b],d+1);for(let k=0;k<ls.length-1;k++)out.push(ls[k]);out.push(...rs);}
      else out.push(b);
    }
    return out;
  }
  pts=refine(pts,0);
  const tw=fMax-fMin;let intg=0;
  for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];intg+=(b.force-a.force)*(a.result.reward+b.result.reward)/2;}
  const expR=intg/tw,hM=new Array(nH).fill(0);let zM=0;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],w=b.force-a.force;
    if(a.result.holeIndex===b.result.holeIndex){if(a.result.holeIndex===-1)zM+=w;else hM[a.result.holeIndex]+=w;}
    else{const h=w/2;if(a.result.holeIndex===-1)zM+=h;else hM[a.result.holeIndex]+=h;if(b.result.holeIndex===-1)zM+=h;else hM[b.result.holeIndex]+=h;}
  }
  return{expectedReward:expR,holeProbabilities:hM.map(m=>m/tw),zeroProbability:zM/tw,samplesUsed:e.count,capReached:mDH||e.count>=S.maxN,debug:{intervals:pts.length-1,maxDepthHit:mDH}};
}
self.onmessage=function(e){const{fMin,fMax,ang,bs,ver}=e.data;self.postMessage({result:calcER(fMin,fMax,ang,bs),ver});};
`;

/* =========================================================================
   1. CONSTANTS
   ========================================================================= */

const BOARD = {
  width: 640, height: 720,
  ballRadius: 7, pegRadius: 8,
  wallThickness: 6,
  launchX: 320, launchY: 34,
  holeBandHeight: 30
};

const MAX_PEGS  = 21;
const MAX_HOLES = 6;
const MIN_PEG_SEPARATION = BOARD.pegRadius * 2 + 4;

// Warm editorial hole colours — muted, on-cream readable
const HOLE_COLORS = ['#3d7870','#8a6818','#944028','#3c5090','#604090','#2d6840'];

const FORCE_TO_SPEED          = 4;
const SIM_DT                  = 1 / 240;
const MAX_BALLS_IN_FLIGHT     = 5;
const SESSION_STEPS_PER_FRAME = 8;   // 8 steps/frame ≈ 2× real time → comparable to 1.4s preview playback
const AUTO_FIRE_INTERVAL_MS   = 500;
const BALL_LINGER_FRAMES      = 60;
const TRAIL_FADE_MS           = 18000; // completed trail fades over 18 s once fade starts
const MAX_COMPLETED_TRAILS    = 25;

const W    = BOARD.width,  H    = BOARD.height;
const WALL = BOARD.wallThickness;
const R    = BOARD.ballRadius, PR = BOARD.pegRadius;
const HBH  = BOARD.holeBandHeight;
const LX   = BOARD.launchX,   LY = BOARD.launchY;
const BLEFT   = WALL + R;
const BRIGHT  = W - WALL - R;
const BBOTTOM = H - HBH;
const BTOP    = R;

// ── Unified staggered grid ──────────────────────────────────────────────────
// One grid, centred at the launcher, using Pascal spacing (62 × 55 px).
// Pascal row n (0-indexed) sits on grid row n starting at GRID_ORIGIN_Y.
// This means the default Pascal layout aligns EXACTLY with the grid.
const COL_GRID      = 62;
const ROW_GRID      = 55;
const GRID_ORIGIN_X = LX;    // centred on launcher
const GRID_ORIGIN_Y = 150;   // first Pascal row Y

// First 5 rows of the unified grid = the 15 Pascal guide positions.
const PASCAL_GUIDE_DOTS = (() => {
  const dots = [];
  for (let row = 0; row < 5; row++) {
    const y    = GRID_ORIGIN_Y + row * ROW_GRID;
    const leftX = GRID_ORIGIN_X - (row / 2) * COL_GRID;
    for (let col = 0; col <= row; col++)
      dots.push({ x: +(leftX + col * COL_GRID).toFixed(2), y });
  }
  return dots;
})();

// Full staggered grid extending across the usable board area.
const UNIFIED_GRID = (() => {
  const dots = [];
  const minX = WALL + PR + 2,  maxX = W - WALL - PR - 2;
  const minY = LY + PR + 16,   maxY = H - HBH - PR - 10;
  const rowMin = Math.ceil((minY  - GRID_ORIGIN_Y) / ROW_GRID);
  const rowMax = Math.floor((maxY - GRID_ORIGIN_Y) / ROW_GRID);
  for (let ri = rowMin; ri <= rowMax; ri++) {
    const y   = GRID_ORIGIN_Y + ri * ROW_GRID;
    if (y < minY || y > maxY) continue;
    // Even row-index: centred at GRID_ORIGIN_X; odd: offset by COL/2
    const xOff = (ri % 2 !== 0) ? COL_GRID / 2 : 0;
    for (let ci = -10; ci <= 10; ci++) {
      const x = GRID_ORIGIN_X + xOff + ci * COL_GRID;
      if (x >= minX && x <= maxX) dots.push({ x: +x.toFixed(2), y });
    }
  }
  return dots;
})();

const SNAP_RADIUS = 22;   // snap to unified grid in assisted mode

/* =========================================================================
   2. STATE
   ========================================================================= */

const state = {
  board: {
    pegs: [], holes: [],
    forceMin: 30, forceMax: 70,
    angleDeg: 0, gravity: 600, restitution: 0.78
  },
  pegMode: 'free',
  ui: {
    selectedPegId:   null,
    draggingPeg:     null,
    draggingHole:    null,
    hoverDotIndex:   -1,
    snapTarget:      null,
    isPointerDown:   false,
    showPascalGuide: true,
    draggingArrow:   false,   // true while user rotates the launch arrow
    editHoles:       false,   // true while hole resize handles are shown
    stickyHoles:     false    // true = neighbours fill gaps when a hole shrinks
  },
  expected: null,
  session: {
    active: false, mode: 'single',
    balls: [],
    completedTrails: [],   // { trail, fadeStartAt: null|timestamp }  — null = still bright
    shotsCompleted: 0, totalReward: 0,
    holeHits: [], misses: 0, timedOuts: 0,
    lastFireTime: 0, rafId: null, holdActive: false
  },
  preview: null
};

let _pegId = 1, _holeId = 1, _ballId = 1;
function nextPegId()  { return _pegId++;  }
function nextHoleId() { return _holeId++; }
function nextBallId() { return _ballId++; }

/* =========================================================================
   3. PHYSICS  (unchanged)
   ========================================================================= */

function physicsStep(ball, boardState) {
  const { pegs, holes, gravity, restitution } = boardState;
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const subs  = Math.max(1, Math.ceil(speed * SIM_DT / (R * 0.4)));
  const dt    = SIM_DT / subs;

  for (let s = 0; s < subs; s++) {
    ball.vy += gravity * dt;
    ball.x  += ball.vx * dt;
    ball.y  += ball.vy * dt;

    if (ball.x < BLEFT)       { ball.x = BLEFT;  ball.vx = -ball.vx * restitution; }
    else if (ball.x > BRIGHT) { ball.x = BRIGHT;  ball.vx = -ball.vx * restitution; }
    if (ball.y < BTOP) { ball.y = BTOP; ball.vy = Math.abs(ball.vy) * restitution; }

    for (let i = 0; i < pegs.length; i++) {
      const peg = pegs[i];
      const dx = ball.x - peg.x, dy = ball.y - peg.y;
      const distSq = dx * dx + dy * dy, minDist = R + PR;
      if (distSq < minDist * minDist && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        let nx = dx / dist, ny = dy / dist;
        if (Math.abs(nx) < 1e-3) {
          nx += (i % 2 === 0 ? 1 : -1) * 0.02;
          const L = Math.sqrt(nx * nx + ny * ny); nx /= L; ny /= L;
        }
        const overlap = minDist - dist;
        ball.x += nx * overlap; ball.y += ny * overlap;
        const vDotN = ball.vx * nx + ball.vy * ny;
        if (vDotN < 0) { ball.vx -= nx * vDotN * (1 + restitution); ball.vy -= ny * vDotN * (1 + restitution); }
      }
    }

    if (ball.y >= BBOTTOM) {
      ball.y = BBOTTOM;
      let holeIndex = -1, reward = 0;
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        if (ball.x >= hole.x && ball.x <= hole.x + hole.width) { holeIndex = h; reward = hole.reward; break; }
      }
      return { landed: true, reward, holeIndex, timedOut: false };
    }
  }
  return { landed: false };
}

function createBall(id, force, angleDeg) {
  const speed = force * FORCE_TO_SPEED, rad = (angleDeg * Math.PI) / 180;
  return {
    id, x: LX, y: LY,
    vx: speed * Math.sin(rad), vy: -speed * Math.cos(rad),
    force, done: false, reward: 0, holeIndex: -1, timedOut: false,
    lingerFrames: 0, trail: [{ x: LX, y: LY }], trailCounter: 0
  };
}

function simulateShot(force, angleDeg, boardState, opts = {}) {
  const record = !!opts.recordTrajectory, { gravity } = boardState;
  const speed = force * FORCE_TO_SPEED, rad = (angleDeg * Math.PI) / 180;
  const ball = { x: LX, y: LY, vx: speed * Math.sin(rad), vy: -speed * Math.cos(rad) };
  const disc = ball.vy * ball.vy + 2 * gravity * (BBOTTOM - LY);
  const tMin = disc >= 0 ? (-ball.vy + Math.sqrt(Math.max(0, disc))) / gravity : 10;
  const maxSteps = Math.ceil(Math.max(tMin * 10, 5) / SIM_DT);
  const trajectory = record ? [{ x: ball.x, y: ball.y }] : null;
  let tc = 0;
  for (let step = 0; step < maxSteps; step++) {
    const result = physicsStep(ball, boardState);
    if (record) { tc++; if (tc >= 2) { trajectory.push({ x: ball.x, y: ball.y }); tc = 0; } }
    if (result.landed) {
      if (record) trajectory.push({ x: ball.x, y: ball.y });
      return { reward: result.reward, holeIndex: result.holeIndex, trajectory: trajectory || [], timedOut: false };
    }
  }
  if (record) trajectory.push({ x: ball.x, y: ball.y });
  return { reward: 0, holeIndex: -1, trajectory: trajectory || [], timedOut: true };
}

/* =========================================================================
   4. EXPECTED-REWARD SAMPLER  (main-thread fallback; worker has its own copy)
   Improved: 25 initial samples, depth 10, 1500 cap.
   ========================================================================= */

const SAMPLER = { initialSamples: 25, maxDepth: 10, maxTotalSamples: 1500, rewardDeltaThreshold: 0.5 };

function makeShotEvaluator(angleDeg, boardState) {
  const cache = new Map(); let evalCount = 0;
  return {
    eval(force) {
      const key = Math.round(force * 1e4);
      if (cache.has(key)) return cache.get(key);
      const r = simulateShot(force, angleDeg, boardState); cache.set(key, r); evalCount++;
      return r;
    },
    get count() { return evalCount; }
  };
}

function calculateExpectedReward(forceMin, forceMax, angleDeg, boardState) {
  if (!(forceMax > forceMin)) {
    const ev = makeShotEvaluator(angleDeg, boardState), res = ev.eval(forceMin);
    return { expectedReward: res.reward, holeProbabilities: boardState.holes.map((_, i) => (res.holeIndex === i ? 1 : 0)),
             zeroProbability: res.holeIndex === -1 ? 1 : 0, samplesUsed: 1, capReached: false };
  }
  const ev = makeShotEvaluator(angleDeg, boardState), numHoles = boardState.holes.length;
  const maxMag = Math.max(1, ...boardState.holes.map(h => Math.abs(h.reward)));
  const n0 = SAMPLER.initialSamples;
  let points = [];
  for (let i = 0; i < n0; i++) {
    const f = forceMin + (forceMax - forceMin) * (i / (n0 - 1));
    points.push({ force: f, result: ev.eval(f) });
  }
  let maxDepthHit = false;
  function refine(pts, depth) {
    if (depth >= SAMPLER.maxDepth) { maxDepthHit = true; return pts; }
    if (ev.count >= SAMPLER.maxTotalSamples) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (ev.count >= SAMPLER.maxTotalSamples) { out.push(b); continue; }
      const mf = (a.force + b.force) / 2, m = { force: mf, result: ev.eval(mf) };
      const ld = a.result.holeIndex !== m.result.holeIndex || Math.abs(a.result.reward - m.result.reward) / maxMag > SAMPLER.rewardDeltaThreshold;
      const rd = m.result.holeIndex !== b.result.holeIndex || Math.abs(m.result.reward - b.result.reward) / maxMag > SAMPLER.rewardDeltaThreshold;
      if (ld || rd) {
        const ls = refine([a, m], depth + 1), rs = refine([m, b], depth + 1);
        for (let k = 0; k < ls.length - 1; k++) out.push(ls[k]); out.push(...rs);
      } else out.push(b);
    }
    return out;
  }
  points = refine(points, 0);
  const totalWidth = forceMax - forceMin; let integral = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    integral += (b.force - a.force) * (a.result.reward + b.result.reward) / 2;
  }
  const expectedReward = integral / totalWidth;
  const holeMass = new Array(numHoles).fill(0); let zeroMass = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], w = b.force - a.force;
    if (a.result.holeIndex === b.result.holeIndex) {
      if (a.result.holeIndex === -1) zeroMass += w; else holeMass[a.result.holeIndex] += w;
    } else {
      const half = w / 2;
      if (a.result.holeIndex === -1) zeroMass += half; else holeMass[a.result.holeIndex] += half;
      if (b.result.holeIndex === -1) zeroMass += half; else holeMass[b.result.holeIndex] += half;
    }
  }
  return { expectedReward, holeProbabilities: holeMass.map(m => m / totalWidth), zeroProbability: zeroMass / totalWidth,
           samplesUsed: ev.count, capReached: maxDepthHit || ev.count >= SAMPLER.maxTotalSamples,
           debug: { intervals: points.length - 1, maxDepthHit } };
}

/* =========================================================================
   5. LAYOUT VALIDATION  (unchanged)
   ========================================================================= */

function safeNum(v, fallback) { const n = Number(v); return (isFinite(n) && !isNaN(n)) ? n : fallback; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function validateLayout(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, data: null, errors: ['Layout must be a JSON object.'] };
  const errors = [];
  let forceMin = clamp(safeNum(raw.forceMin, 30), 1, 100);
  let forceMax = clamp(safeNum(raw.forceMax, 70), 1, 100);
  let angleDeg = ((safeNum(raw.angleDeg, 0) % 360) + 360) % 360;
  let gravity  = clamp(safeNum(raw.gravity, 600), 50, 2000);
  let restitution = clamp(safeNum(raw.restitution, 0.78), 0.1, 1.0);
  if (forceMin >= forceMax) { forceMin = Math.max(1, forceMax - 1); errors.push('forceMin adjusted.'); }
  const rawPegs = Array.isArray(raw.pegs) ? raw.pegs.slice(0, MAX_PEGS) : [];
  const pegMinX = WALL + PR, pegMaxX = W - WALL - PR;
  const pegMinY = LY + PR + 10, pegMaxY = H - HBH - PR - 10;
  const pegs = [];
  for (const p of rawPegs) {
    const x = clamp(safeNum(p.x, LX), pegMinX, pegMaxX);
    const y = clamp(safeNum(p.y, 200), pegMinY, pegMaxY);
    if (Math.hypot(x - LX, y - LY) < PR + R + 26) { errors.push('Peg near launcher removed.'); continue; }
    if (pegs.some(q => Math.hypot(q.x - x, q.y - y) < MIN_PEG_SEPARATION)) { errors.push('Overlapping peg removed.'); continue; }
    pegs.push({ x, y });
  }
  let rawHoles = Array.isArray(raw.holes) ? raw.holes : [];
  // 0 holes is allowed — all balls become misses
  const holeMinW = 16, holeMaxW = W - WALL * 2;
  const sortedHoles = rawHoles.slice(0, MAX_HOLES).map(h => ({
    x: clamp(safeNum(h.x, WALL), WALL, W - WALL - holeMinW),
    width: clamp(safeNum(h.width, 60), holeMinW, holeMaxW),
    reward: safeNum(h.reward, 0)
  })).sort((a, b) => a.x - b.x);
  const holes = [];
  for (const h of sortedHoles) {
    const right = Math.min(h.x + h.width, W - WALL), width = right - h.x;
    if (width < holeMinW) { errors.push('Hole too narrow; skipped.'); continue; }
    const prev = holes[holes.length - 1];
    if (prev && h.x < prev.x + prev.width) { errors.push('Overlapping hole removed.'); continue; }
    holes.push({ x: h.x, width, reward: h.reward });
  }
  // holes.length === 0 is valid — empty board, all shots are misses
  return { ok: errors.length === 0,
           data: { pegs, holes, forceMin, forceMax, angleDeg, gravity, restitution,
                   pegMode: raw.pegMode === 'assisted' ? 'assisted' : 'free', version: 2 }, errors };
}

/* =========================================================================
   6. CANVAS RENDERER  — warm parchment board, flat minimal style
   ========================================================================= */

const canvas = document.getElementById('boardCanvas');
const ctx    = canvas.getContext('2d');

// ── DPR scaling — renders at native resolution on retina / high-DPI screens.
// All drawing code continues to use logical coordinates (0..W, 0..H).
// Memory is bounded: cap at 2× so a 3× device still uses max 4× canvas memory.
const _dpr = Math.min(window.devicePixelRatio || 1, 2);
(function initCanvasDPR() {
  canvas.width        = Math.round(W * _dpr);
  canvas.height       = Math.round(H * _dpr);
  canvas.style.width  = W + 'px';   // hold logical CSS size
  // height: auto in CSS scales correctly from intrinsic aspect ratio
  ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
})();

// ── Static background cached in an OffscreenCanvas.
// Rebuilt once at startup (and whenever board theme changes).
// Drawing the cache each frame avoids re-issuing fill/stroke commands for
// elements that never change: parchment field, walls, hole-band separator.
let _bgCache = null;

function buildBgCache() {
  if (typeof OffscreenCanvas === 'undefined') return;  // fallback: skip cache
  _bgCache = new OffscreenCanvas(Math.round(W * _dpr), Math.round(H * _dpr));
  const g  = _bgCache.getContext('2d');
  g.scale(_dpr, _dpr);

  g.fillStyle = '#f6f2ea';
  g.fillRect(0, 0, W, H);

  g.fillStyle = '#d8d0c0';
  g.fillRect(0, 0, WALL, H);
  g.fillRect(W - WALL, 0, WALL, H);

  g.strokeStyle = '#cac3b4'; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(WALL, 0); g.lineTo(WALL, H); g.stroke();
  g.beginPath(); g.moveTo(W - WALL, 0); g.lineTo(W - WALL, H); g.stroke();

  // Hole-band separator line (static; holes themselves are drawn dynamically)
  const bandTop = H - HBH;
  g.strokeStyle = '#cac3b4'; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(WALL, bandTop); g.lineTo(W - WALL, bandTop); g.stroke();
}

function getBoardCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left) * (W / rect.width), y: (clientY - rect.top) * (H / rect.height) };
}

function isDotOccupied(dot, excludeId = null) {
  return state.board.pegs.some(p => p.id !== excludeId && Math.hypot(p.x - dot.x, p.y - dot.y) < 4);
}

function drawBoard() {
  ctx.clearRect(0, 0, W, H);

  // Blit the pre-rendered static background in one GPU call
  if (_bgCache) {
    ctx.drawImage(_bgCache, 0, 0, W, H);
  } else {
    // Fallback (OffscreenCanvas not available)
    ctx.fillStyle = '#f6f2ea'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d8d0c0';
    ctx.fillRect(0, 0, WALL, H); ctx.fillRect(W - WALL, 0, WALL, H);
    ctx.strokeStyle = '#cac3b4'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(WALL, 0); ctx.lineTo(WALL, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W - WALL, 0); ctx.lineTo(W - WALL, H); ctx.stroke();
  }

  // ── Grid dots (when in Grid Assisted mode) ────────────────────────────
  if (state.pegMode === 'assisted') {
    UNIFIED_GRID.forEach((dot, idx) => {
      const occ = isDotOccupied(dot), hov = idx === state.ui.hoverDotIndex;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, hov ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = occ  ? 'rgba(100,80,55,0.12)'
                    : hov  ? 'rgba(184,90,52,0.85)'
                           : 'rgba(110,85,58,0.32)';
      ctx.fill();
    });
  }

  // ── Pascal guide dots ────────────────────────────────────────────────
  if (state.ui.showPascalGuide) {
    PASCAL_GUIDE_DOTS.forEach(dot => {
      const occ  = isDotOccupied(dot);
      const snap = state.ui.snapTarget &&
                   Math.hypot(dot.x - state.ui.snapTarget.x, dot.y - state.ui.snapTarget.y) < 2;
      if (snap) {
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184,90,52,0.80)'; ctx.fill();
      } else if (!occ) {
        // Outer ring
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184,90,52,0.30)'; ctx.fill();
        // Centre dot — more visible
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184,90,52,0.72)'; ctx.fill();
      } else {
        // Occupied: tiny ghost ring so user knows the guide is there
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184,90,52,0.06)'; ctx.fill();
      }
    });
  }

  // ── Launch arrow ─────────────────────────────────────────────────────
  const aRad = (state.board.angleDeg * Math.PI) / 180;
  const len = 28, ex = LX + len * Math.sin(aRad), ey = LY - len * Math.cos(aRad);
  ctx.save();
  ctx.strokeStyle = '#b85a34'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(LX, LY); ctx.lineTo(ex, ey); ctx.stroke();
  const dir = Math.atan2(ey - LY, ex - LX), hl = 7, ha = 0.42;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hl * Math.cos(dir - ha), ey - hl * Math.sin(dir - ha));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hl * Math.cos(dir + ha), ey - hl * Math.sin(dir + ha));
  ctx.stroke();
  ctx.beginPath(); ctx.arc(LX, LY, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#b85a34'; ctx.fill();
  ctx.restore();

  // ── Pegs (flat outlined circles — no gradient, no shadow) ────────────
  const draggingId = state.ui.draggingPeg && !state.ui.draggingPeg.fromTray
    ? state.ui.draggingPeg.id : null;
  state.board.pegs.forEach(peg => {
    if (peg.id !== draggingId) drawPeg(peg, state.ui.selectedPegId === peg.id);
  });
  if (state.ui.draggingPeg) drawDragGhost(state.ui.draggingPeg);

  // ── Completed trails — single warm colour, fade starts on next shot ──
  const now = performance.now();
  for (const ct of state.session.completedTrails) {
    if (ct.trail.length < 2) continue;
    let alpha;
    if (ct.fadeStartAt === null) {
      alpha = 0.55;  // not yet fading — stays at full brightness
    } else {
      const age = now - ct.fadeStartAt;
      if (age >= TRAIL_FADE_MS) continue;
      alpha = (1 - age / TRAIL_FADE_MS) * 0.55;
    }
    if (alpha < 0.005) continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(90,60,30,1)';  // single warm brown — no colour changes
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = 1;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(ct.trail[0].x, ct.trail[0].y);
    for (let i = 1; i < ct.trail.length; i++) ctx.lineTo(ct.trail[i].x, ct.trail[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // ── Session balls (pre-computed trajectory playback) ─────────────────
  for (const ball of state.session.balls) {
    if (ball.lingerFrames > 0) {
      drawBallShape(ball.x, ball.y, Math.max(0, 1 - ball.lingerFrames / 40));
      continue;
    }
    // Draw the revealed portion of the pre-computed trajectory as a subtle trail
    const end = ball.progressIndex;
    if (ball.trajectory && end > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(80,55,30,0.16)';
      ctx.lineWidth = 1; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ball.trajectory[0].x, ball.trajectory[0].y);
      for (let i = 1; i <= end && i < ball.trajectory.length; i++)
        ctx.lineTo(ball.trajectory[i].x, ball.trajectory[i].y);
      ctx.stroke(); ctx.restore();
    }
    drawBallShape(ball.x, ball.y, 1);
  }

  // ── Preview animation ─────────────────────────────────────────────────
  const anim = state.preview;
  if (anim) {
    if (anim.trajectory && anim.trajectory.length > 1) {
      const end = anim.progressIndex !== undefined
        ? Math.min(anim.progressIndex + 1, anim.trajectory.length)
        : anim.trajectory.length;
      if (end >= 2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(130,75,35,0.65)'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(anim.trajectory[0].x, anim.trajectory[0].y);
        for (let i = 1; i < end; i++) ctx.lineTo(anim.trajectory[i].x, anim.trajectory[i].y);
        ctx.stroke(); ctx.restore();
      }
    }
    if (anim.ballPos) drawBallShape(anim.ballPos.x, anim.ballPos.y, 1);
  }

  // ── Hole band (separator line is in the bg cache) ────────────────────
  const bandTop = H - HBH;

  state.board.holes.forEach((hole, idx) => {
    const color    = HOLE_COLORS[idx % HOLE_COLORS.length];
    const dragging = state.ui.draggingHole && state.ui.draggingHole.id === hole.id;
    ctx.save();
    if (dragging) ctx.globalAlpha = 0.70;
    ctx.fillStyle = color;
    ctx.fillRect(hole.x, bandTop, hole.width, HBH);

    if (state.ui.editHoles) {
      // Prominent ↔ stretch handles when edit mode is on
      const hw = 10;  // handle width
      // Left handle
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(hole.x, bandTop, hw, HBH);
      // Right handle
      ctx.fillRect(hole.x + hole.width - hw, bandTop, hw, HBH);
      // Arrow symbols
      ctx.fillStyle = color;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('◄', hole.x + hw / 2, bandTop + HBH / 2);
      ctx.fillText('►', hole.x + hole.width - hw / 2, bandTop + HBH / 2);
    } else {
      // Subtle resize hints (always present but minimal)
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillRect(hole.x, bandTop, 3, HBH);
      ctx.fillRect(hole.x + hole.width - 3, bandTop, 3, HBH);
    }

    // Reward label
    const labelSpace = state.ui.editHoles ? 12 : 0;
    if (hole.width > 24 + labelSpace * 2) {
      ctx.fillStyle   = 'rgba(255,255,255,0.88)';
      ctx.font        = "500 11px -apple-system,system-ui,sans-serif";
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(hole.reward), hole.x + hole.width / 2, bandTop + HBH / 2);
    }
    ctx.restore();
  });
}

// Flat outlined ring peg — no gradient, no shadow
function drawPeg(peg, selected = false) {
  ctx.save();
  ctx.beginPath(); ctx.arc(peg.x, peg.y, PR, 0, Math.PI * 2);
  // Very faint warm fill
  ctx.fillStyle = 'rgba(120,90,55,0.05)'; ctx.fill();
  ctx.lineWidth   = selected ? 2.0 : 1.5;
  ctx.strokeStyle = selected ? '#b85a34' : '#7a6050';
  ctx.stroke();
  if (selected) {
    // Outer selection halo
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(184,90,52,0.30)';
    ctx.beginPath(); ctx.arc(peg.x, peg.y, PR + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDragGhost(dragging) {
  let gx = dragging.x, gy = dragging.y;
  if (state.ui.snapTarget) { gx = state.ui.snapTarget.x; gy = state.ui.snapTarget.y; }
  else if (state.pegMode === 'assisted' && state.ui.hoverDotIndex >= 0) {
    const dot = UNIFIED_GRID[state.ui.hoverDotIndex]; gx = dot.x; gy = dot.y;
  }
  ctx.save();
  ctx.globalAlpha = dragging.overBank ? 0.22 : 0.75;
  ctx.beginPath(); ctx.arc(gx, gy, PR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,90,55,0.05)'; ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = dragging.overBank ? '#b85a34' : '#7a6050';
  if (dragging.overBank) ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.restore();
}

function drawBallShape(x, y, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;

  // Sphere body — radial gradient from highlight to deep shadow
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(
    x - R * 0.32, y - R * 0.32, R * 0.05,   // off-centre highlight
    x + R * 0.1,  y + R * 0.1,  R            // shadow shifts slightly down-right
  );
  grad.addColorStop(0,    '#4a3828');   // warm lighter highlight
  grad.addColorStop(0.45, '#1c1410');   // main body
  grad.addColorStop(1,    '#080502');   // deep shadow
  ctx.fillStyle = grad;
  ctx.fill();

  // Soft drop shadow (tiny, below and slightly right)
  ctx.save();
  ctx.globalAlpha = alpha * 0.25;
  ctx.beginPath();
  ctx.arc(x + 1, y + 1.5, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.filter = 'blur(2px)';
  ctx.fill();
  ctx.restore();

  // Crisp specular dot at top-left
  ctx.beginPath();
  ctx.arc(x - R * 0.33, y - R * 0.33, R * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,240,220,0.22)';
  ctx.fill();

  ctx.restore();
}

/* =========================================================================
   7. BOARD EDITOR
   ========================================================================= */

function findPegAt(x, y) {
  const pegs = state.board.pegs;
  for (let i = pegs.length - 1; i >= 0; i--)
    if (Math.hypot(pegs[i].x - x, pegs[i].y - y) <= PR + 4) return pegs[i];
  return null;
}

function findHoleHandleAt(x, y) {
  const bandTop = H - HBH;
  if (y < bandTop - 6 || y > H) return null;
  // Resize zones: outer edges. Move zone: centre area only.
  const hw = state.ui.editHoles ? 16 : 10;  // resize handle hit-width in px
  for (const hole of state.board.holes) {
    // Left resize zone
    if (x >= hole.x - hw && x <= hole.x + hw)
      return { hole, mode: 'resize-left' };
    // Right resize zone
    if (x >= hole.x + hole.width - hw && x <= hole.x + hole.width + hw)
      return { hole, mode: 'resize-right' };
    // Move zone: only the interior (excluding the resize strips on each side)
    if (x > hole.x + hw && x < hole.x + hole.width - hw)
      return { hole, mode: 'move' };
  }
  return null;
}

function isValidPegPosition(x, y, excludeId = null) {
  if (x - PR < WALL || x + PR > W - WALL) return false;
  if (y - PR < LY + R + 10 || y + PR > H - HBH - 10) return false;
  if (Math.hypot(x - LX, y - LY) < PR + R + 26) return false;
  return !state.board.pegs.some(p => p.id !== excludeId && Math.hypot(p.x - x, p.y - y) < MIN_PEG_SEPARATION);
}

// Snaps to unified grid (used in assisted mode)
function nearestSnapDot(x, y, excludeId = null) {
  let best = null, bestDist = Infinity;
  UNIFIED_GRID.forEach((dot, i) => {
    if (isDotOccupied(dot, excludeId)) return;
    const d = Math.hypot(dot.x - x, dot.y - y);
    if (d < bestDist) { bestDist = d; best = { dot, index: i, dist: d }; }
  });
  return best;
}

// Snaps to Pascal guide dots (used when snap-to-guide is on)
function nearestPascalGuideDot(x, y) {
  let best = null, bestDist = Infinity;
  for (const dot of PASCAL_GUIDE_DOTS) {
    if (isDotOccupied(dot)) continue;
    const d = Math.hypot(dot.x - x, dot.y - y);
    if (d < bestDist) { bestDist = d; best = { dot, dist: d }; }
  }
  return best;
}

function preventHoleOverlap(holeId, newLeft, width) {
  let adj = newLeft;
  for (const other of state.board.holes) {
    if (other.id === holeId) continue;
    if (adj < other.x + other.width && adj + width > other.x) {
      const pushR = other.x + other.width, pushL = other.x - width;
      adj = Math.abs(pushR - newLeft) < Math.abs(pushL - newLeft) ? pushR : pushL;
    }
  }
  return clamp(adj, WALL, W - WALL - width);
}

function clampHoleWidthForOverlap(holeId, left, width) {
  let maxW = width;
  for (const other of state.board.holes) {
    if (other.id === holeId) continue;
    if (other.x >= left) maxW = Math.min(maxW, other.x - left);
  }
  return Math.max(16, maxW);
}

/* ── Hole resize algorithm ─────────────────────────────────────────────────
   Key invariant: when resizing hole A, the FAR edge of the immediate neighbour
   is always fixed (only its near edge moves). This means no cascade is needed —
   adjusting B can never overlap B's own neighbour.

   Two modes (state.ui.stickyHoles):
     Free  — neighbours return to snapshot position when A shrinks (gaps allowed).
     Sticky— neighbours fill any gap left by A shrinking (always adjacent).
   ───────────────────────────────────────────────────────────────────────── */

function resizeHoleRight(hole, ds, pointerX) {
  const MIN_W  = 16;
  const snap   = ds.snapshot;

  // Sort by snapshot x so neighbour lookup is stable
  const snapSorted = snap.slice().sort((a, b) => a.x - b.x);
  const myIdx      = snapSorted.findIndex(s => s.id === hole.id);

  // How far right can A's right edge go? (limited by wall, then by neighbour)
  let maxRight = W - WALL;
  const snapB  = myIdx + 1 < snapSorted.length ? snapSorted[myIdx + 1] : null;
  const B      = snapB ? state.board.holes.find(h => h.id === snapB.id) : null;

  if (snapB && B) {
    const bRight = snapB.x + snapB.width;  // B's far (right) edge — always fixed
    maxRight = bRight - MIN_W;             // A can push B until B reaches MIN_W
  }

  const newRight = clamp(pointerX, hole.x + MIN_W, maxRight);
  hole.width = newRight - hole.x;

  if (snapB && B) {
    const bRight = snapB.x + snapB.width;
    if (newRight > snapB.x) {
      // A grew into B: shrink B from its left, keep B's right fixed
      B.x     = newRight;
      B.width = bRight - newRight;
    } else {
      // A shrank (or didn't reach B)
      if (state.ui.stickyHoles) {
        // Sticky: B fills gap by moving left
        B.x     = newRight;
        B.width = bRight - newRight;
      } else {
        // Free: B returns to snapshot
        B.x     = snapB.x;
        B.width = snapB.width;
      }
    }
  }
}

function resizeHoleLeft(hole, ds, pointerX) {
  const MIN_W    = 16;
  const snap     = ds.snapshot;
  const holeRight = ds.startLeft + ds.startWidth;  // A's right edge is fixed

  const snapSorted = snap.slice().sort((a, b) => a.x - b.x);
  const myIdx      = snapSorted.findIndex(s => s.id === hole.id);

  // Minimum left position (limited by wall, then by neighbour)
  let minLeft = WALL;
  const snapC = myIdx > 0 ? snapSorted[myIdx - 1] : null;
  const C     = snapC ? state.board.holes.find(h => h.id === snapC.id) : null;

  if (snapC && C) {
    const cLeft = snapC.x;  // C's far (left) edge — always fixed
    minLeft = cLeft + MIN_W; // A can push C until C reaches MIN_W
  }

  const newLeft = clamp(pointerX, minLeft, holeRight - MIN_W);
  hole.x     = newLeft;
  hole.width = holeRight - newLeft;

  if (snapC && C) {
    const cLeft = snapC.x;
    if (newLeft < snapC.x + snapC.width) {
      // A grew into C: shrink C from its right, keep C's left fixed
      C.width = newLeft - cLeft;
    } else {
      // A shrank
      if (state.ui.stickyHoles) {
        // Sticky: C fills gap by growing right
        C.width = newLeft - cLeft;
      } else {
        // Free: C returns to snapshot
        C.x     = snapC.x;
        C.width = snapC.width;
      }
    }
  }
}

function addPeg(x, y) {
  if (state.board.pegs.length >= MAX_PEGS) return null;
  const peg = { id: nextPegId(), x, y };
  state.board.pegs.push(peg); state.ui.selectedPegId = peg.id;
  updateBankUI(); scheduleRecompute(); return peg;
}

function deletePeg(id) {
  const idx = state.board.pegs.findIndex(p => p.id === id);
  if (idx === -1) return;
  state.board.pegs.splice(idx, 1);
  if (state.ui.selectedPegId === id) state.ui.selectedPegId = null;
  updateBankUI(); scheduleRecompute(); drawBoard();
}

function clearAllPegs() {
  state.board.pegs = []; state.ui.selectedPegId = null;
  updateBankUI(); scheduleRecompute(); drawBoard();
}

function updateBankUI() {
  const used = state.board.pegs.length;
  document.getElementById('pegCountLabel').textContent = `${MAX_PEGS - used} remaining`;
  document.getElementById('pegTray').classList.toggle('tray-empty', used >= MAX_PEGS);
  const btn = document.getElementById('btnReturnToBank');
  if (btn) btn.style.display = state.ui.selectedPegId !== null ? '' : 'none';
}

function setPegMode(mode) {
  state.pegMode = mode;
  document.getElementById('modeFreeBtn').classList.toggle('active', mode === 'free');
  document.getElementById('modeAssistedBtn').classList.toggle('active', mode === 'assisted');
  document.getElementById('modeIndicator').innerHTML = mode === 'free'
    ? '<strong>Free Edit</strong> — drag pegs anywhere on the board.'
    : '<strong>Grid Assisted</strong> — pegs snap to the centred staggered grid.';
  drawBoard();
}

function setPegBankDropTarget(active) {
  document.getElementById('pegTray').classList.toggle('drop-target', active);
}

// Canvas pointer events
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  state.ui.isPointerDown = true;

  // ── Launch-arrow drag (check before pegs — launcher zone is above all pegs) ─
  if (Math.hypot(x - LX, y - LY) < 44) {
    state.ui.draggingArrow = true;
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  const holeHit = findHoleHandleAt(x, y);
  if (holeHit) {
    // Snapshot ALL hole positions so neighbors can snap back when user pulls inward
    state.ui.draggingHole = { id: holeHit.hole.id, mode: holeHit.mode,
      startPointerX: x, startLeft: holeHit.hole.x, startWidth: holeHit.hole.width,
      snapshot: state.board.holes.map(h => ({ id: h.id, x: h.x, width: h.width })) };
    state.ui.selectedPegId = null; updateBankUI(); return;
  }
  const peg = findPegAt(x, y);
  if (peg) {
    canvas.setPointerCapture(e.pointerId);
    state.ui.selectedPegId = peg.id;
    state.ui.draggingPeg   = { id: peg.id, fromTray: false, x: peg.x, y: peg.y, overBank: false };
    updateBankUI(); drawBoard(); return;
  }
  state.ui.selectedPegId = null; updateBankUI(); drawBoard();
});

window.addEventListener('pointermove', (e) => {
  if (!state.ui.isPointerDown) return;
  const { x, y } = getBoardCoords(e.clientX, e.clientY);

  if (state.ui.draggingArrow) {
    const dx = x - LX, dy = y - LY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      const rad     = Math.atan2(dx, -dy);
      const wrapped = (Math.round(rad * 180 / Math.PI) % 360 + 360) % 360;
      state.board.angleDeg = wrapped;
      const s = document.getElementById('angle'), n = document.getElementById('angleNum');
      if (s) s.value = wrapped; if (n) n.value = wrapped;
      drawBoard(); scheduleRecompute();
    }
    return;
  }

  if (state.ui.draggingPeg) {
    const dragging = state.ui.draggingPeg;
    dragging.x = x; dragging.y = y;
    const trayEl = document.getElementById('pegTray');
    const tr     = trayEl.getBoundingClientRect();
    const overBank = e.clientX >= tr.left && e.clientX <= tr.right &&
                     e.clientY >= tr.top  && e.clientY <= tr.bottom;
    dragging.overBank = overBank; setPegBankDropTarget(overBank);
    state.ui.snapTarget = null; state.ui.hoverDotIndex = -1;
    if (!overBank) {
      if (state.pegMode === 'assisted') {
        const excludeId = dragging.fromTray ? null : dragging.id;
        const nearest = nearestSnapDot(x, y, excludeId);
        state.ui.hoverDotIndex = (nearest && nearest.dist <= SNAP_RADIUS) ? nearest.index : -1;
      }
    }
    drawBoard(); return;
  }

  if (state.ui.draggingHole) {
    const ds = state.ui.draggingHole, hole = state.board.holes.find(h => h.id === ds.id);
    if (!hole) return;
    const MIN_W = 16;
    if (ds.mode === 'move') {
      const nl = clamp(ds.startLeft + (x - ds.startPointerX), WALL, W - WALL - hole.width);
      hole.x = preventHoleOverlap(hole.id, nl, hole.width);
    } else if (ds.mode === 'resize-left') {
      resizeHoleLeft(hole, ds, x);
    } else if (ds.mode === 'resize-right') {
      resizeHoleRight(hole, ds, x);
    }
    updateHoleEditorList(); drawBoard(); scheduleRecompute();
  }
});

window.addEventListener('pointerup', () => {
  if (state.ui.draggingArrow) { state.ui.draggingArrow = false; return; }
  if (state.ui.draggingPeg) {
    const dragging = state.ui.draggingPeg;
    state.ui.draggingPeg = null; state.ui.hoverDotIndex = -1; state.ui.snapTarget = null;
    setPegBankDropTarget(false);

    if (dragging.overBank) {
      if (!dragging.fromTray) { deletePeg(dragging.id); flashStatus('Peg returned to bank.'); }
      drawBoard();
    } else {
      let fx = dragging.x, fy = dragging.y;
      if (state.ui.snapTarget) { fx = state.ui.snapTarget.x; fy = state.ui.snapTarget.y; }
      else if (state.pegMode === 'assisted') {
        const nearest = nearestSnapDot(fx, fy, dragging.fromTray ? null : dragging.id);
        if (nearest && nearest.dist <= SNAP_RADIUS) { fx = nearest.dot.x; fy = nearest.dot.y; }
      }
      const excludeId = dragging.fromTray ? null : dragging.id;
      if (isValidPegPosition(fx, fy, excludeId)) {
        if (dragging.fromTray) { addPeg(fx, fy); }
        else { const peg = state.board.pegs.find(p => p.id === dragging.id); if (peg) { peg.x = fx; peg.y = fy; scheduleRecompute(); } }
      }
      drawBoard();
    }
  }
  if (state.ui.draggingHole) { state.ui.draggingHole = null; scheduleRecompute(); }
  state.ui.isPointerDown = false;
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  const peg = findPegAt(x, y);
  if (peg) deletePeg(peg.id);
});

// Canvas cursor feedback (hover hints)
canvas.addEventListener('mousemove', (e) => {
  if (state.ui.isPointerDown) return;
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  if (Math.hypot(x - LX, y - LY) < 44) {
    canvas.style.cursor = 'grab';          // launch-arrow drag
  } else {
    const hh = findHoleHandleAt(x, y);
    if (hh) {
      if (hh.mode === 'move')             canvas.style.cursor = 'move';
      else                                canvas.style.cursor = 'col-resize';
    } else if (findPegAt(x, y)) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'default';
    }
  }
});
canvas.addEventListener('mouseleave', () => { canvas.style.cursor = 'default'; });

document.getElementById('trayPeg').addEventListener('pointerdown', (e) => {
  if (state.board.pegs.length >= MAX_PEGS) return;
  e.preventDefault(); state.ui.isPointerDown = true;
  const { x, y } = getBoardCoords(e.clientX, e.clientY);
  state.ui.draggingPeg = { id: 'new-' + Date.now(), fromTray: true, x, y, overBank: false };
});

document.getElementById('btnReturnToBank').addEventListener('click', () => {
  if (state.ui.selectedPegId !== null) { deletePeg(state.ui.selectedPegId); flashStatus('Peg returned to bank.'); }
});

window.addEventListener('keydown', (e) => {
  const inInput = ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
  if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput && state.ui.selectedPegId !== null) {
    deletePeg(state.ui.selectedPegId); e.preventDefault(); return;
  }
  if (e.key === ' ' && !inInput) {
    e.preventDefault();
    if (!state.session.active) return;
    if (state.session.balls.filter(b => !b.done).length >= MAX_BALLS_IN_FLIGHT) {
      showSessionLimitMsg(`Max ${MAX_BALLS_IN_FLIGHT} balls in flight.`);
    } else { fireOneBall(); }
  }
});

document.getElementById('modeFreeBtn').addEventListener('click',     () => setPegMode('free'));
document.getElementById('modeAssistedBtn').addEventListener('click', () => setPegMode('assisted'));

document.getElementById('chkShowGuide').addEventListener('change', (e) => {
  state.ui.showPascalGuide = e.target.checked;
  drawBoard();
});

function setHoleToggleStyle(id, active) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.style.background  = active ? 'var(--accent)' : '';
  btn.style.color       = active ? '#fff'          : '';
  btn.style.borderColor = active ? 'var(--accent)' : '';
}

document.getElementById('btnEditHoles').addEventListener('click', () => {
  state.ui.editHoles = !state.ui.editHoles;
  setHoleToggleStyle('btnEditHoles', state.ui.editHoles);
  drawBoard();
});

document.getElementById('btnStickyHoles').addEventListener('click', () => {
  state.ui.stickyHoles = !state.ui.stickyHoles;
  setHoleToggleStyle('btnStickyHoles', state.ui.stickyHoles);
});

/* =========================================================================
   8. SESSION
   ========================================================================= */

// Session playback uses the same 1400 ms duration as the preview so speeds match
const SESSION_PLAYBACK_MS = 1400;

function saveBallTrail(ball) {
  // Use the pre-computed trajectory (same object, no copy needed for read-only trail)
  if (!ball.trajectory || ball.trajectory.length < 2 || ball.timedOut) return;
  state.session.completedTrails.push({ trail: ball.trajectory, fadeStartAt: null });
  if (state.session.completedTrails.length > MAX_COMPLETED_TRAILS)
    state.session.completedTrails.shift();
}

function sessionScheduleNextFrame() {
  if (!state.session.rafId)
    state.session.rafId = requestAnimationFrame(sessionRunFrame);
}

function sessionRunFrame(timestamp) {
  state.session.rafId = null;

  // Auto / hold firing
  if (state.session.active || state.session.holdActive) {
    const gap    = timestamp - state.session.lastFireTime;
    const doFire = state.session.mode === 'auto'
      ? gap >= AUTO_FIRE_INTERVAL_MS
      : state.session.mode === 'hold' && state.session.holdActive;
    if (doFire && state.session.balls.filter(b => !b.done).length < MAX_BALLS_IN_FLIGHT) {
      fireOneBall(); state.session.lastFireTime = timestamp;
    }
  }

  // Advance each ball's playback position along its pre-computed trajectory
  for (const ball of state.session.balls) {
    if (ball.done) { ball.lingerFrames++; continue; }

    if (ball.startTime === null) ball.startTime = timestamp;
    const t   = Math.min(1, (timestamp - ball.startTime) / SESSION_PLAYBACK_MS);
    const idx = Math.floor(t * Math.max(0, ball.trajectory.length - 1));
    ball.progressIndex = idx;
    const pt = ball.trajectory[idx];
    if (pt) { ball.x = pt.x; ball.y = pt.y; }

    if (t >= 1) {
      ball.done      = true;
      ball.reward    = ball.result.reward;
      ball.holeIndex = ball.result.holeIndex;
      ball.timedOut  = ball.result.timedOut;
      registerLanding(ball);
      saveBallTrail(ball);
    }
  }

  state.session.balls = state.session.balls.filter(b => !b.done || b.lingerFrames <= BALL_LINGER_FRAMES);

  drawBoard(); renderSessionStats();

  const now = performance.now();
  const trailsAlive = state.session.completedTrails.some(
    t => t.fadeStartAt === null || (now - t.fadeStartAt) < TRAIL_FADE_MS
  );
  if (state.session.active || state.session.holdActive || state.session.balls.length > 0 || trailsAlive)
    sessionScheduleNextFrame();
}

function registerLanding(ball) {
  if (ball.timedOut) { state.session.timedOuts++; return; }
  state.session.shotsCompleted++; state.session.totalReward += ball.reward;
  if (ball.holeIndex === -1) { state.session.misses++; }
  else { while (state.session.holeHits.length <= ball.holeIndex) state.session.holeHits.push(0); state.session.holeHits[ball.holeIndex]++; }
}

function fireOneBall() {
  if (state.session.balls.filter(b => !b.done).length >= MAX_BALLS_IN_FLIGHT) return;
  // Start fading any trails still at full brightness
  const now = performance.now();
  state.session.completedTrails.forEach(t => { if (t.fadeStartAt === null) t.fadeStartAt = now; });

  const { forceMin, forceMax, angleDeg } = state.board;
  const force  = forceMin + Math.random() * (forceMax - forceMin);
  // Pre-compute the full trajectory — exactly like preview does
  const result = simulateShot(force, angleDeg, state.board, { recordTrajectory: true });

  state.session.balls.push({
    id:            nextBallId(),
    force,
    trajectory:    result.trajectory,
    result,
    startTime:     null,   // set on first rAF frame
    progressIndex: 0,
    x:             result.trajectory[0]?.x ?? LX,
    y:             result.trajectory[0]?.y ?? LY,
    done:          false,
    lingerFrames:  0,
    // keep these so registerLanding can read them
    reward:        result.reward,
    holeIndex:     result.holeIndex,
    timedOut:      result.timedOut
  });
  sessionScheduleNextFrame();
}

function startSession() {
  if (state.session.active) return;
  // Clear any preview trajectory and previous session trails before starting
  state.preview = null;
  state.session.completedTrails = [];
  state.session.active       = true;
  state.session.lastFireTime = 0;
  if (state.session.mode === 'auto') sessionScheduleNextFrame();
  updateSessionUI();
  drawBoard();
}

function stopSession() {
  state.session.active = false; state.session.holdActive = false;
  updateSessionUI(); sessionScheduleNextFrame();
}

function resetSessionStats() {
  state.session.balls = []; state.session.completedTrails = [];
  state.session.shotsCompleted = 0; state.session.totalReward = 0;
  state.session.holeHits = []; state.session.misses = 0; state.session.timedOuts = 0;
  renderSessionStats(); drawBoard();
}

function setHoldActive(active) {
  state.session.holdActive = active;
  if (active && !state.session.rafId) sessionScheduleNextFrame();
}

let _limitMsgTimer = null;
function showSessionLimitMsg(msg) {
  const el = document.getElementById('sessionLimitMsg');
  el.textContent = msg; el.style.display = '';
  if (_limitMsgTimer) clearTimeout(_limitMsgTimer);
  _limitMsgTimer = setTimeout(() => { el.style.display = 'none'; }, 2000);
}

function updateSessionUI() {
  const s = state.session;
  document.getElementById('btnStartSession').disabled   = s.active;
  document.getElementById('btnStopSession').disabled    = !s.active && !s.balls.some(b => !b.done);
  document.getElementById('sessionModeSelect').disabled = s.active;
  // Preview Shot is disabled while a session is running
  document.getElementById('btnAnimateShot').disabled    = s.active;
  const sb = document.getElementById('btnSingleShoot'), hb = document.getElementById('btnHoldShoot');
  if (s.mode === 'single') { sb.style.display = ''; hb.style.display = 'none'; }
  else if (s.mode === 'hold') { sb.style.display = 'none'; hb.style.display = ''; }
  else { sb.style.display = 'none'; hb.style.display = 'none'; }
  sb.disabled = !s.active;
  hb.disabled = !s.active;
}

function renderSessionStats() {
  const s = state.session;
  document.getElementById('statShots').textContent = s.shotsCompleted;
  const totalEl = document.getElementById('statTotal');
  if (totalEl) totalEl.textContent = s.totalReward.toFixed(1);

  if (s.shotsCompleted > 0) {
    const avg  = s.totalReward / s.shotsCompleted;
    document.getElementById('statEmpAvg').textContent = avg.toFixed(3);
    const ideal = state.expected?.expectedReward;
    if (ideal !== undefined && ideal !== null) {
      const diff = avg - ideal, diffEl = document.getElementById('statDiff');
      diffEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(3);
      diffEl.style.color = diff >= 0 ? 'var(--ok)' : 'var(--bad)';
    } else { document.getElementById('statDiff').textContent = '—'; document.getElementById('statDiff').style.color = ''; }
  } else {
    document.getElementById('statEmpAvg').textContent = '—';
    document.getElementById('statDiff').textContent   = '—';
    document.getElementById('statDiff').style.color   = '';
  }

  const toEl = document.getElementById('statTimedOuts');
  if (s.timedOuts > 0) { toEl.textContent = `⚠ ${s.timedOuts} shot(s) timed out.`; toEl.style.display = ''; }
  else toEl.style.display = 'none';

  renderCombinedTable();
}

// ── Combined ideal vs session distribution table ─────────────────────────────
function renderCombinedTable() {
  const tbody = document.getElementById('combinedDistBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const ideal   = state.expected;
  const session = state.session;
  const holes   = state.board.holes;

  holes.forEach((hole, idx) => {
    const color      = HOLE_COLORS[idx % HOLE_COLORS.length];
    const idealPct   = ideal ? ((ideal.holeProbabilities[idx] ?? 0) * 100) : null;
    const actualCnt  = session.holeHits[idx] || 0;
    const actualPct  = session.shotsCompleted > 0 ? (actualCnt / session.shotsCompleted * 100) : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="dist-hole-name">
        <span class="hole-color-chip" style="background:${color}"></span>
        Hole&nbsp;${idx + 1}<span class="dist-reward"> ·${hole.reward}</span>
      </td>
      <td class="dist-col">
        <div class="dist-bar"><div class="dist-bar-fill" style="width:${idealPct !== null ? idealPct.toFixed(1) : 0}%;background:${color}"></div></div>
        <span class="dist-pct">${idealPct !== null ? idealPct.toFixed(1) + '%' : '—'}</span>
      </td>
      <td class="dist-col">
        <div class="dist-bar"><div class="dist-bar-fill" style="width:${actualPct.toFixed(1)}%;background:${color}"></div></div>
        <span class="dist-pct">${actualCnt}<span class="dist-pct-small"> ${actualPct.toFixed(1)}%</span></span>
      </td>`;
    tbody.appendChild(tr);
  });

  // Miss / zero row — included in ideal column too
  const idealZeroPct  = ideal ? (ideal.zeroProbability * 100) : null;
  const actualMissCnt = session.misses;
  const actualMissPct = session.shotsCompleted > 0 ? (actualMissCnt / session.shotsCompleted * 100) : 0;

  const missRow = document.createElement('tr');
  missRow.className = 'dist-miss-row';
  missRow.innerHTML = `
    <td class="dist-hole-name">
      <span class="hole-color-chip" style="background:var(--border)"></span>
      Miss / zero
    </td>
    <td class="dist-col">
      <div class="dist-bar"><div class="dist-bar-fill" style="width:${idealZeroPct !== null ? idealZeroPct.toFixed(1) : 0}%;background:var(--border)"></div></div>
      <span class="dist-pct">${idealZeroPct !== null ? idealZeroPct.toFixed(1) + '%' : '—'}</span>
    </td>
    <td class="dist-col">
      <div class="dist-bar"><div class="dist-bar-fill" style="width:${actualMissPct.toFixed(1)}%;background:var(--border)"></div></div>
      <span class="dist-pct">${actualMissCnt}<span class="dist-pct-small"> ${actualMissPct.toFixed(1)}%</span></span>
    </td>`;
  tbody.appendChild(missRow);
}

/* =========================================================================
   9. PERSISTENCE
   ========================================================================= */

const STORAGE_KEY = 'pachinko-simulator-v2';

function serializeLayout() {
  const b = state.board;
  return { version: 2, pegs: b.pegs.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })),
           holes: b.holes.map(h => ({ x: +h.x.toFixed(2), width: +h.width.toFixed(2), reward: h.reward })),
           forceMin: b.forceMin, forceMax: b.forceMax, angleDeg: b.angleDeg,
           gravity: b.gravity, restitution: b.restitution, pegMode: state.pegMode };
}

function applyLayout(raw) {
  const { ok, data, errors } = validateLayout(raw);
  if (errors.length) flashStatus(errors.join(' '), !ok);
  if (!data) throw new Error('Layout validation failed.');
  state.board.pegs  = data.pegs.map(p  => ({ id: nextPegId(),  x: p.x,  y: p.y }));
  state.board.holes = data.holes.map(h => ({ id: nextHoleId(), x: h.x,  width: h.width, reward: h.reward }));
  state.board.forceMin    = data.forceMin; state.board.forceMax    = data.forceMax;
  state.board.angleDeg    = data.angleDeg; state.board.gravity     = data.gravity;
  state.board.restitution = data.restitution;
  setPegMode(data.pegMode); syncControlsFromState(); updateBankUI(); updateHoleEditorList();
  drawBoard(); scheduleRecompute(true);
}

function saveToLocalStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeLayout())); flashStatus('Saved.'); }
  catch (err) { flashStatus('Could not save: ' + err.message, true); }
}

function loadFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { flashStatus('No saved layout found.', true); return; }
  if (!confirm('Load your saved layout?')) return;
  try {
    let p = JSON.parse(raw);
    if ((p.version ?? 1) < 2 && typeof p.angleDeg === 'number') p.angleDeg = ((p.angleDeg % 360) + 360) % 360;
    applyLayout(p); flashStatus('Layout loaded.');
  } catch (err) { flashStatus('Load failed: ' + err.message, true); }
}

function exportJsonToFile() {
  const blob = new Blob([JSON.stringify(serializeLayout(), null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'pachinko-layout.json' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  flashStatus('Exported.');
}

function importJsonFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try { applyLayout(JSON.parse(reader.result)); flashStatus('Imported ' + file.name + '.'); }
    catch (err) { flashStatus('Import failed: ' + err.message, true); }
  };
  reader.onerror = () => flashStatus('Could not read file.', true);
  reader.readAsText(file);
}

function flashStatus(msg, isError = false) {
  const el = document.getElementById('saveLoadStatus');
  if (!el) return; el.textContent = msg; el.style.color = isError ? 'var(--bad)' : 'var(--ink-3)';
}

// Default layout uses PASCAL_GUIDE_DOTS so positions are always on the grid
function buildDefaultLayout() {
  const pegs    = PASCAL_GUIDE_DOTS.map(d => ({ x: d.x, y: d.y }));
  const usableW = W - WALL * 2, holeW = +(usableW / 6).toFixed(2);
  const rewards = [1, 5, 10, 10, 5, 1];
  const holes   = rewards.map((reward, i) => ({ x: +(WALL + i * holeW).toFixed(2), width: holeW, reward }));
  return { version: 2, pegs, holes, forceMin: 30, forceMax: 70, angleDeg: 0, gravity: 600, restitution: 0.78, pegMode: 'free' };
}

function resetToDefaultLayout() {
  applyLayout(buildDefaultLayout());
  state.ui.showPascalGuide = true;
  document.getElementById('chkShowGuide').checked = true;
  flashStatus('Reset to Pascal-triangle layout.');
}

/* =========================================================================
   10. UI CONTROLS  (sliders, hole editor, preview, worker integration)
   ========================================================================= */

// Web Worker (Blob-based — works with file://)
let _worker = null, _workerVersion = 0;

function initWorker() {
  try {
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    _worker    = new Worker(url);
    URL.revokeObjectURL(url);
    _worker.onmessage = (e) => {
      const { result, ver } = e.data;
      if (ver !== _workerVersion) return; // stale result — discard
      state.expected = result;
      renderExpectedReward(result, 0);
      setCalcStatus('ready');
      renderSessionStats();
    };
    _worker.onerror = () => { _worker = null; }; // fall back to main thread
  } catch (_) { _worker = null; }
}

// Debounced recompute — dispatches to worker when available
const DEBOUNCE_MS = 180;
let debounceTimer = null, computeVersion = 0;
const calcStatusEl = document.getElementById('calcStatus');

function scheduleRecompute(immediate = false) {
  setCalcStatus('updating');
  if (debounceTimer) clearTimeout(debounceTimer);
  computeVersion++; const myVersion = computeVersion;
  if (immediate) runRecompute(myVersion);
  else debounceTimer = setTimeout(() => runRecompute(myVersion), DEBOUNCE_MS);
}

function runRecompute(version) {
  debounceTimer = null;
  if (_worker) {
    _workerVersion = version;
    _worker.postMessage({
      fMin: state.board.forceMin, fMax: state.board.forceMax, ang: state.board.angleDeg,
      bs: { pegs: state.board.pegs.map(p => ({ x: p.x, y: p.y })),
             holes: state.board.holes, gravity: state.board.gravity, restitution: state.board.restitution },
      ver: version
    });
  } else {
    // Main-thread fallback
    const t0 = performance.now();
    const result = calculateExpectedReward(state.board.forceMin, state.board.forceMax, state.board.angleDeg, state.board);
    if (version !== computeVersion) return;
    state.expected = result;
    renderExpectedReward(result, performance.now() - t0);
    setCalcStatus('ready');
    renderSessionStats();
  }
}

function setCalcStatus(mode) {
  if (mode === 'updating') {
    calcStatusEl.innerHTML = '<span class="calc-dot"></span> Computing…'; calcStatusEl.classList.add('updating');
  } else {
    calcStatusEl.innerHTML = '<span class="calc-dot"></span> Ready'; calcStatusEl.classList.remove('updating');
  }
}

function renderExpectedReward(result, elapsedMs) {
  document.getElementById('expectedRewardDisplay').textContent = result.expectedReward.toFixed(3);
  const badge  = document.getElementById('erApproxBadge');
  const banner = document.getElementById('erApproxBanner');
  if (badge)  badge.style.display  = result.capReached ? '' : 'none';
  if (banner) banner.style.display = result.capReached ? '' : 'none';

  // Update sampling info (in collapsed Details panel)
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('infoForceRange', `${state.board.forceMin} – ${state.board.forceMax}`);
  set('infoAngle',      `${state.board.angleDeg}°`);
  set('infoSamples',    String(result.samplesUsed));
  set('infoTime',       elapsedMs > 0 ? elapsedMs.toFixed(1) + ' ms' : '(worker)');

  // Populate the combined ideal/session table (ideal column updated here)
  renderCombinedTable();
}

function updateHoleEditorList() {
  const listEl = document.getElementById('holeEditorList'); listEl.innerHTML = '';
  state.board.holes.forEach((hole, idx) => {
    const color = HOLE_COLORS[idx % HOLE_COLORS.length];
    const card  = document.createElement('div'); card.className = 'hole-card';
    card.innerHTML = `
      <div class="hole-card-header">
        <span class="hole-color-chip" style="background:${color}"></span>
        <span>Hole ${idx + 1}</span>
        <button class="btn btn-sm hole-delete-btn">✕</button>
      </div>
      <div class="hole-card-row"><label>Position</label>
        <input type="number" class="hole-x-input num-input" min="${WALL}" max="${W-WALL-hole.width}" step="1" value="${Math.round(hole.x)}">
      </div>
      <div class="hole-card-row"><label>Width</label>
        <input type="number" class="hole-width-input num-input" min="16" max="${W-WALL*2}" step="1" value="${Math.round(hole.width)}">
      </div>
      <div class="hole-card-row"><label>Reward</label>
        <input type="number" class="hole-reward-input num-input" step="1" value="${hole.reward}">
      </div>`;
    card.querySelector('.hole-delete-btn').addEventListener('click', () => {
      // Allow deleting all holes — 0 holes means all balls are misses
      state.board.holes = state.board.holes.filter(h => h.id !== hole.id);
      updateHoleEditorList(); drawBoard(); scheduleRecompute();
    });
    const xIn = card.querySelector('.hole-x-input');
    xIn.addEventListener('input', () => {
      hole.x = preventHoleOverlap(hole.id, clamp(Number(xIn.value)||0, WALL, W-WALL-hole.width), hole.width);
      xIn.value = Math.round(hole.x); drawBoard(); scheduleRecompute();
    });
    const wIn = card.querySelector('.hole-width-input');
    wIn.addEventListener('input', () => {
      hole.width = clampHoleWidthForOverlap(hole.id, hole.x, Math.max(16, Number(wIn.value)||16));
      wIn.value  = Math.round(hole.width); drawBoard(); scheduleRecompute();
    });
    card.querySelector('.hole-reward-input').addEventListener('input', (e) => {
      hole.reward = Number(e.target.value) ?? 0; drawBoard(); scheduleRecompute();
    });
    listEl.appendChild(card);
  });
  if (state.board.holes.length < MAX_HOLES) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm'; addBtn.style.cssText = 'width:100%;margin-top:4px';
    addBtn.textContent = `+ Add Hole (${state.board.holes.length}/${MAX_HOLES})`;
    addBtn.addEventListener('click', () => {
      const minX = WALL, maxX = W - WALL;
      const sorted = [...state.board.holes].sort((a, b) => a.x - b.x);
      const gaps = []; let cursor = minX;
      for (const h of sorted) { gaps.push({ start: cursor, end: h.x }); cursor = h.x + h.width; }
      gaps.push({ start: cursor, end: maxX });
      const best = gaps.reduce((a, b) => (b.end-b.start > a.end-a.start ? b : a), gaps[0]);
      const gapW = best.end - best.start, width = Math.max(16, Math.min(60, gapW - 4));
      if (width < 16) { flashStatus('No space.', true); return; }
      state.board.holes.push({ id: nextHoleId(), x: best.start + Math.max(0, (gapW-width)/2), width, reward: 10 });
      updateHoleEditorList(); drawBoard(); scheduleRecompute();
    });
    listEl.appendChild(addBtn);
  }
}

function syncControlsFromState() {
  const b = state.board;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('forceMin',b.forceMin);set('forceMinNum',b.forceMin);
  set('forceMax',b.forceMax);set('forceMaxNum',b.forceMax);
  set('angle',b.angleDeg);set('angleNum',b.angleDeg);
  set('gravity',b.gravity);set('gravityNum',b.gravity);
  set('restitution',b.restitution);set('restitutionNum',b.restitution);
  updateDualRangeFill();
}

function linkControl(rangeId, numberId, onChange, opts = {}) {
  const rangeEl = document.getElementById(rangeId), numEl = document.getElementById(numberId);
  if (!rangeEl || !numEl) return;
  function apply(value) {
    let v = Number(value); if (!isFinite(v)) return;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    rangeEl.value = v; numEl.value = v; onChange(v);
  }
  rangeEl.addEventListener('input', () => apply(rangeEl.value));
  numEl.addEventListener('input',   () => apply(numEl.value));
}

let previewRafId = null;
function playPreviewShot() {
  if (previewRafId) { cancelAnimationFrame(previewRafId); previewRafId = null; }
  const mode = document.getElementById('previewForceMode').value;
  const { forceMin, forceMax, angleDeg } = state.board;
  const force = mode === 'min' ? forceMin : mode === 'max' ? forceMax
              : mode === 'random' ? forceMin + Math.random()*(forceMax-forceMin)
              : (forceMin+forceMax)/2;
  const result = simulateShot(force, angleDeg, state.board, { recordTrajectory: true });
  if (result.timedOut) {
    calcStatusEl.innerHTML = '<span class="calc-dot"></span> ⚠ Preview timed out.';
    setTimeout(() => setCalcStatus('ready'), 3000); return;
  }
  state.preview = { trajectory: result.trajectory, progressIndex: 0,
    ballPos: result.trajectory[0] || { x: LX, y: LY },
    reward: result.reward, holeIndex: result.holeIndex, force };
  const total = result.trajectory.length; if (total === 0) return;
  const t0 = performance.now();
  function step(now) {
    const t = Math.min(1, (now - t0) / 1400), idx = Math.floor(t * (total - 1));
    state.preview.progressIndex = idx; state.preview.ballPos = state.preview.trajectory[idx]; drawBoard();
    if (t < 1) { previewRafId = requestAnimationFrame(step); }
    else {
      previewRafId = null;
      const label = result.holeIndex >= 0 ? `Hole ${result.holeIndex + 1}` : 'Miss';
      calcStatusEl.innerHTML = `<span class="calc-dot"></span> Preview: ${label}, reward ${result.reward}`;
      setTimeout(() => setCalcStatus('ready'), 2600);
    }
  }
  previewRafId = requestAnimationFrame(step);
}

/* =========================================================================
   11. INITIALISATION
   ========================================================================= */

// updateDualRangeFill — now delegates to the force-dial renderer
let _updateForceDial = null;
function updateDualRangeFill() {
  if (_updateForceDial) _updateForceDial();
}

/* ────────────────────────────────────────────────────────────────────────────
   Force Dial: two circle buttons on an evenly-dotted track
   ───────────────────────────────────────────────────────────────────────── */
function initForceDial() {
  const container  = document.getElementById('forceDialContainer');
  const fill       = document.getElementById('forceDialFill');
  const minBtn     = document.getElementById('forceDialMin');
  const maxBtn     = document.getElementById('forceDialMax');
  const minDisplay = document.getElementById('forceMinDisplay');
  const maxDisplay = document.getElementById('forceMaxDisplay');
  if (!container || !minBtn || !maxBtn) return () => {};

  const DIAL_R = 18;  // half of 36px circle

  function trackWidth() { return container.getBoundingClientRect().width - DIAL_R * 2; }
  function valueToLeft(v) { return DIAL_R + ((v - 1) / 99) * trackWidth(); }
  function xToValue(clientX) {
    const rect = container.getBoundingClientRect();
    const t    = Math.max(0, Math.min(1, (clientX - rect.left - DIAL_R) / trackWidth()));
    return Math.round(1 + t * 99);
  }

  function render() {
    const minV   = state.board.forceMin;
    const maxV   = state.board.forceMax;
    const merged = minV === maxV;    // truly the same value = merge into one button

    if (merged) {
      // One hollow outlined button at the shared position
      const pos = valueToLeft(minV);
      minBtn.style.left    = pos + 'px';
      minBtn.style.display = '';
      maxBtn.style.display = 'none';
      if (minDisplay) minDisplay.textContent = minV;
      minBtn.classList.add('merged-hollow');
      fill.style.display = 'none';
    } else {
      // Two filled buttons with coloured fill between them
      const minL = valueToLeft(minV);
      const maxL = valueToLeft(maxV);
      minBtn.style.left    = minL + 'px';
      maxBtn.style.left    = maxL + 'px';
      minBtn.style.display = '';
      maxBtn.style.display = '';
      if (minDisplay) minDisplay.textContent = minV;
      if (maxDisplay) maxDisplay.textContent = maxV;
      minBtn.classList.remove('merged-hollow');
      maxBtn.classList.remove('merged-hollow');
      fill.style.display = '';
      fill.style.left    = minL + 'px';
      fill.style.width   = (maxL - minL) + 'px';
    }

    minBtn.setAttribute('aria-valuenow', minV);
    maxBtn.setAttribute('aria-valuenow', maxV);
    const rMin = document.getElementById('forceMin');
    const rMax = document.getElementById('forceMax');
    if (rMin) rMin.value = minV;
    if (rMax) rMax.value = maxV;
  }

  // ── Drag logic ──────────────────────────────────────────────────────────
  let _dragging    = null;   // 'min' | 'max'
  let _mergedDrag  = false;  // true when dragging from a merged (min=max) state
  let _mergeValue  = null;   // the shared value at merge
  let _dragStartX  = null;
  const SPLIT_THRESHOLD = 5; // px before direction is determined

  function startDrag(role, btn, pointerId) {
    _dragging = role;
    btn.classList.add('dragging');
    btn.setPointerCapture(pointerId);
  }

  minBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.board.forceMin === state.board.forceMax) {
      // Merged: wait to see which direction the user drags
      _mergedDrag  = true;
      _mergeValue  = state.board.forceMin;
      _dragStartX  = e.clientX;
      _dragging    = null;
      minBtn.setPointerCapture(e.pointerId);
    } else {
      _mergedDrag = false;
      startDrag('min', minBtn, e.pointerId);
    }
  });

  maxBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    _mergedDrag = false;
    startDrag('max', maxBtn, e.pointerId);
  });

  window.addEventListener('pointermove', (e) => {
    if (_mergedDrag) {
      const delta = e.clientX - _dragStartX;
      if (Math.abs(delta) < SPLIT_THRESHOLD) return;
      // Direction determined: split
      _mergedDrag = false;
      if (delta < 0) {
        // Dragging left → this becomes the MIN handle; max stays at merge value
        state.board.forceMax = _mergeValue;
        startDrag('min', minBtn, e.pointerId);
        maxBtn.style.display = '';
        maxBtn.style.left    = valueToLeft(_mergeValue) + 'px';
        if (maxDisplay) maxDisplay.textContent = _mergeValue;
      } else {
        // Dragging right → this becomes the MAX handle; min stays at merge value
        state.board.forceMin = _mergeValue;
        // Show maxBtn and make it the drag target (capture already on minBtn)
        maxBtn.style.display = '';
        maxBtn.style.left    = valueToLeft(_mergeValue) + 'px';
        if (maxDisplay) maxDisplay.textContent = _mergeValue;
        minBtn.classList.remove('merged-hollow');
        _dragging = 'max';
        // Transfer visual state
        minBtn.classList.remove('dragging');
        maxBtn.classList.add('dragging');
      }
      return;
    }

    if (!_dragging) return;
    const v = xToValue(e.clientX);
    if (_dragging === 'min') {
      state.board.forceMin = clamp(v, 1, state.board.forceMax);
      const el = document.getElementById('forceMinNum');
      if (el) el.value = state.board.forceMin;
    } else {
      state.board.forceMax = clamp(v, state.board.forceMin, 100);
      const el = document.getElementById('forceMaxNum');
      if (el) el.value = state.board.forceMax;
    }
    render();
    scheduleRecompute();
  });

  window.addEventListener('pointerup', () => {
    if (_mergedDrag) { _mergedDrag = false; return; }
    if (!_dragging) return;
    (_dragging === 'min' ? minBtn : maxBtn).classList.remove('dragging');
    _dragging = null;
  });

  render();
  return render;
}

// Force range
linkControl('forceMin','forceMinNum',(v)=>{
  if(v>=state.board.forceMax){v=state.board.forceMax-1;['forceMin','forceMinNum'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=v;});}
  state.board.forceMin=v; updateDualRangeFill(); scheduleRecompute();},{min:1,max:100});

linkControl('forceMax','forceMaxNum',(v)=>{
  if(v<=state.board.forceMin){v=state.board.forceMin+1;['forceMax','forceMaxNum'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=v;});}
  state.board.forceMax=v; updateDualRangeFill(); scheduleRecompute();},{min:1,max:100});

// Angle — wraps values >360 or <0 instead of clamping
linkControl('angle','angleNum',(v)=>{
  // Allow 0–360; physics treats 360 as 0° (sin/cos are identical).
  // Don't reset the display to 0 when the user slides to 360 — that causes a jarring jump.
  state.board.angleDeg = Math.round(clamp(v, 0, 360));
  drawBoard(); scheduleRecompute();
}, { min: 0, max: 360 });

linkControl('gravity','gravityNum',(v)=>{state.board.gravity=v;scheduleRecompute();},{min:50,max:2000});
linkControl('restitution','restitutionNum',(v)=>{state.board.restitution=v;scheduleRecompute();},{min:0.1,max:1});

// Board actions
document.getElementById('btnClearPegs').addEventListener('click',    clearAllPegs);
document.getElementById('btnResetDefault').addEventListener('click', resetToDefaultLayout);

// Save / load
document.getElementById('btnSaveLocal').addEventListener('click',  saveToLocalStorage);
document.getElementById('btnLoadLocal').addEventListener('click',  loadFromLocalStorage);
document.getElementById('btnExportJson').addEventListener('click', exportJsonToFile);
const importInput = document.getElementById('importFileInput');
document.getElementById('btnImportJson').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJsonFromFile(f); importInput.value=''; });

// Preview
document.getElementById('btnAnimateShot').addEventListener('click', playPreviewShot);

// Session
document.getElementById('sessionModeSelect').addEventListener('change',(e)=>{ state.session.mode=e.target.value; updateSessionUI(); });
document.getElementById('btnStartSession').addEventListener('click', startSession);
document.getElementById('btnStopSession').addEventListener('click',  stopSession);
document.getElementById('btnResetStats').addEventListener('click',   resetSessionStats);
document.getElementById('btnSingleShoot').addEventListener('click', () => {
  if (!state.session.active) return;  // must press Start first
  if (state.session.balls.filter(b=>!b.done).length >= MAX_BALLS_IN_FLIGHT)
    showSessionLimitMsg(`Max ${MAX_BALLS_IN_FLIGHT} balls in flight.`);
  else fireOneBall();
});
const holdBtn = document.getElementById('btnHoldShoot');
holdBtn.addEventListener('mousedown',  ()=>{ if(!state.session.active) return; setHoldActive(true); });
holdBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); if(!state.session.active) return; setHoldActive(true); });
document.addEventListener('mouseup',  ()=>setHoldActive(false));
document.addEventListener('touchend', ()=>setHoldActive(false));

// Left-panel tab switching
document.querySelectorAll('.left-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.left-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.target;
    document.querySelectorAll('.left-tab-pane').forEach(pane => {
      pane.style.display = (pane.id === target) ? '' : 'none';
    });
  });
});

// Boot
buildBgCache();
initWorker();
_updateForceDial = initForceDial();
applyLayout(buildDefaultLayout());
updateSessionUI();
renderSessionStats();
renderCombinedTable();
