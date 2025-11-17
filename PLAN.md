# D3: World of Bits

## Game Design Vision

This game is a map-based crafting adventure inspired by Pokémon Go and Threes. Players explore a real-world grid, collecting randomly generated tokens (e.g., 1, 2, 4) from nearby locations.

## Technologies

- TypeScript for most game code, little to no explicit HTML, and all CSS collected in common `style.css` file
- Deno and Vite for building
- GitHub Actions + GitHub Pages for deployment automation

## D3.a - Core Mechanics

Implement the fundamental map-based gameplay loop: deterministic token spawning, local interaction, and basic crafting.

### Steps

- [x] copy main.ts to reference.ts for future reference
- [x] Initialize Leaflet map centered on the classroom location
- [x] Display player marker at the fixed position
- [x] Implement cell indexing functions (lat/lng ↔ i/j grid coordinates)
- [x] Render full grid of cells
- [x] Implement deterministic spawn logic using the luck function
- [x] Display cell contents visibly without requiring clicks
- [x] Restrict interaction range to nearby cells (within 3-cell radius)
- [x] Add single-slot inventory showing the token in hand
- [x] Enable crafting: merge two equal-value tokens → double value
- [x] Disallow placement on empty or mismatched cells
- [x] Verify successful deployment on GitHub Pages

### D3.a complete

## D3.b - Globe-spanning Gameplay

Support gameplay anywhere in the real world

### D3.b Steps

- [x] Add UI buttons (N, S, E, W) to simulate player movement.
- [x] Implement movePlayer function to update playerIJ coordinates.
- [x] Use earth-spanning coordinates anchored at Null Island.
- [x] Implement "memoryless" cells
- [x] Increase victory TARGET to 32 to require farming
- [x] Update renderGrid to draw cells based on map bounds, not player radius.
- [x] Implement camera logic to pan only when player hits map boundary.

### D3.b complete

## D3.c - Object Persistence

Fix the farming bug by implementing persistent cell memory, satisfying the Flyweight pattern requirements.

### D3.c Steps

- [x] Implement persistent cell state by removing clearVisibleState() call from movePlayer.
- [x] Re-implement Victory logic, as players can now pick up previously crafted highvalue tokens.
- [x] Verify that modified cell values persist after moving/scrolling off-screen and back.

### D3.c complete

## D3.d Steps

- [x] Implement state persistence using localStorage
- [x] Add a New Game button
- [x] Implement Geolocation based movement
- [x] Implement movement mode switching
