'use client';

import { useState } from 'react';
import GameCanvas from '@/components/GameCanvas';

const GamePage: React.FC = () => {
  // Jump is a direct impulse (upward velocity) consumed by Matter on the next jump.
  // Range is tuned so low clears a small gap and high clears ~2–3 tiles.
  const [jumpStrength, setJumpStrength] = useState<number>(18);

  return (
    <div className="game-fullscreen">
      {/* Fullscreen canvas */}
      <GameCanvas jumpStrength={jumpStrength} />

      {/* UI overlay */}
      <div className="game-ui">
        <header className="mb-4">
          <h1 className="text-3xl md:text-4xl font-bold text-yellow-400 leading-none">KILO MAN</h1>
          <p className="text-yellow-300 text-sm md:text-base">Arrow keys / A-D to move, Space/W to jump</p>
        </header>

        <div className="bg-black/60 backdrop-blur-sm rounded-xl shadow-lg p-4 border border-yellow-400/70">
          <label className="block text-yellow-300 font-semibold mb-2">
            Jump: <span className="text-yellow-400">{jumpStrength.toFixed(1)}</span>
          </label>
          <input
            type="range"
            min={10}
            max={18}
            step={0.5}
            value={jumpStrength}
            onChange={(e) => setJumpStrength(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-yellow-400"
          />
          <div className="flex justify-between text-xs text-yellow-300/90 mt-1">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GamePage;
