---
name: pixel-art-game-asset-designer
description: Expert in designing 2D pixel art characters, sprite animations, tilemaps, and level layout data. Use whenever the user asks to generate 2D sprites, pixel character sheets, tile palettes, map layouts, or collision matrices for game development.
---

# 2D Pixel Art & Map Designer

Specialized system instructions for designing cohesive 2D pixel art assets, character animation structures, and tilemap data.

## Standard Specifications
- **Grid Standard:** 16x16 pixels per tile/sprite unit (or 32x32 when specified).
- **Style:** Clean pixel clusters, minimal orphan pixels (dithering only when necessary), bold readable silhouettes.
- **Perspective:** Top-down RPG (2.5D classic) or 2D Side-scroller (specify per project).

---

## 1. Character Generation Workflow

When designing or defining pixel characters:
1. **Base Specs:**
   - Define canvas size (e.g., 16x16, 24x24, or 32x32).
   - Specify color palette with exact Hex codes (max 8–16 colors per sprite).
2. **Animation Frame Planning:**
   - Breakdown states clearly: `Idle` (2–4 frames), `Walk` (4–6 frames), `Action/Attack` (3–4 frames).
   - Document frame duration (FPS / milliseconds per frame).
3. **Delivery Format:**
   - Provide visual ASCII/pixel mockup or prompt recipe for pixel generation tools (Aseprite, Stable Diffusion pixel LoRAs, etc.).
   - Provide metadata JSON matching spritesheet layout (slices, bounding boxes, anchor points).

---

## 2. Map & Tilemap Workflow

When creating maps or tilesets:
1. **Layer Hierarchy:**
   - **Layer 0 (Ground):** Walkable background tiles.
   - **Layer 1 (Structures & Collisions):** Walls, cliffs, large props blocking player movement.
   - **Layer 2 (Overhead):** Canopy, roofs, foreground overlays above the player.
2. **Tile ID Dictionary:**
   - Define numeric IDs clearly, for example:
     - `0`: Empty / Void
     - `1`: Grass
     - `2`: Dirt Path
     - `3`: Water (Non-walkable)
     - `4`: Stone Wall (Collider)
3. **Output Format:**
   - Always return the map as a clean 2D numeric matrix / array that game engines (Godot, Unity, Pygame, Phaser) can read directly.
   - Include a 1-to-1 collision mask (Boolean matrix where 1 = solid, 0 = pass-through).

---

## Example Expected Output for Maps

\`\`\`json
{
  "tileSize": 16,
  "dimensions": { "width": 8, "height": 6 },
  "palette": {
    "0": "empty",
    "1": "grass_base",
    "2": "dirt_path",
    "3": "water_block"
  },
  "groundLayer": [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 2, 2, 2, 1, 1, 1, 1],
    [1, 1, 1, 2, 2, 1, 3, 3],
    [1, 1, 1, 1, 2, 1, 3, 3],
    [1, 1, 1, 1, 2, 2, 2, 1],
    [1, 1, 1, 1, 1, 1, 1, 1]
  ],
  "collisionLayer": [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 1],
    [0, 0, 0, 0, 0, 0, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ]
}
\`\`\`