import { useEffect, useState } from 'react';
import { subscribeToRoom } from '../realtime.js';
import { fetchTopics } from '../apiService.js';
import CatchPhraseGame from './CatchPhraseGame.jsx';
import KaraokeGame from './KaraokeGame.jsx';
import CharadesGame from './CharadesGame.jsx';

export default function GameBoard({ gameId, roomCode }) {
  const [mode, setMode] = useState(null);
  const [topics, setTopics] = useState({ catchphrase: [], karaoke: [], charades: [] });

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

  useEffect(() => {
    fetchTopics().then(setTopics);
  }, []);

  if (mode === 'catchphrase') {
    return <CatchPhraseGame topics={topics.catchphrase} onBack={() => setMode(null)} />;
  }
  if (mode === 'karaoke') {
    return <KaraokeGame topics={topics.karaoke} onBack={() => setMode(null)} />;
  }
  if (mode === 'charades') {
    return <CharadesGame topics={topics.charades} onBack={() => setMode(null)} />;
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h1 className="idc-wordmark">InDaCrib</h1>
        <p className="idc-subtitle">Room {roomCode} — pick a game</p>

        <button className="idc-btn idc-btn-mode" onClick={() => setMode('catchphrase')}>
          CatchPhrase
        </button>
        <button className="idc-btn idc-btn-mode" onClick={() => setMode('karaoke')}>
          Karaoke
        </button>
        <button className="idc-btn idc-btn-mode" onClick={() => setMode('charades')}>
          Charades
        </button>
      </div>
    </div>
  );
}
