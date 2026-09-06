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
    <div>
      <h2>Game in progress</h2>
      <div id="game-display">{JSON.stringify(prompt)}</div>
      <button onClick={() => handleNewPrompt('catchphrase')}>New CatchPhrase</button>
      <button onClick={() => handleNewPrompt('karaoke')}>New Karaoke Track</button>
      <button onClick={() => handleNewPrompt('charades')}>New Charades Word</button>
    </div>
  );
}
