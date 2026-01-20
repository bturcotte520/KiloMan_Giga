# Product Context - Kilo Man

## Why This Project Exists

**Kilo Man** is a passion project demonstrating modern web technologies can deliver compelling 2D platformer experiences without traditional game engines. It serves as both a playable game and a technical showcase.

## Problems It Solves

1. **Web-native gaming** - No downloads, plugins, or installations required
2. **Physics-based gameplay** - Realistic movement via Matter.js instead of simple velocity calculations
3. **Responsive design** - Adapts to any viewport size automatically
4. **Modern architecture** - Built on Next.js App Router for optimal performance

## How Users Interact With It

### Landing Page Flow
1. User visits the root URL
2. Sees welcome screen with "Start Game" button
3. Clicks to navigate to `/game` route

### Gameplay Flow
1. Player controls "Kilo Man" character with keyboard
2. Navigates left-to-right through obstacle course
3. Avoids spikes, monsters, and falling off platforms
4. Reaches goal gate to win
5. Death/fall triggers game over screen with replay option

### UI Controls
- **Jump Slider** - Real-time adjustment of jump strength (10-18 range)
- **Game Over Overlay** - Shows score and "Play Again" button
- **Win Overlay** - Shows completion message and replay option

## User Experience Goals

| Goal | Implementation |
|------|----------------|
| Immediate playability | No loading screens, instant game start |
| Satisfying physics | Snappy jump with high gravity, no bounce |
| Clear visual feedback | Gold/black neon aesthetic, glow effects |
| Fair challenge | Progressive difficulty across 8000-unit level |
| Quick retry | Single click to restart on death |

## Target Audience

- Retro gaming enthusiasts (Mega Man, Castlevania fans)
- Web developers exploring game development
- Users seeking quick browser-based entertainment
