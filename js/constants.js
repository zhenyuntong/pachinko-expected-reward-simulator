export const BOARD = {
  width: 640,
  height: 720,
  ballRadius: 7,
  pegRadius: 8,
  wallThickness: 6,
  launchX: 320,
  launchY: 34,
  holeBandHeight: 30
};

export const MAX_PEGS = 21;   // 15 Pascal (rows 1-5) + 6 spare
export const MAX_HOLES = 6;
export const MIN_PEG_SEPARATION = BOARD.pegRadius * 2 + 4;
export const SNAP_RADIUS = 16;

export const HOLE_COLORS = [
  '#5fb3a3', '#e3a64f', '#d97757',
  '#7a8fc2', '#9b7bbf', '#6fbf8b'
];

export const FORCE_TO_SPEED = 4;
export const SIM_DT = 1 / 240;

export const MAX_BALLS_IN_FLIGHT = 5;
export const SESSION_STEPS_PER_FRAME = 4;   // physics steps per rAF tick
export const AUTO_FIRE_INTERVAL_MS = 500;    // ms between auto-fired shots
export const BALL_LINGER_FRAMES = 80;        // frames a landed ball stays visible
