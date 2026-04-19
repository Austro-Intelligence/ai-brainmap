# Changelog

All notable changes to **ai-brainmap** are documented here. This project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.0 — Bubble, retract & cineastic zoom

### Added
- **Bubble-out animation** on expand — newly revealed children spawn at
  their parent's position and grow from scale 0 → 1 via sine-ease while
  the force-graph physics fans them out.
- **Retract animation** on collapse — departing descendants fly into their
  parent's center and shrink to zero over 733 ms before being removed
  from the graph.
- **Cineastic search zoom** — every keystroke orbits the camera onto the
  centroid of the current hits (1 000 ms `cameraPosition` flight, same
  technique as the activity-log click). Single hits fly directly to the
  node; multi-hit zooms scale distance with the hit bounding box.
- **Sun toggle** — clicking the HDR sun root now toggles the entire tree
  between fully expanded and fully collapsed.

### Changed
- All tween durations rescaled for a more cineastic feel: hover 466 ms,
  plus 400 ms, spawn-fade 733 ms, bubble-out 1 066 ms, retract 733 ms.
  Physics uses `d3AlphaDecay 0.012` and `cooldownTime 13 320 ms`.
- **Label age minimum** raised from 0.10 → **0.222** so the oldest nodes
  remain readable.
- Position cache keeps existing nodes from snapping on rebuild; new nodes
  are seeded exactly at their parent for a visible growth effect.

### Fixed
- Search no longer dims the whole graph — the earlier opacity-path
  filtering caused visual sunburst artefacts on dense link clusters and
  has been reverted. Only the camera zoom reacts to search hits now.

## 0.4.0 — Frontend overhaul

### Added
- HDR sun at the root: procedural core texture with granulation, sunspots
  and faculae; 3-layer chromosphere; 4 bloom sprite billboards; 14 flame
  protuberances; 26 sparks, 14 micro-explosions and 5 solar-storm bursts.
- Sine ease-in / ease-out utilities across hover, plus-marker fade and
  sun particle life cycles.
- Hover highlight with camera-facing glow sphere and scale ease.
- Screen-space node picker (26 px radius, label-aware, drag-guarded).
- "+" marker on collapsed structure nodes — square canvas texture,
  white fill / black outline, sine-eased fade.
- Sub-nodes under Werkzeuge / Web / Agenten inherit their bucket color.
- Search-to-zoom via `forceGraph3d.zoomToFit` with a node filter.

### Changed
- Auto-fit button downsized to 32 × 32 px to match the searchbar height.
- Removed the 3D orientation gizmo.
- os-notice aligned to the footer baseline at 10 px font size.
- Media queries stack the searchbar over the settings panel on narrow
  viewports (≤ 720 px) and full-width at ≤ 480 px.
- Canvas resize handler keeps the WebGL surface, camera aspect and SVG
  fallback in sync with window resizes via rAF-debounced updates.

## 0.3.0 and earlier

Initial marketplace restructure, Python HTTP server, D3 frontend, and the
first live context visualization — see the commit history for details.
