// Shared mutable application state.  All modules import this object and
// mutate it directly — no secondary copies.

export const state = {
  board: {
    pegs:        [],
    holes:       [],
    forceMin:    30,
    forceMax:    70,
    angleDeg:    0,     // 0-360°, 0 = straight up, 90 = right
    gravity:     600,
    restitution: 0.78
  },

  pegMode: 'free',   // 'free' | 'assisted'

  ui: {
    selectedPegId:  null,
    draggingPeg:    null,  // { id, fromTray, x, y, overTrash }
    draggingHole:   null,  // { id, mode, startPointerX, startLeft, startWidth }
    hoverDotIndex:  -1,
    isPointerDown:  false
  },

  expected: null,   // last result from calculateExpectedReward()

  session: {
    active:        false,
    mode:          'single',  // 'single' | 'auto' | 'hold'
    balls:         [],        // Ball objects (see physics.js createBall)
    shotsCompleted: 0,
    totalReward:   0,
    holeHits:      [],        // count per hole index
    misses:        0,
    timedOuts:     0,
    lastFireTime:  0,
    rafId:         null,
    holdActive:    false      // true while hold-button is depressed
  },

  preview: null   // active preview animation or null
};

let _pegId  = 1;
let _holeId = 1;
let _ballId = 1;

export function nextPegId()  { return _pegId++;  }
export function nextHoleId() { return _holeId++; }
export function nextBallId() { return _ballId++; }
