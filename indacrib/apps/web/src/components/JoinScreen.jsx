import { useState } from 'react';
import { supabase } from '../supabaseClient.js';

// Guest lands here after scanning the QR code (URL contains ?code=ROOMCODE)
export default function JoinScreen({ onJoined }) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(
    new URLSearchParams(window.location.search).get('code') || ''
  );

  async function handleJoin() {
    // Anonymous sign-in — no password, no signup form
    const { data: authData } = await supabase.auth.signInAnonymously();

    const { data: game } = await supabase
      .from('games')
      .select('id')
      .eq('room_code', roomCode)
      .single();

    await supabase.from('players').insert({
      game_id: game.id,
      display_name: name,
    });

    onJoined({ gameId: game.id, roomCode });
  }

  return (
    <div>
      <h1>Join InDaCrib</h1>
      <input placeholder="Room code" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} />
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={handleJoin}>Join</button>
    </div>
  );
}
