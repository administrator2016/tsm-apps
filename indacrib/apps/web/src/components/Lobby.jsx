import { useEffect, useState } from 'react';
import { subscribeToRoster, subscribeToGameStatus, startGame } from '../realtime.js';

export default function Lobby({ gameId, roomCode, isHost, onStart }) {
  const [players, setPlayers] = useState([]);

  useEffect(() => subscribeToRoster(gameId, setPlayers), [gameId]);
  // Every player (host included) transitions off this subscription, so
  // non-host players move into the game the moment the host starts it
  // instead of being stuck on the lobby screen forever.
  useEffect(() => subscribeToGameStatus(gameId, onStart), [gameId, onStart]);

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <p className="idc-room-label">Room code</p>
        <p className="idc-room-code">{roomCode}</p>
        <p className="idc-waiting">
          <span className="idc-pulse-dot" />
          {players.length === 1 ? 'Waiting for players to join...' : `${players.length} players in the room`}
        </p>

        {players.length > 0 && (
          <ul className="idc-player-list">
            {players.map((p) => (
              <li key={p.id} className="idc-player-chip">
                {p.display_name}
                {p.is_host && <span className="idc-badge idc-badge-host">Host</span>}
              </li>
            ))}
          </ul>
        )}

        {isHost ? (
          <button className="idc-btn idc-btn-primary" onClick={() => startGame(gameId)} style={{ marginTop: 16 }}>
            Start Game
          </button>
        ) : (
          <p className="idc-waiting" style={{ marginTop: 16, marginBottom: 0 }}>
            Waiting for the host to start...
          </p>
        )}
      </div>
    </div>
  );
}
