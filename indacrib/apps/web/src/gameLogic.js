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
