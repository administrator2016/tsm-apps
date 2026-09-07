import { useState } from 'react';
import { supabase } from '../supabaseClient.js';
import { generateRoomCode } from '../gameLogic.js';

// Guest lands here after scanning the QR code (URL contains ?code=ROOMCODE),
// or can start a brand-new game right from this screen.
export default function JoinScreen({ onJoined }) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(
    new URLSearchParams(window.location.search).get('code') || ''
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    setError('');
    const trimmedName = name.trim();
    const trimmedCode = roomCode.trim().toUpperCase();

    if (!trimmedName || !trimmedCode) {
      setError('Enter a room code and your name');
      return;
    }

    setLoading(true);

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id')
      .eq('room_code', trimmedCode)
      .maybeSingle();

    if (gameError || !game) {
      setError("That room code doesn't exist");
      setLoading(false);
      return;
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({ game_id: game.id, display_name: trimmedName, is_host: false })
      .select()
      .single();

    if (playerError) {
      setError('Could not join — try again');
      console.error(playerError);
      setLoading(false);
      return;
    }

    onJoined({ gameId: game.id, roomCode: trimmedCode, playerId: player.id, isHost: false });
  }

  async function handleCreate() {
    setError('');
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError('Enter your name first');
      return;
    }

    setLoading(true);

    // Retry a few times in case of a rare room_code collision (unique constraint).
    let game = null;
    for (let attempt = 0; attempt < 5 && !game; attempt++) {
      const candidateCode = generateRoomCode();
      const { data, error: insertError } = await supabase
        .from('games')
        .insert({ room_code: candidateCode, status: 'lobby' })
        .select()
        .single();

      if (data) {
        game = data;
      } else if (insertError && insertError.code !== '23505') {
        console.error(insertError);
        break;
      }
    }

    if (!game) {
      setError('Could not create a game — try again');
      setLoading(false);
      return;
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({ game_id: game.id, display_name: trimmedName, is_host: true })
      .select()
      .single();

    if (playerError) {
      setError('Could not create a game — try again');
      console.error(playerError);
      setLoading(false);
      return;
    }

    onJoined({ gameId: game.id, roomCode: game.room_code, playerId: player.id, isHost: true });
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h1 className="idc-wordmark">InDaCrib</h1>
        <p className="idc-subtitle">Join a room or start your own game</p>

        <div className="idc-field">
          <label htmlFor="idc-room-code">Room code</label>
          <input
            id="idc-room-code"
            className="idc-input"
            placeholder="ABCD"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            maxLength={4}
            disabled={loading}
          />
        </div>

        <div className="idc-field">
          <label htmlFor="idc-name">Your name</label>
          <input
            id="idc-name"
            className="idc-input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
          />
        </div>

        <button className="idc-btn idc-btn-primary" onClick={handleJoin} disabled={loading}>
          {loading ? 'Please wait…' : 'Join'}
        </button>

        <div className="idc-divider">or</div>

        <button className="idc-btn idc-btn-secondary" onClick={handleCreate} disabled={loading}>
          {loading ? 'Please wait…' : 'Start a new game'}
        </button>

        {error && <p className="idc-error">{error}</p>}
      </div>
    </div>
  );
}