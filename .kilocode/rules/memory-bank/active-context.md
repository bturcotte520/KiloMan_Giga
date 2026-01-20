# Active Context - Kilo Man

## Current Focus

The game is in a stable, playable state with core mechanics implemented. Recent work focused on **tuning jump physics** for a snappier, more satisfying feel.

## Recent Changes (January 2026)

### Jump Mechanics Overhaul
- **`jumpStrength`**: Increased from 13 → 18 (higher jumps)
- **`gravity.y`**: Set to 1.8 (faster falls, snappier feel)
- **`frictionAir`**: Reduced from 0.012 → 0.003 (cleaner arc)
- **`restitution`**: Changed from 0.2 → 0 (no bounce on landing)

### Files Modified
- [`components/GameCanvas.tsx`](components/GameCanvas.tsx) - Physics configuration updates

## Active Decisions

| Decision | Rationale |
|----------|-----------|
| High gravity + high jump | Creates arcade-style responsive controls |
| Zero restitution | Immediate player control after landing |
| Reduced air friction | Purer parabolic jump arc |

## Known Issues / Technical Debt

1. **Game restart** - Currently uses `window.location.reload()` instead of state reset
2. **Score system** - Score variable exists but never increments
3. **Lives system** - Lives state exists but unused (instant death)
4. **Mobile controls** - No touch input support yet

## Current Blockers

None - game is playable and stable.

## Next Logical Steps

1. Implement proper game reset without page reload
2. Add score pickups (coins/gems)
3. Implement lives/health system
4. Add mobile touch controls
5. Sound effects and music
