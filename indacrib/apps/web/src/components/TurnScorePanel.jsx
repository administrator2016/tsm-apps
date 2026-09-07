import { advanceTurn, awardPoint, broadcastTurnEvent } from '../realtime.js';
import VoiceMicToggle from './VoiceMicToggle.jsx';

// Shared across the mode-select screen and all three mini-games — this is
// the "wire the dead onGameUpdate/onBroadcast scaffolding to something
// real" piece: whoever's turn it is, and everyone's live score, in one
// place so every game gets turn-taking + scoring for free.
export default function TurnScorePanel({ gameId, roomCode, players, currentPlayerId, isHost }) {
  if (!players.length) return null;

  const sorted = [...players].sort((a, b) => b.points - a.points);
  const currentPlayer = players.find((p) => p.id === currentPlayerId);

  function handleNextTurn() {
    const idx = players.findIndex((p) => p.id === currentPlayerId);
    const next = players[(idx + 1) % players.length] ?? players[0];
    advanceTurn(gameId, next.id);
    broadcastTurnEvent(roomCode, { type: 'next-turn', playerId: next.id });
  }

  return (
    <div className="idc-turn-score">
      <div className="idc-turn-bar">
        <span>
          {currentPlayer ? (
            <>
              <span className="idc-pulse-dot" />
              <strong>{currentPlayer.display_name}</strong>'s turn
            </>
          ) : (
            'Waiting to start a turn'
          )}
        </span>
        {isHost && (
          <div className="idc-turn-actions">
            <button className="idc-btn idc-btn-secondary idc-btn-inline" onClick={handleNextTurn}>
              Next player
            </button>
            <VoiceMicToggle
              triggers={['next player', 'next turn']}
              onCommand={handleNextTurn}
              label="Hands-free next player"
            />
          </div>
        )}
      </div>

      <ul className="idc-scoreboard">
        {sorted.map((p) => (
          <li key={p.id} className={p.id === currentPlayerId ? 'idc-score-row idc-score-row-active' : 'idc-score-row'}>
            <span className="idc-score-name">{p.display_name}</span>
            <span className="idc-score-points">{p.points}</span>
            <button
              className="idc-score-award"
              title={`Give ${p.display_name} a point`}
              onClick={() => awardPoint(gameId, p.id, 1)}
            >
              +1
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
