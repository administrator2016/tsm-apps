import { fetchCatchPhrase, fetchKaraokeTrack, fetchCharadesWord } from './apiService.js';

// Starts the round for whichever mode the game is in; returns the prompt to display.
export async function startRound(gameMode) {
  switch (gameMode) {
    case 'catchphrase':
      return fetchCatchPhrase();
    case 'karaoke':
      return fetchKaraokeTrack();
    case 'charades':
      return fetchCharadesWord();
    default:
      throw new Error(`Unknown game mode: ${gameMode}`);
  }
}

// 4-letter room codes (e.g. "FZQK") — no I/O/1/0, avoids confusion when read aloud or typed on a phone.
export function generateRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}