import { useEffect, useState } from 'react';
import { subscribeToRoom, subscribeToRoster } from '../realtime.js';
import { fetchTopics } from '../apiService.js';
import CatchPhraseGame from './CatchPhraseGame.jsx';
import KaraokeGame from './KaraokeGame.jsx';
import CharadesGame from './CharadesGame.jsx';
import TurnScorePanel from './TurnScorePanel.jsx';
import ReactionBar from './ReactionBar.jsx';

export default function GameBoard({ gameId, roomCode, playerId, isHost }) {
  const [mode, setMode] = useState(null);
  const [topics, setTopics] = useState({ catchphrase: [], karaoke: [], charades: [] });
  const [players, setPlayers] = useState([]);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [incomingReaction, setIncomingReaction] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToRoom(roomCode, {
      onGameUpdate: (game) => setCurrentPlayerId(game.current_player_id),
      onBroadcast: (payload) => {
        if (payload?.type === 'next-turn') setCurrentPlayerId(payload.playerId);
      },
      onReaction: (payload) => setIncomingReaction(payload),
    });
    return unsubscribe;
  }, [roomCode]);

  useEffect(() => subscribeToRoster(gameId, setPlayers), [gameId]);

  useEffect(() => {
    fetchTopics().then(setTopics);
  }, []);

  const turnScorePanel = (
    <TurnScorePanel
      gameId={gameId}
      roomCode={roomCode}
      players={players}
      currentPlayerId={currentPlayerId}
      isHost={isHost}
    />
  );

  // Reactions float over every screen in the game (menu + all three
  // mini-games), so it's rendered once here rather than threaded through
  // each mode like turnScorePanel is — it doesn't need per-mode props.
  const reactionBar = <ReactionBar roomCode={roomCode} incoming={incomingReaction} />;

  if (mode === 'catchphrase') {
    return (
      <>
        <CatchPhraseGame topics={topics.catchphrase} onBack={() => setMode(null)} turnScorePanel={turnScorePanel} />
        {reactionBar}
      </>
    );
  }
  if (mode === 'karaoke') {
    return (
      <>
        <KaraokeGame topics={topics.karaoke} onBack={() => setMode(null)} turnScorePanel={turnScorePanel} />
        {reactionBar}
      </>
    );
  }
  if (mode === 'charades') {
    return (
      <>
        <CharadesGame topics={topics.charades} onBack={() => setMode(null)} turnScorePanel={turnScorePanel} />
        {reactionBar}
      </>
    );
  }

  return (
    <>
      <div className="idc-canvas">
        <div className="idc-card">
          <h1 className="idc-wordmark">InDaCrib</h1>
          <p className="idc-subtitle">Room {roomCode} — pick a game</p>

          {turnScorePanel}

          <button className="idc-btn idc-btn-mode" onClick={() => setMode('catchphrase')} style={{ marginTop: 16 }}>
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
      {reactionBar}
    </>
  );
}
