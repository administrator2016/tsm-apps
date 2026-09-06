import { useEffect, useState } from 'react';
import { subscribeToRoom } from '../realtime.js';
import { startRound } from '../gameLogic.js';
import { speakPhrase } from '../voice.js';

export default function GameBoard({ gameId, roomCode }) {
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToRoom(roomCode, {
      onGameUpdate: (game) => {
        // React to turn/status changes pushed from the database
        console.log('Game updated:', game);
      },
      onBroadcast: (payload) => console.log('Turn event:', payload),
    });
    return unsubscribe;
  }, [roomCode]);

  async function handleNewPrompt(gameMode) {
    const result = await startRound(gameMode);
    setPrompt(result);
    if (result.phrase) speakPhrase(result.phrase);
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h1 className="idc-wordmark">InDaCrib</h1>
        <p className="idc-subtitle">Room {roomCode}</p>

        <div id="game-display" className={prompt ? 'idc-prompt' : 'idc-prompt idc-prompt-empty'}>
          {prompt ? JSON.stringify(prompt) : 'Pick a game mode to start the round'}
        </div>

        <button className="idc-btn idc-btn-mode" onClick={() => handleNewPrompt('catchphrase')}>
          New CatchPhrase
        </button>
        <button className="idc-btn idc-btn-mode" onClick={() => handleNewPrompt('karaoke')}>
          New Karaoke Track
        </button>
        <button className="idc-btn idc-btn-mode" onClick={() => handleNewPrompt('charades')}>
          New Charades Word
        </button>
      </div>
    </div>
  );
}
