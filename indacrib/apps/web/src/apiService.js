import { supabase } from './supabaseClient.js';

// Wraps calls to Supabase Edge Functions (replaces the old Lambda-backed apiService.js)

export async function fetchCatchPhrase(genre) {
  const { data, error } = await supabase.functions.invoke('get-catchphrase', {
    body: { genre },
  });
  if (error) {
    console.error('Error fetching catchphrase:', error);
    return { phrase: 'Error fetching data' };
  }
  return data; // { phrase, source, genre }
}

export async function fetchKaraokeTrack(genre, excludeArtists) {
  const { data, error } = await supabase.functions.invoke('get-karaoke-track', {
    body: { genre, excludeArtists },
  });
  if (error) {
    console.error('Error fetching karaoke track:', error);
    return null;
  }
  return data; // { itunes_track_id, title, artist, preview_url, genre }
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

export async function fetchTopics() {
  const { data, error } = await supabase.functions.invoke('get-topics');
  if (error) {
    console.error('Error fetching topics:', error);
    return { catchphrase: [], karaoke: [], charades: [] };
  }
  return data; // { catchphrase: string[], karaoke: string[], charades: string[] }
}
