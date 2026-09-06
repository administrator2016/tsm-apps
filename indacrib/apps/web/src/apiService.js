import { supabase } from './supabaseClient.js';

// Wraps calls to Supabase Edge Functions (replaces the old Lambda-backed apiService.js)

export async function fetchCatchPhrase() {
  const { data, error } = await supabase.functions.invoke('get-catchphrase');
  if (error) {
    console.error('Error fetching catchphrase:', error);
    return { phrase: 'Error fetching data' };
  }
  return data; // { phrase, source }
}

export async function fetchKaraokeTrack() {
  const { data, error } = await supabase.functions.invoke('get-karaoke-track');
  if (error) {
    console.error('Error fetching karaoke track:', error);
    return null;
  }
  return data; // { spotify_track_id, title, artist, preview_url }
}

export async function fetchCharadesWord(category) {
  const { data, error } = await supabase.functions.invoke('get-charades-word', {
    body: { category },
  });
  if (error) {
    console.error('Error fetching charades word:', error);
    return { word: 'Error fetching data' };
  }
  return data; // { word, category }
}
