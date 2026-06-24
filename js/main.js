// Entry point — initialises everything in the right order.

import { buildDefaultLayout, applyLayout, injectDeps } from './persistence.js';
import { scheduleRecompute, syncControlsFromState,
         updateHoleEditorList, wireAllControls } from './ui.js';
import { updatePegTrayLabel } from './editor.js';
import { updateSessionUI, renderSessionStats } from './session.js';
import { drawBoard } from './renderer.js';

// Give persistence.js the callbacks it needs (avoids circular imports at the
// module load level, while still sharing the same scheduler instance).
injectDeps({
  scheduleRecompute,
  syncControls:       syncControlsFromState,
  updateHoleEditor:   updateHoleEditorList,
  updatePegTrayLabel
});

wireAllControls();

// Apply the default Pascal-triangle layout immediately.
applyLayout(buildDefaultLayout());

// Session UI starts in a clean idle state.
updateSessionUI();
renderSessionStats();
