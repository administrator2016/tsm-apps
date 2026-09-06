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

    onJoined({ gameId: game.id, roomCode: trimmedCode, playerId: player.id });
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

    onJoined({ gameId: game.id, roomCode: game.room_code, playerId: player.id });
  }

  return (
    <div>
      <h1>Join InDaCrib</h1>
      <input
        placeholder="Room code"
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value)}
        maxLength={4}
        disabled={loading}
      />
      <input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={loading}
      />
      <button onClick={handleJoin} disabled={loading}>
        {loading ? 'Please wait…' : 'Join'}
      </button>
      <p>— or —</p>
      <button onClick={handleCreate} disabled={loading}>
        {loading ? 'Please wait…' : 'Start a new game'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}