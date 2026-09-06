// Shared Supabase client — imported by every page in the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dhktthxsalqtsiphiaaq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OAunTuq114k38gdFVfNFrg_gZrdYY2m';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Small helpers used across pages, so game/player identity survives refreshes.
export function saveSession(gameId, playerId, isHost) {
  localStorage.setItem('game_id', gameId);
  localStorage.setItem('player_id', playerId);
  localStorage.setItem('is_host', isHost ? '1' : '0');
}

export function getSession() {
  return {
    gameId: localStorage.getItem('game_id'),
    playerId: localStorage.getItem('player_id'),
    isHost: localStorage.getItem('is_host') === '1',
  };
}

export function clearSession() {
  localStorage.removeItem('game_id');
  localStorage.removeItem('player_id');
  localStorage.removeItem('is_host');
}

// 4-letter room codes (e.g. "FZQK") — easy to read aloud/type on a phone.
export function generateRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoids confusion with 1/0
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}
