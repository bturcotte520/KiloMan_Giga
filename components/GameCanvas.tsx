'use client';

import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

interface GameCanvasProps {
  /** Optional fixed viewport width. If omitted, canvas uses full viewport width. */
  width?: number;
  /** Optional fixed viewport height. If omitted, canvas uses full viewport height. */
  height?: number;
  /** Jump impulse (applied as instantaneous upward velocity). Higher = higher jump. */
  jumpStrength?: number;
  /** @deprecated Use jumpStrength instead. Kept for backward compatibility. */
  jumpHeight?: number;
}

// Parallax layer interface
interface ParallaxLayer {
  speed: number; // Parallax speed factor (0-1, lower = slower)
  draw: (ctx: CanvasRenderingContext2D, offsetX: number) => void;
}

type PatrolDirection = 1 | -1;
type MonsterAIKind = 'patrol' | 'flying';

interface MonsterAIState {
  kind: MonsterAIKind;
  originX: number;
  originY: number;
  range: number;
  speed: number;
  dir: PatrolDirection;
  // Flying-only tuning
  chaseRadius?: number;
  hoverAmp?: number;
  hoverFreq?: number;
 }

const GameCanvas: React.FC<GameCanvasProps> = ({
  width,
  height,
  jumpStrength = 22,
  jumpHeight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const playerRef = useRef<Matter.Body | null>(null);
  const playerHeadRef = useRef<Matter.Body | null>(null);
  const playerGroundedRef = useRef<boolean>(false);
  const playerFacingRef = useRef<1 | -1>(1);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const cameraXRef = useRef<number>(0);
  const parallaxLayersRef = useRef<ParallaxLayer[]>([]);
  const parallaxNoisePatternRef = useRef<CanvasPattern | null>(null);
  const monstersRef = useRef<Matter.Body[]>([]);
  const monsterAIRef = useRef<Map<number, MonsterAIState>>(new Map());
  const monsterStyleSeedRef = useRef<Map<number, number>>(new Map());
  const projectilesRef = useRef<Matter.Body[]>([]);
  const movingPlatformRef = useRef<Matter.Body | null>(null);
  const movingPlatformAIRef = useRef<{ originX: number; range: number; speed: number; dir: PatrolDirection } | null>(null);
  const jumpStrengthRef = useRef<number>(jumpStrength);
  const jumpWasDownRef = useRef<boolean>(false);
  const viewportWRef = useRef<number>(width ?? 800);
  const viewportHRef = useRef<number>(height ?? 600);
  const gameStateRef = useRef<'playing' | 'gameOver' | 'won'>('playing');
  const [gameState, setGameState] = useState<'playing' | 'gameOver' | 'won'>('playing');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: width ?? 800,
    h: height ?? 600,
  });

  useEffect(() => {
    // Prefer the new prop, but allow the old one to still work.
    const next = typeof jumpHeight === 'number' ? jumpHeight : jumpStrength;
    jumpStrengthRef.current = next;
  }, [jumpStrength, jumpHeight]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

  // World Y scale stays stable; viewport can be any size.
  const WORLD_HEIGHT = 600;
  const GROUND_HEIGHT = 50;
  const PLAYER_WIDTH = 40;
  const PLAYER_HEIGHT = 60;

  // Create parallax layers
  const createParallaxLayers = (vw: number, vh: number): ParallaxLayer[] => {
    const layers: ParallaxLayer[] = [];

    // Layer 0: Base gradient + subtle noise
    layers.push({
      speed: 0,
      draw: (ctx) => {
        const grd = ctx.createLinearGradient(0, 0, 0, vh);
        grd.addColorStop(0, '#050505');
        grd.addColorStop(0.55, '#000000');
        grd.addColorStop(1, '#0a0a0a');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, vw, vh);

        if (parallaxNoisePatternRef.current) {
          ctx.save();
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = parallaxNoisePatternRef.current;
          ctx.fillRect(0, 0, vw, vh);
          ctx.restore();
        }
      },
    });

    // Layer 1: Distant grid
    layers.push({
      speed: 0.1,
      draw: (ctx, offsetX) => {
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        const gridSize = 40;
        const offset = offsetX;

        for (let x = offset % gridSize; x < vw; x += gridSize) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, vh);
        }

        for (let y = 0; y < vh; y += gridSize) {
          ctx.moveTo(0, y);
          ctx.lineTo(vw, y);
        }

        ctx.stroke();
      },
    });

    // Layer 2: Silhouette skyline
    layers.push({
      speed: 0.18,
      draw: (ctx, offsetX) => {
        const horizonY = Math.round(vh * 0.72);
        const tileW = 520;
        const x0 = -(((offsetX % tileW) + tileW));

        for (let tx = x0; tx < vw + tileW; tx += tileW) {
          ctx.fillStyle = '#0e0e0e';
          ctx.beginPath();
          ctx.moveTo(tx, vh);
          ctx.lineTo(tx + 40, horizonY);
          ctx.lineTo(tx + 90, horizonY - 30);
          ctx.lineTo(tx + 140, horizonY);
          ctx.lineTo(tx + 190, horizonY - 55);
          ctx.lineTo(tx + 270, horizonY - 10);
          ctx.lineTo(tx + 350, horizonY - 60);
          ctx.lineTo(tx + 430, horizonY);
          ctx.lineTo(tx + tileW, vh);
          ctx.closePath();
          ctx.fill();

          ctx.save();
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = '#FFD700';
          for (let i = 0; i < 10; i++) {
            const wx = tx + 70 + i * 38;
            const wy = horizonY - 30 - (i % 3) * 10;
            ctx.fillRect(wx, wy, 6, 2);
          }
          ctx.restore();
        }
      },
    });

    // Layer 3: Mid haze bands
    layers.push({
      speed: 0.28,
      draw: (ctx, offsetX) => {
        const bandCount = 4;
        const baseY = Math.round(vh * 0.18);
        const bandH = 26;
        const tileW = 900;
        const x0 = -(((offsetX % tileW) + tileW));

        ctx.save();
        ctx.globalAlpha = 0.35;
        for (let b = 0; b < bandCount; b++) {
          const y = baseY + b * 70;
          for (let x = x0; x < vw + tileW; x += tileW) {
            const g = ctx.createLinearGradient(x, y, x + tileW, y);
            g.addColorStop(0, 'rgba(255,215,0,0)');
            g.addColorStop(0.35, 'rgba(255,215,0,0.08)');
            g.addColorStop(0.7, 'rgba(255,215,0,0.03)');
            g.addColorStop(1, 'rgba(255,215,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, tileW, bandH);
          }
        }
        ctx.restore();
      },
    });

    // Layer 4: Strong parallax lanes + scanlines
    layers.push({
      speed: 0.45,
      draw: (ctx, offsetX) => {
        const spacing = 90;
        const offset = offsetX;
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;

        ctx.beginPath();
        for (let x = offset % spacing; x < vw; x += spacing) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, vh);
        }
        ctx.stroke();

        ctx.globalAlpha = 0.12;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = 0; y < vh; y += 7) {
          ctx.moveTo(0, y);
          ctx.lineTo(vw, y);
        }
        ctx.stroke();
        ctx.restore();
      },
    });

    // Layer 5: Foreground accents + glow
    layers.push({
      speed: 0.6,
      draw: (ctx, offsetX) => {
        const tileW = 600;
        const x0 = -(((offsetX % tileW) + tileW));
        const groundY = Math.round(vh * 0.86);

        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#070707';
        ctx.fillRect(0, groundY, vw, vh - groundY);
        ctx.restore();

        for (let tx = x0; tx < vw + tileW; tx += tileW) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#FFD700';
          ctx.fillRect(tx + 80, groundY - 18, 140, 6);
          ctx.fillRect(tx + 260, groundY - 44, 90, 6);
          ctx.restore();

          const orbX = tx + 440;
          const orbY = groundY - 60;
          const rg = ctx.createRadialGradient(orbX, orbY, 2, orbX, orbY, 70);
          rg.addColorStop(0, 'rgba(255,215,0,0.25)');
          rg.addColorStop(1, 'rgba(255,215,0,0)');
          ctx.fillStyle = rg;
          ctx.fillRect(orbX - 70, orbY - 70, 140, 140);
        }
      },
    });

    return layers;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Resolve viewport. If width/height props are not provided, we go fullscreen.
    const initialW = typeof width === 'number' ? width : window.innerWidth;
    const initialH = typeof height === 'number' ? height : window.innerHeight;
    viewportWRef.current = initialW;
    viewportHRef.current = initialH;
    setViewport({ w: initialW, h: initialH });

    // Build a subtle noise pattern (once)
    if (!parallaxNoisePatternRef.current) {
      const noiseCanvas = document.createElement('canvas');
      noiseCanvas.width = 256;
      noiseCanvas.height = 256;
      const nctx = noiseCanvas.getContext('2d');
      if (nctx) {
        const img = nctx.createImageData(noiseCanvas.width, noiseCanvas.height);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.floor(30 + Math.random() * 40);
          img.data[i + 0] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        nctx.putImageData(img, 0, 0);
        parallaxNoisePatternRef.current = canvas.getContext('2d')?.createPattern(noiseCanvas, 'repeat') ?? null;
      }
    }

    // Initialize parallax layers
    parallaxLayersRef.current = createParallaxLayers(initialW, initialH);

    // Create engine
    const engine = Matter.Engine.create();
    // Keep AI-driven bodies updating even at low velocity (prevents patrols from going to sleep).
    engine.enableSleeping = false;
    // Increase gravity for snappier, more responsive jump feel (faster fall)
    engine.gravity.y = 1.8;
    engineRef.current = engine;

    // Create renderer with custom background
    const render = Matter.Render.create({
      canvas,
      engine,
      options: {
        width: initialW,
        height: initialH,
        wireframes: false,
        background: 'transparent', // Make background transparent to draw our own
        hasBounds: true, // required for true camera scrolling via render.bounds
      },
    });
    renderRef.current = render;

    // Create runner
    const runner = Matter.Runner.create();
    runnerRef.current = runner;

    // Finite level setup
    const LEVEL_LENGTH = 8000;

    // Build ground across the full level length.
    const groundSegments: Matter.Body[] = [];
    const segmentWidth = 900;
    const segmentCount = Math.ceil(LEVEL_LENGTH / segmentWidth);
    for (let i = 0; i < segmentCount; i++) {
      const segX = i * segmentWidth + segmentWidth / 2;
      const seg = Matter.Bodies.rectangle(segX, WORLD_HEIGHT - GROUND_HEIGHT / 2, segmentWidth + 2, GROUND_HEIGHT, {
        isStatic: true,
        friction: 1,
        render: { fillStyle: '#0b0b0b', strokeStyle: '#1b1b1b', lineWidth: 2 },
        label: 'ground',
      });
      groundSegments.push(seg);
    }

    // Level boundary walls (keeps physics stable at the extremes)
    const leftWall = Matter.Bodies.rectangle(-25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT * 4, {
      isStatic: true,
      render: { visible: false },
      label: 'boundary',
    });
    const rightWall = Matter.Bodies.rectangle(LEVEL_LENGTH + 25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT * 4, {
      isStatic: true,
      render: { visible: false },
      label: 'boundary',
    });

    // Create level obstacles and platforms across the full level
    const obstacles: Matter.Body[] = [];

    const platformSpecs = [
      { x: 800, y: WORLD_HEIGHT - 150, w: 220, h: 20 },
      { x: 1400, y: WORLD_HEIGHT - 240, w: 160, h: 20 },
      { x: 1900, y: WORLD_HEIGHT - 200, w: 200, h: 20 },
      { x: 2600, y: WORLD_HEIGHT - 170, w: 260, h: 20 },
      { x: 3300, y: WORLD_HEIGHT - 260, w: 180, h: 20 },
      { x: 4200, y: WORLD_HEIGHT - 210, w: 220, h: 20 },
      { x: 5000, y: WORLD_HEIGHT - 280, w: 200, h: 20 },
      { x: 5800, y: WORLD_HEIGHT - 200, w: 240, h: 20 },
      { x: 6600, y: WORLD_HEIGHT - 240, w: 200, h: 20 },
    ];

    platformSpecs.forEach((p) => {
      obstacles.push(
        Matter.Bodies.rectangle(p.x, p.y, p.w, p.h, {
          isStatic: true,
          friction: 1,
          chamfer: { radius: 6 },
          render: {
            fillStyle: '#F5C400',
            strokeStyle: 'rgba(255, 246, 180, 0.85)',
            lineWidth: 2,
          },
          label: 'platform',
        })
      );
    });

    // Moving platform (mid-level)
    const movingPlatformCenterX = 3600;
    const movingPlatform = Matter.Bodies.rectangle(movingPlatformCenterX, WORLD_HEIGHT - 320, 140, 20, {
      isStatic: false,
      friction: 1,
      frictionAir: 0.02,
      chamfer: { radius: 6 },
      render: {
        fillStyle: '#FFB000',
        strokeStyle: 'rgba(255, 215, 0, 0.9)',
        lineWidth: 2,
      },
      label: 'movingPlatform',
    });
    // Keep it stable (no spin) and always moving.
    Matter.Body.setInertia(movingPlatform, Infinity);
    obstacles.push(movingPlatform);
    movingPlatformRef.current = movingPlatform;
    movingPlatformAIRef.current = { originX: movingPlatformCenterX, range: 120, speed: 1.1, dir: 1 };

    // Create spike traps
    const spikePositions = [
      { x: 1100, y: WORLD_HEIGHT - GROUND_HEIGHT },
      { x: 2100, y: WORLD_HEIGHT - GROUND_HEIGHT },
      { x: 2950, y: WORLD_HEIGHT - GROUND_HEIGHT },
      { x: 4550, y: WORLD_HEIGHT - GROUND_HEIGHT },
      { x: 5450, y: WORLD_HEIGHT - GROUND_HEIGHT },
      { x: 6250, y: WORLD_HEIGHT - GROUND_HEIGHT },
      { x: 7100, y: WORLD_HEIGHT - GROUND_HEIGHT },
    ];

    spikePositions.forEach(pos => {
      const spike = Matter.Bodies.polygon(pos.x, pos.y, 3, 30, {
        isStatic: true,
        render: {
          fillStyle: '#FF3B3B',
          strokeStyle: 'rgba(255, 215, 0, 0.65)',
          lineWidth: 2,
        },
        label: 'spike',
      });
      obstacles.push(spike);
    });

    // Create wall obstacles (adds some variety)
    const wall1 = Matter.Bodies.rectangle(2400, WORLD_HEIGHT - 110, 20, 160, {
      isStatic: true,
      render: { fillStyle: '#F5C400', strokeStyle: 'rgba(255, 246, 180, 0.85)', lineWidth: 2 },
      label: 'wall',
    });
    obstacles.push(wall1);

    const wall2 = Matter.Bodies.rectangle(4700, WORLD_HEIGHT - 180, 20, 300, {
      isStatic: true,
      render: { fillStyle: '#F5C400', strokeStyle: 'rgba(255, 246, 180, 0.85)', lineWidth: 2 },
      label: 'wall',
    });
    obstacles.push(wall2);

    // End gate + goal sensor (win triggers only via sensor overlap)
    const GOAL_X = LEVEL_LENGTH - 260;
    const goalPillarLeft = Matter.Bodies.rectangle(GOAL_X - 70, WORLD_HEIGHT - 140, 30, 180, {
      isStatic: true,
      render: { fillStyle: '#F5C400', strokeStyle: 'rgba(255, 246, 180, 0.85)', lineWidth: 2 },
      label: 'gate',
    });
    const goalPillarRight = Matter.Bodies.rectangle(GOAL_X + 70, WORLD_HEIGHT - 140, 30, 180, {
      isStatic: true,
      render: { fillStyle: '#F5C400', strokeStyle: 'rgba(255, 246, 180, 0.85)', lineWidth: 2 },
      label: 'gate',
    });
    const goalTop = Matter.Bodies.rectangle(GOAL_X, WORLD_HEIGHT - 230, 180, 24, {
      isStatic: true,
      chamfer: { radius: 8 },
      render: { fillStyle: '#F5C400', strokeStyle: 'rgba(255, 246, 180, 0.85)', lineWidth: 2 },
      label: 'gate',
    });
    const goalFlag = Matter.Bodies.rectangle(GOAL_X + 110, WORLD_HEIGHT - 250, 16, 80, {
      isStatic: true,
      render: { fillStyle: '#00FF7A', strokeStyle: 'rgba(255,255,255,0.25)', lineWidth: 1 },
      label: 'gate',
    });
    // Sensor placed inside the arch opening.
    const goalSensor = Matter.Bodies.rectangle(GOAL_X, WORLD_HEIGHT - 140, 120, 150, {
      isStatic: true,
      isSensor: true,
      render: {
        fillStyle: 'rgba(255, 215, 0, 0.10)',
        strokeStyle: '#FFD700',
        lineWidth: 2,
      },
      label: 'goal',
    });
    obstacles.push(goalPillarLeft, goalPillarRight, goalTop, goalFlag, goalSensor);

    // Create monsters with AI
    const monsters: Matter.Body[] = [];

    const initMonsterPhysics = (b: Matter.Body) => {
      // Ensure monsters are dynamic and don't spin/tumble.
      b.isStatic = false;
      b.frictionAir = Math.max(b.frictionAir ?? 0, 0.02);
      b.friction = 0;
      b.restitution = 0;
      Matter.Body.setInertia(b, Infinity);
      // Extra guard: keep them awake even if Sleeping ever gets toggled on.
      (b as unknown as { sleepThreshold?: number }).sleepThreshold = Infinity;
      Matter.Sleeping.set(b, false);
    };

    // Monster 1: Patrolling on ground
    const monster1CenterX = 1200;
    const monster1 = Matter.Bodies.rectangle(monster1CenterX, WORLD_HEIGHT - 80, 40, 40, {
      chamfer: { radius: 6 },
      render: { fillStyle: '#FF6B6B', strokeStyle: 'rgba(255, 215, 0, 0.35)', lineWidth: 2 },
      label: 'monster',
      density: 0.001,
      friction: 0.8,
    });
    initMonsterPhysics(monster1);
    monster1.render.visible = false;
    monsterStyleSeedRef.current.set(monster1.id, (monster1.id * 9301 + 49297) % 233280);
    monsterAIRef.current.set(monster1.id, {
      kind: 'patrol',
      originX: monster1CenterX,
      originY: monster1.position.y,
      range: 240,
      speed: 2.2,
      dir: 1,
    });
    monsters.push(monster1);

    // Monster 2: Patrolling on platform
    const monster2CenterX = 3350;
    const monster2 = Matter.Bodies.rectangle(monster2CenterX, WORLD_HEIGHT - 290, 40, 40, {
      chamfer: { radius: 6 },
      render: { fillStyle: '#FF6B6B', strokeStyle: 'rgba(255, 215, 0, 0.35)', lineWidth: 2 },
      label: 'monster',
      density: 0.001,
      friction: 0.8,
    });
    initMonsterPhysics(monster2);
    monster2.render.visible = false;
    monsterStyleSeedRef.current.set(monster2.id, (monster2.id * 9301 + 49297) % 233280);
    monsterAIRef.current.set(monster2.id, {
      kind: 'patrol',
      originX: monster2CenterX,
      originY: monster2.position.y,
      range: 180,
      speed: 1.9,
      dir: -1,
    });
    monsters.push(monster2);

    // Monster 3: Flying monster
    const monster3 = Matter.Bodies.circle(5600, WORLD_HEIGHT - 360, 25, {
      render: { fillStyle: '#FFB000', strokeStyle: 'rgba(255, 215, 0, 0.55)', lineWidth: 2 },
      label: 'monster',
      density: 0.0001,
      frictionAir: 0.01,
    });
    initMonsterPhysics(monster3);
    monster3.render.visible = false;
    monsterStyleSeedRef.current.set(monster3.id, (monster3.id * 9301 + 49297) % 233280);
    monsterAIRef.current.set(monster3.id, {
      kind: 'flying',
      originX: 5600,
      originY: WORLD_HEIGHT - 360,
      range: 0,
      speed: 2.6,
      dir: 1,
      chaseRadius: 340,
      hoverAmp: 22,
      hoverFreq: 0.0022,
    });
    monsters.push(monster3);

    monstersRef.current = monsters;
    
    // Create player character (Kilo Man) - humanoid shape using composite
    const playerWidth = 40;
    const playerHeight = 60;
    const playerX = 120;
    const playerY = WORLD_HEIGHT - GROUND_HEIGHT - playerHeight / 2;

    // Main body (torso) - with collision filtering to avoid player part collisions
    const torso = Matter.Bodies.rectangle(playerX, playerY, playerWidth, playerHeight * 0.6, {
      density: 0.001,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0.003, // Reduced air friction for cleaner jump arc
      restitution: 0, // No bounce on landing for snappy feel
      render: { fillStyle: '#FF6B6B', strokeStyle: 'rgba(255, 215, 0, 0.45)', lineWidth: 2 },
      collisionFilter: {
        group: -1, // Negative group means bodies in the same group don't collide
      },
    });
    // We draw the player manually (cohesive sprite-like humanoid), so hide Matter's default body rendering.
    torso.render.visible = false;

    // Keep player upright for consistent platforming feel
    Matter.Body.setInertia(torso, Infinity);

    // Head - with collision filtering to avoid player part collisions
    const head = Matter.Bodies.circle(playerX, playerY - playerHeight * 0.4, playerWidth * 0.4, {
      density: 0.001,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0.003, // Reduced air friction for cleaner jump arc
      restitution: 0, // No bounce on landing for snappy feel
      render: { fillStyle: '#FFD166', strokeStyle: 'rgba(255, 215, 0, 0.65)', lineWidth: 2 },
      collisionFilter: {
        group: -1, // Negative group means bodies in the same group don't collide
      },
    });
    // Hide physics head shape (prevents the "detached ball" look).
    head.render.visible = false;

    // Player composite
    const player = Matter.Composites.stack(playerX - playerWidth / 2, playerY - playerHeight / 2, 1, 1, 0, 0, (x: number, y: number) => {
      return torso;
    });
    Matter.Composite.add(player, head);

    // Head-to-torso constraint to avoid the head drifting away
    const neck = Matter.Constraint.create({
      bodyA: torso,
      bodyB: head,
      pointA: { x: 0, y: -playerHeight * 0.2 },
      pointB: { x: 0, y: playerWidth * 0.4 },
      length: 0,
      stiffness: 0.95,
      damping: 0.15,
      render: { visible: false },
    });
    Matter.Composite.add(player, neck);

    // Set player reference
    playerRef.current = torso;

    playerHeadRef.current = head;

    // Add all bodies to world
    Matter.World.add(engine.world, [
      ...groundSegments,
      leftWall,
      rightWall,
      player,
      ...obstacles,
      ...monsters,
    ]);

    // Keyboard + scroll suppression (only while the game view is focused/active)
    const isGameActive = () => {
      const el = containerRef.current;
      if (!el) return true;
      const focused = document.activeElement === el || el.contains(document.activeElement);
      return focused && gameStateRef.current === 'playing';
    };

    const isScrollKey = (code: string) =>
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isScrollKey(e.code) && isGameActive()) {
        e.preventDefault();
      }
      keysRef.current[e.code] = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isScrollKey(e.code) && isGameActive()) {
        e.preventDefault();
      }
      keysRef.current[e.code] = false;
    };

    const handleTouchMoveOrWheel = (e: Event) => {
      if (isGameActive()) {
        e.preventDefault();
      }
    };

    const listenerOpts: AddEventListenerOptions = { passive: false };
    window.addEventListener('keydown', handleKeyDown, listenerOpts);
    window.addEventListener('keyup', handleKeyUp, listenerOpts);
    window.addEventListener('touchmove', handleTouchMoveOrWheel, listenerOpts);
    window.addEventListener('wheel', handleTouchMoveOrWheel, listenerOpts);

    // Capture keyboard immediately.
    queueMicrotask(() => containerRef.current?.focus());

    // Projectile creation function
    const createProjectile = () => {
      if (!playerRef.current) return;

      const player = playerRef.current;
      const facing = playerFacingRef.current;
      
      // Create projectile
      const projectile = Matter.Bodies.circle(
        player.position.x + (facing * PLAYER_WIDTH * 0.6), 
        player.position.y, 
        6, 
        {
          density: 0.0001,
          frictionAir: 0.01,
          restitution: 0.5,
          render: { 
            fillStyle: '#00FF7A', 
            strokeStyle: 'rgba(255, 255, 255, 0.8)', 
            lineWidth: 2 
          },
          label: 'projectile',
        }
      );

      // Set projectile velocity
      Matter.Body.setVelocity(projectile, {
        x: facing * 15,
        y: 0,
      });

      // Add to world and track
      Matter.World.add(engine.world, projectile);
      projectilesRef.current.push(projectile);
    };

    // Player movement controller
    Matter.Events.on(engine, 'beforeUpdate', () => {
      if (!playerRef.current) return;

      const player = playerRef.current;

      // Fire projectile on K key press
      if (keysRef.current['KeyK']) {
        createProjectile();
        // Prevent rapid firing by clearing the key state
        keysRef.current['KeyK'] = false;
      }

      // Ground check: short downward ray.
      const bodies = Matter.Composite.allBodies(engine.world);
      const rayStart = player.position;
      const rayEnd = { x: player.position.x, y: player.position.y + PLAYER_HEIGHT * 0.35 + 10 };
      const rayHits = Matter.Query.ray(bodies, rayStart, rayEnd, 2);
      const grounded = rayHits.some((hit) => {
        const b = (hit as unknown as { body: Matter.Body }).body ?? (hit as unknown as { bodyA: Matter.Body }).bodyA;
        if (b === player) return false;
        if (playerHeadRef.current && b === playerHeadRef.current) return false;
        if (b.isSensor) return false;
        if (b.label === 'monster' || b.label === 'boundary') return false;
        return true;
      });
      playerGroundedRef.current = grounded;

      // Movement tuning (best-practice-ish): small horizontal forces + velocity clamp.
      const maxRunSpeed = 9.5;
      const maxAirSpeed = 10.5;
      const accelPerMass = grounded ? 0.0032 : 0.0038; // slightly more air control
      const brakePerMass = grounded ? 0.0046 : 0.0018;
      const maxSpeed = grounded ? maxRunSpeed : maxAirSpeed;

      const left = keysRef.current['ArrowLeft'] || keysRef.current['KeyA'];
      const right = keysRef.current['ArrowRight'] || keysRef.current['KeyD'];
      const axis = (right ? 1 : 0) + (left ? -1 : 0);

      // Track facing direction for sprite flip (last intentional movement direction).
      if (axis === 1) playerFacingRef.current = 1;
      if (axis === -1) playerFacingRef.current = -1;
      // If no input, keep last facing unless velocity strongly indicates a new direction.
      if (axis === 0) {
        if (player.velocity.x > 0.35) playerFacingRef.current = 1;
        if (player.velocity.x < -0.35) playerFacingRef.current = -1;
      }

      if (axis !== 0) {
        Matter.Body.applyForce(player, player.position, { x: axis * accelPerMass * player.mass, y: 0 });
      } else {
        const vx = player.velocity.x;
        if (Math.abs(vx) > 0.02) {
          Matter.Body.applyForce(player, player.position, { x: -vx * brakePerMass * player.mass, y: 0 });
        } else if (grounded) {
          Matter.Body.setVelocity(player, { x: 0, y: player.velocity.y });
        }
      }

      if (player.velocity.x > maxSpeed) {
        Matter.Body.setVelocity(player, { x: maxSpeed, y: player.velocity.y });
      } else if (player.velocity.x < -maxSpeed) {
        Matter.Body.setVelocity(player, { x: -maxSpeed, y: player.velocity.y });
      }

      // Jump: one-shot impulse on press (slider maps directly to this value).
      const jumpDown = keysRef.current['ArrowUp'] || keysRef.current['Space'] || keysRef.current['KeyW'];
      const jumpPressed = !!jumpDown && !jumpWasDownRef.current;
      jumpWasDownRef.current = !!jumpDown;

      if (jumpPressed && grounded) {
        Matter.Body.setVelocity(player, { x: player.velocity.x, y: -jumpStrengthRef.current });
      }
    });

    // Monster + moving platform AI controller
    Matter.Events.on(engine, 'beforeUpdate', () => {
      const player = playerRef.current;
      if (!player) return;

      const t = engine.timing.timestamp;
      const gravityAccel = engine.gravity.y * engine.gravity.scale;

      for (const monster of monstersRef.current) {
        const ai = monsterAIRef.current.get(monster.id);
        if (!ai) continue;

        if (ai.kind === 'patrol') {
          const half = ai.range / 2;
          if (monster.position.x < ai.originX - half) ai.dir = 1;
          if (monster.position.x > ai.originX + half) ai.dir = -1;
          Matter.Body.setVelocity(monster, { x: ai.speed * ai.dir, y: monster.velocity.y });
          continue;
        }

        if (ai.kind === 'flying') {
          // Cancel gravity so the flyer truly flies.
          Matter.Body.applyForce(monster, monster.position, { x: 0, y: -monster.mass * gravityAccel });

          const chaseRadius = ai.chaseRadius ?? 320;
          const dx = player.position.x - monster.position.x;
          const dy = player.position.y - monster.position.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 1 && dist < chaseRadius) {
            const maxV = ai.speed;
            const vx = (dx / dist) * maxV;
            const vy = (dy / dist) * maxV;
            Matter.Body.setVelocity(monster, { x: vx, y: vy });
          } else {
            // Hover on a small sine wave around origin (deterministic).
            const hoverAmp = ai.hoverAmp ?? 18;
            const hoverFreq = ai.hoverFreq ?? 0.002;
            const targetX = ai.originX + Math.sin(t * 0.001) * 70;
            const targetY = ai.originY + Math.sin(t * hoverFreq) * hoverAmp;

            const toX = targetX - monster.position.x;
            const toY = targetY - monster.position.y;
            const vx = clamp(toX * 0.06, -ai.speed, ai.speed);
            const vy = clamp(toY * 0.06, -ai.speed, ai.speed);
            Matter.Body.setVelocity(monster, { x: vx, y: vy });
          }
        }
      }

      // Moving platform patrol (always updates so it visibly moves)
      if (movingPlatformRef.current && movingPlatformAIRef.current) {
        const platform = movingPlatformRef.current;
        const ai = movingPlatformAIRef.current;
        const half = ai.range / 2;
        if (platform.position.x < ai.originX - half) ai.dir = 1;
        if (platform.position.x > ai.originX + half) ai.dir = -1;
        Matter.Body.setVelocity(platform, { x: ai.speed * ai.dir, y: 0 });
      }
    });

    // Collision detection
    Matter.Events.on(engine, 'collisionStart', (event) => {
      const pairs = event.pairs;
      
      pairs.forEach(pair => {
        // Check if collision is between projectile and monster
        const isProjectileA = pair.bodyA.label === 'projectile';
        const isProjectileB = pair.bodyB.label === 'projectile';
        const isMonsterA = pair.bodyA.label === 'monster';
        const isMonsterB = pair.bodyB.label === 'monster';
        
        if ((isProjectileA && isMonsterB) || (isProjectileB && isMonsterA)) {
          const projectile = isProjectileA ? pair.bodyA : pair.bodyB;
          const monster = isProjectileA ? pair.bodyB : pair.bodyA;
          
          // Remove both from world
          Matter.World.remove(engine.world, projectile);
          Matter.World.remove(engine.world, monster);
          
          // Remove from tracking arrays
          projectilesRef.current = projectilesRef.current.filter(p => p.id !== projectile.id);
          monstersRef.current = monstersRef.current.filter(m => m.id !== monster.id);
          monsterAIRef.current.delete(monster.id);
          monsterStyleSeedRef.current.delete(monster.id);
          
          console.log('[DEBUG] Projectile hit monster - both removed');
          return; // Skip further checks for this pair
        }
        
        // Check if collision involves player (torso or head) by checking ids
        const isPlayerTorso = pair.bodyA === torso || pair.bodyB === torso;
        const isPlayerHead = pair.bodyA === head || pair.bodyB === head;
        const isPlayerInvolved = isPlayerTorso || isPlayerHead;
        
        // Only handle collisions that involve the player
        if (isPlayerInvolved) {
          // Determine which body is the other object
          const otherBody = isPlayerTorso ? (pair.bodyA === torso ? pair.bodyB : pair.bodyA) : 
                          (pair.bodyA === head ? pair.bodyB : pair.bodyA);
                          
          console.log('[DEBUG] Player collision with:', otherBody.label);
          
          // Handle collisions
          if (otherBody.label === 'spike') {
            if (gameStateRef.current === 'playing') {
              console.log('[DEBUG] Spike collision - game over');
              setGameState('gameOver');
            }
          } else if (otherBody.label === 'monster') {
            if (gameStateRef.current === 'playing') {
              console.log('[DEBUG] Monster collision - game over');
              setGameState('gameOver');
            }
          } else if (otherBody.label === 'goal') {
            if (gameStateRef.current === 'playing') {
              console.log('[DEBUG] Goal collision - level completed');
              setGameState('won');
            }
          } else {
            console.log('[DEBUG] Ignoring collision with:', otherBody.label || 'unnamed');
          }
        }
      });
    });

    // Draw parallax behind the world (in screen space) + add world highlights.
    // We use afterRender with destination-over so the background sits behind all bodies.
    render.options.background = 'transparent';
    Matter.Events.on(render, 'afterRender', () => {
      const ctx = render.context;
      const vw = viewportWRef.current;
      const vh = viewportHRef.current;

      const drawKiloMan = (p: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        grounded: boolean;
        facing: 1 | -1;
        t: number;
        scale: number;
      }) => {
        // World-units; caller has already set a world->screen transform.
        const { x, y, vx, vy, grounded, facing, t, scale } = p;

        const speed = Math.abs(vx);
        const run01 = clamp(speed / 8.5, 0, 1);
        const swing = grounded ? Math.sin(t * 0.016 * (0.35 + run01 * 2.6)) : Math.sin(t * 0.012);
        const bob = grounded ? (Math.sin(t * 0.016 * (0.5 + run01 * 2.2)) * (1.2 + run01 * 2.6)) : 0;

        // Kilo Man dimensions (slightly larger than physics torso for a stronger silhouette)
        const bodyW = PLAYER_WIDTH * 0.9;
        const bodyH = PLAYER_HEIGHT * 0.62;
        const headR = PLAYER_WIDTH * 0.28;
        const legL = PLAYER_HEIGHT * 0.34;
        const armL = PLAYER_HEIGHT * 0.26;

        // Pose helpers
        const facingScale = facing;
        const legAngle = grounded ? swing * (0.75 * run01) : 0.1 * Math.sign(vx);
        const armAngle = grounded ? -swing * (0.85 * run01) : -0.18;
        const crouch = !grounded ? clamp((vy + 6) / 14, 0, 1) : 0;

        const outline = 2 / Math.max(scale, 1);
        const accent = '#FFD700';
        const ink = '#080808';

        ctx.save();
        ctx.translate(x, y + bob);
        ctx.scale(facingScale, 1);

        // Subtle drop shadow
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.ellipse(0, PLAYER_HEIGHT * 0.34, 18, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Legs (behind body)
        const hipY = bodyH * 0.15;
        const footY = hipY + legL;

        const drawLeg = (side: 1 | -1, a: number, shade: number) => {
          ctx.save();
          ctx.translate(side * (bodyW * 0.18), hipY + crouch * 6);
          ctx.rotate(a);

          ctx.lineWidth = outline;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = ink;

          ctx.globalAlpha = shade;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, legL * (0.85 - crouch * 0.25));
          ctx.stroke();

          // boot
          ctx.globalAlpha = 1;
          ctx.fillStyle = ink;
          ctx.fillRect(-6, footY - hipY - 6, 14, 8);

          // accent stripe
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = accent;
          ctx.lineWidth = outline;
          ctx.beginPath();
          ctx.moveTo(2, legL * 0.25);
          ctx.lineTo(2, legL * 0.55);
          ctx.stroke();

          ctx.restore();
        };

        // back leg slightly darker
        drawLeg(-1, legAngle * 0.65, 0.75);
        drawLeg(1, -legAngle, 1);

        // Arms (behind body)
        const shoulderY = -bodyH * 0.18;
        const drawArm = (side: 1 | -1, a: number, shade: number) => {
          ctx.save();
          ctx.translate(side * (bodyW * 0.44), shoulderY + crouch * 3);
          ctx.rotate(a);
          ctx.lineWidth = outline;
          ctx.lineCap = 'round';
          ctx.strokeStyle = ink;
          ctx.globalAlpha = shade;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, armL);
          ctx.stroke();

          // glove accent
          ctx.globalAlpha = 1;
          ctx.fillStyle = accent;
          ctx.fillRect(-4, armL - 6, 8, 6);
          ctx.restore();
        };

        drawArm(-1, armAngle * 0.7, 0.7);
        drawArm(1, -armAngle, 1);

        // Body (strong silhouette)
        const bodyTopY = -bodyH * 0.55;
        ctx.save();
        ctx.lineWidth = outline;
        ctx.fillStyle = ink;
        ctx.strokeStyle = 'rgba(255,215,0,0.85)';
        ctx.beginPath();
        // Suit torso with rounded corners
        const r = 8;
        const w = bodyW;
        const h = bodyH + crouch * 6;
        const x0 = -w / 2;
        const y0 = bodyTopY + crouch * 4;
        ctx.moveTo(x0 + r, y0);
        ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
        ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
        ctx.arcTo(x0, y0 + h, x0, y0, r);
        ctx.arcTo(x0, y0, x0 + w, y0, r);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.stroke();
        ctx.restore();

        // Chest accent / "K" stripe
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3.5 / Math.max(scale, 1);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-8, bodyTopY + 18);
        ctx.lineTo(10, bodyTopY + 30);
        ctx.lineTo(-8, bodyTopY + 42);
        ctx.stroke();
        ctx.restore();

        // Head + visor
        const headY = bodyTopY - headR * 0.45 + crouch * 2;
        ctx.save();
        ctx.fillStyle = ink;
        ctx.strokeStyle = 'rgba(255,215,0,0.75)';
        ctx.lineWidth = outline;
        ctx.beginPath();
        ctx.arc(0, headY, headR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // visor glow
        const visorPulse = 0.6 + 0.4 * Math.sin(t * 0.01);
        ctx.globalAlpha = 0.35 + visorPulse * 0.22;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.ellipse(headR * 0.18, headY - 2, headR * 0.62, headR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();

        // tiny mouth vent
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = 'rgba(255,215,0,0.8)';
        ctx.lineWidth = outline;
        ctx.beginPath();
        ctx.moveTo(-6, headY + headR * 0.45);
        ctx.lineTo(6, headY + headR * 0.45);
        ctx.stroke();

        ctx.restore();

        // Front outline pop
        ctx.save();
        ctx.globalAlpha = grounded ? 0.85 : 0.55;
        ctx.strokeStyle = 'rgba(255,215,0,0.55)';
        ctx.lineWidth = 6 / Math.max(scale, 1);
        ctx.shadowColor = 'rgba(255,215,0,0.25)';
        ctx.shadowBlur = 14 / Math.max(scale, 1);
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.2, bodyTopY + 8);
        ctx.lineTo(bodyW * 0.36, bodyTopY + 24);
        ctx.stroke();
        ctx.restore();

        ctx.restore();
      };

      const drawMonster = (m: Matter.Body, ai: MonsterAIState | undefined, t: number, scale: number) => {
        const x = m.position.x;
        const y = m.position.y;
        const vx = m.velocity.x;
        const vy = m.velocity.y;
        const speed = Math.hypot(vx, vy);
        const seed = monsterStyleSeedRef.current.get(m.id) ?? 12345;

        const outline = 2 / Math.max(scale, 1);
        const ink = '#080808';
        const acid = '#FFD700';

        const kind = ai?.kind;

        // Style 1: Crawler (squishy blob with blinking eye + velocity wobble)
        if (kind !== 'flying') {
          const wob = (0.12 + 0.14 * clamp(speed / 5, 0, 1)) * Math.sin(t * 0.01 + seed * 0.001);
          const squishX = 1.05 + wob;
          const squishY = 0.95 - wob;

          // Eye blink: mostly open, quick close.
          const blinkPhase = (t * 0.0012 + (seed % 100) * 0.03) % 1;
          const blink = blinkPhase > 0.92 ? (1 - (blinkPhase - 0.92) / 0.08) : 1;
          const eyeOpen = Math.pow(blink, 6);

          ctx.save();
          ctx.translate(x, y);
          ctx.scale(squishX, squishY);

          // Shadow
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.ellipse(0, 22, 18, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Blob body
          ctx.fillStyle = '#141414';
          ctx.strokeStyle = 'rgba(255,215,0,0.55)';
          ctx.lineWidth = outline;
          ctx.beginPath();
          ctx.moveTo(-18, 0);
          ctx.bezierCurveTo(-26, -18, -4, -26, 0, -18);
          ctx.bezierCurveTo(4, -30, 30, -18, 22, 2);
          ctx.bezierCurveTo(32, 22, 6, 30, -6, 22);
          ctx.bezierCurveTo(-20, 32, -34, 18, -18, 0);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.95;
          ctx.stroke();

          // Belly highlight
          ctx.save();
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = acid;
          ctx.beginPath();
          ctx.ellipse(6, 8, 12, 10, 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Eye + pupil
          ctx.save();
          ctx.translate(6, -6);
          ctx.scale(1, clamp(eyeOpen, 0.12, 1));
          ctx.fillStyle = acid;
          ctx.strokeStyle = ink;
          ctx.lineWidth = outline;
          ctx.beginPath();
          ctx.ellipse(0, 0, 8, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.arc(2, 1, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Tiny feet squiggles
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = acid;
          ctx.lineWidth = outline;
          ctx.beginPath();
          ctx.moveTo(-12, 16);
          ctx.lineTo(-6, 20);
          ctx.lineTo(0, 16);
          ctx.stroke();
          ctx.restore();

          ctx.restore();
          return;
        }

        // Style 2: Flyer (bat/drone with flapping wings + glow pulse)
        {
          const pathRoundRect = (x0: number, y0: number, w: number, h: number, r: number) => {
            const rr = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x0 + rr, y0);
            ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, rr);
            ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, rr);
            ctx.arcTo(x0, y0 + h, x0, y0, rr);
            ctx.arcTo(x0, y0, x0 + w, y0, rr);
            ctx.closePath();
          };

          const flap = Math.sin(t * 0.02 + seed * 0.002);
          const flap01 = (flap + 1) / 2;
          const wingA = 0.25 + flap * 0.55;
          const pulse = 0.55 + 0.45 * Math.sin(t * 0.012 + seed * 0.01);
          const face = vx >= 0 ? 1 : -1;

          ctx.save();
          ctx.translate(x, y);
          ctx.scale(face, 1);

          // Outer glow
          ctx.save();
          ctx.globalAlpha = 0.18 + 0.18 * pulse;
          ctx.fillStyle = acid;
          ctx.beginPath();
          ctx.ellipse(0, 0, 38, 24, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Wings
          const drawWing = (side: 1 | -1) => {
            ctx.save();
            ctx.rotate(side * wingA);
            ctx.translate(side * 18, 0);
            ctx.fillStyle = ink;
            ctx.strokeStyle = 'rgba(255,215,0,0.6)';
            ctx.lineWidth = outline;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(side * 18, -18 - 10 * flap01, side * 34, 0);
            ctx.quadraticCurveTo(side * 18, 12 + 8 * flap01, 0, 6);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.stroke();
            ctx.restore();
          };

          drawWing(-1);
          drawWing(1);

          // Body core
          ctx.save();
          ctx.fillStyle = ink;
          ctx.strokeStyle = 'rgba(255,215,0,0.75)';
          ctx.lineWidth = outline;
          pathRoundRect(-14, -10, 28, 20, 8);
          ctx.fill();
          ctx.globalAlpha = 0.95;
          ctx.stroke();

          // Eye / sensor glow
          ctx.globalAlpha = 0.35 + 0.35 * pulse;
          ctx.fillStyle = acid;
          ctx.beginPath();
          ctx.ellipse(6, -1, 6, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Rotor/antenna tick
          ctx.save();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = acid;
          ctx.lineWidth = outline;
          ctx.beginPath();
          ctx.moveTo(0, -12);
          ctx.lineTo(0, -20);
          ctx.stroke();
          ctx.restore();

          ctx.restore();
          return;
        }
      };

      // 1) World-space cosmetic highlights (on top of bodies)
      const bounds = render.bounds;
      const scaleX = vw / (bounds.max.x - bounds.min.x);
      const scaleY = vh / (bounds.max.y - bounds.min.y);

      ctx.save();
      ctx.setTransform(scaleX, 0, 0, scaleY, -bounds.min.x * scaleX, -bounds.min.y * scaleY);

      const bodies = Matter.Composite.allBodies(engine.world);
      for (const b of bodies) {
        if (b.isSensor) continue;

        // Subtle top-edge highlight for platforms / ground / walls
        if (b.label === 'platform' || b.label === 'ground' || b.label === 'wall' || b.label === 'movingPlatform') {
          const bb = b.bounds;
          const topY = bb.min.y;
          const w = bb.max.x - bb.min.x;

          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = 'rgba(255, 246, 180, 0.95)';
          ctx.lineWidth = 2 / Math.max(scaleX, 1);
          ctx.beginPath();
          ctx.moveTo(bb.min.x + 6, topY + 2);
          ctx.lineTo(bb.min.x + w - 6, topY + 2);
          ctx.stroke();

          // Soft shadow under platforms
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = '#000000';
          ctx.fillRect(bb.min.x + 2, bb.max.y - 2, w - 4, 10);
          ctx.restore();
        }

        // Gate glow
        if (b.label === 'gate') {
          const bb = b.bounds;
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
          ctx.lineWidth = 6 / Math.max(scaleX, 1);
          ctx.shadowColor = 'rgba(255, 215, 0, 0.55)';
          ctx.shadowBlur = 18 / Math.max(scaleX, 1);
          ctx.strokeRect(bb.min.x - 3, bb.min.y - 3, bb.max.x - bb.min.x + 6, bb.max.y - bb.min.y + 6);
          ctx.restore();
        }
      }

      // 1b) Custom entity rendering (player + monsters) in world space
      const t = engine.timing.timestamp;
      const player = playerRef.current;
      if (player) {
        drawKiloMan({
          x: player.position.x,
          y: player.position.y,
          vx: player.velocity.x,
          vy: player.velocity.y,
          grounded: playerGroundedRef.current,
          facing: playerFacingRef.current,
          t,
          scale: Math.max(scaleX, scaleY),
        });
      }

      for (const m of monstersRef.current) {
        drawMonster(m, monsterAIRef.current.get(m.id), t, Math.max(scaleX, scaleY));
      }

      // Draw projectiles
      for (const p of projectilesRef.current) {
        ctx.save();
        ctx.translate(p.position.x, p.position.y);
        
        // Projectile glow
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
        glow.addColorStop(0, 'rgba(0, 255, 122, 0.8)');
        glow.addColorStop(1, 'rgba(0, 255, 122, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(-8, -8, 16, 16);
        
        // Projectile core
        ctx.fillStyle = '#00FF7A';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2 / Math.max(scaleX, 1);
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
      }

      ctx.restore();

      // 2) Parallax background in screen space (behind everything)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-over';
      const camX = cameraXRef.current;
      parallaxLayersRef.current.forEach((layer) => {
        layer.draw(ctx, camX * layer.speed);
      });
      ctx.restore();
    });

    // Track camera movement based on player position and cleanup projectiles
    Matter.Events.on(engine, 'afterUpdate', () => {
      // Cleanup projectiles that go out of bounds
      const currentTime = Date.now();
      const bounds = {
        left: 0,
        right: LEVEL_LENGTH,
        top: -200,
        bottom: WORLD_HEIGHT + 200
      };
      
      projectilesRef.current = projectilesRef.current.filter(p => {
        // Check if projectile is out of bounds
        const isOutOfBounds = 
          p.position.x < bounds.left || 
          p.position.x > bounds.right || 
          p.position.y < bounds.top || 
          p.position.y > bounds.bottom;
          
        if (isOutOfBounds) {
          Matter.World.remove(engine.world, p);
        }
        
        return !isOutOfBounds;
      });

      if (playerRef.current) {
        // Player fall detection
        if (playerRef.current.position.y > WORLD_HEIGHT + 260 && gameStateRef.current === 'playing') {
          setGameState('gameOver');
        }

        // Smooth camera follow with boundary constraints
        const vw = viewportWRef.current;
        const vh = viewportHRef.current;
        const targetX = playerRef.current.position.x - vw / 2;
        const levelStartX = 0;
        const levelEndX = LEVEL_LENGTH;

        // Clamp camera to level boundaries
        const clampedTargetX = clamp(targetX, levelStartX, Math.max(levelStartX, levelEndX - vw));
        cameraXRef.current += (clampedTargetX - cameraXRef.current) * 0.14;

        // Apply camera to Matter renderer bounds for true scrolling
        const camX = cameraXRef.current;
        render.bounds.min.x = camX;
        render.bounds.max.x = camX + vw;

        // Keep ground anchored visually at bottom. World is built at WORLD_HEIGHT.
        render.bounds.max.y = WORLD_HEIGHT;
        render.bounds.min.y = WORLD_HEIGHT - vh;
      }
    });

    // Resize handling (fullscreen)
    const handleResize = () => {
      if (!renderRef.current) return;
      if (typeof width === 'number' && typeof height === 'number') return;

      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      viewportWRef.current = nextW;
      viewportHRef.current = nextH;
      setViewport({ w: nextW, h: nextH });
      Matter.Render.setSize(renderRef.current, nextW, nextH);
      parallaxLayersRef.current = createParallaxLayers(nextW, nextH);
    };

    window.addEventListener('resize', handleResize);

    // Start engine and renderer
    Matter.Runner.run(runner, engine);
    Matter.Render.run(render);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('touchmove', handleTouchMoveOrWheel);
      window.removeEventListener('wheel', handleTouchMoveOrWheel);
      window.removeEventListener('resize', handleResize);
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      // React owns the canvas element.
      render.context.clearRect(0, 0, viewportWRef.current, viewportHRef.current);
    };
  }, [width, height]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      className="relative w-full h-full outline-none"
      onPointerDown={() => containerRef.current?.focus()}
      onTouchStart={() => containerRef.current?.focus()}
    >
      <canvas
        ref={canvasRef}
        width={viewport.w}
        height={viewport.h}
        className="block w-full h-full bg-black"
      />
      
      {/* Game Status Overlay */}
      {gameState === 'gameOver' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
          <h2 className="text-4xl font-bold text-yellow-400 mb-4">GAME OVER</h2>
          <p className="text-yellow-300 text-lg mb-6">Score: {score}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-yellow-400 text-black font-bold rounded-lg hover:bg-yellow-300 transition-colors"
          >
            Play Again
          </button>
        </div>
      )}
      
      {gameState === 'won' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
          <h2 className="text-4xl font-bold text-yellow-400 mb-4">LEVEL COMPLETED!</h2>
          <p className="text-yellow-300 text-lg mb-6">Score: {score}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-yellow-400 text-black font-bold rounded-lg hover:bg-yellow-300 transition-colors"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};

export default GameCanvas;
