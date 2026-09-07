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

// Marks the room "active" so every player's Lobby — not just the host who
// clicked the button — moves on together (see subscribeToGameStatus below).
export function startGame(gameId) {
  return supabase.from('games').update({ status: 'active' }).eq('id', gameId);
}

// Fires `onActive` once the room's status flips to "active", including on
// initial load in case it's already active (e.g. a late joiner).
export function subscribeToGameStatus(gameId, onActive) {
  let cancelled = false;

  supabase.from('games').select('status').eq('id', gameId).maybeSingle().then(({ data }) => {
    if (!cancelled && data?.status === 'active') onActive();
  });

  const channel = supabase
    .channel(`game-status-${gameId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        if (payload.new?.status === 'active') onActive();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

// Hands the turn to a specific player. Persisted on `games` (not just
// broadcast) so anyone who refreshes or joins mid-round still sees whose
// turn it is, via the postgres_changes subscription above.
export function advanceTurn(gameId, playerId) {
  return supabase.from('games').update({ current_player_id: playerId }).eq('id', gameId);
}

// Atomic +delta via the increment_score() RPC — see migration 0005 for why
// this isn't a plain client-side read-then-write update.
export function awardPoint(gameId, playerId, delta = 1) {
  return supabase.rpc('increment_score', { p_game_id: gameId, p_player_id: playerId, p_delta: delta });
}

// One-time fetch of a room's players + scores, for initial render before
// the realtime subscription below starts pushing updates.
export async function fetchPlayersWithScores(gameId) {
  const [{ data: players, error: playersError }, { data: scores, error: scoresError }] = await Promise.all([
    supabase.from('players').select('*').eq('game_id', gameId).order('joined_at'),
    supabase.from('scores').select('player_id, points').eq('game_id', gameId),
  ]);
  if (playersError) console.error('Error fetching players:', playersError);
  if (scoresError) console.error('Error fetching scores:', scoresError);

  const pointsByPlayer = new Map((scores ?? []).map((s) => [s.player_id, s.points]));
  return (players ?? []).map((p) => ({ ...p, points: pointsByPlayer.get(p.id) ?? 0 }));
}

// Live players + scores for a room: fires `onChange` with the full,
// re-sorted roster whenever a player joins or a score changes.
export function subscribeToRoster(gameId, onChange) {
  let cancelled = false;

  const refresh = async () => {
    const roster = await fetchPlayersWithScores(gameId);
    if (!cancelled) onChange(roster);
  };

  refresh();

  const channel = supabase
    .channel(`roster-${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `game_id=eq.${gameId}` }, refresh)
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}
