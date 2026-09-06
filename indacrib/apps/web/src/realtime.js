import { supabase } from './supabaseClient.js';

// One realtime channel per room: postgres_changes for persisted state,
// broadcast for ephemeral events (turn pings, countdowns, etc).
export function subscribeToRoom(roomCode, { onGameUpdate, onBroadcast }) {
  const channel = supabase
    .channel(`room-${roomCode}`, { config: { broadcast: { self: false } } })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `room_code=eq.${roomCode}` },
      (payload) => onGameUpdate?.(payload.new)
    )
    .on('broadcast', { event: 'turn-event' }, (payload) => onBroadcast?.(payload.payload))
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export function broadcastTurnEvent(roomCode, payload) {
  return supabase.channel(`room-${roomCode}`).send({
    type: 'broadcast',
    event: 'turn-event',
    payload,
  });
}
