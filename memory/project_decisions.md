---
name: pachinko-project-decisions
description: User's design decisions for the Pachinko Expected Reward Simulator rewrite (June 2026)
metadata:
  type: project
---

Full rewrite completed June 2026. Key decisions locked in by user:

- **Angle convention**: 0–360°, 0 = straight up, clockwise (0→right→180→down→270→left)
- **Session modes**: All three — Single (click per shot), Auto (continuous), Hold (hold button)
- **Multiple balls**: Up to 5 in flight simultaneously
- **Session controls**: Stop + Reset Stats separately (Stop freezes results, Reset clears them)
- **Pascal layout**: 5 rows (15 pegs, 1+2+3+4+5), 6 spare pegs, MAX_PEGS=21
- **Peg bank**: Numeric count + single drag-source (existing behavior, re-labeled)
- **Saved layouts**: Prompt user on Load from Browser if layout differs from default
- **Approximation warning**: Both inline badge (~approx) AND banner when sampler cap hit
- **Session stats reset**: Only on explicit "Reset Stats" button click
- **Target**: Desktop only (≥1160 px, 3-column layout)
- **Accessibility**: Minimal (canvas aria-label, aria-live for stats)
- **Force distribution**: Uniform across [min, max]

**Why:** These were answered in a structured Q&A before implementation began.
**How to apply:** Do not change these conventions without user confirmation.
