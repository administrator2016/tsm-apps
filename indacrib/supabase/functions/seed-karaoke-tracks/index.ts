// Admin/one-off function: populates karaoke_tracks with a genre tag, using
// Spotify's documented `genre:"X"` search field filter (Search for Item —
// developer.spotify.com/documentation/web-api/reference/search — "The genre
// filter can be used while searching artists and tracks"). Run manually
// (or on a cron), not called during gameplay — mirrors seed-content's shape.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fixed, well-established Spotify genre tags — not derived from any live
// lookup, so results are stable and won't drift the way curated playlist
// IDs would.
const GENRES = [
  'Pop', 'Rock', 'Hip-Hop', 'Country', 'R&B',
  'Electronic', 'Latin', 'Jazz', 'Reggae', 'Metal', 'Folk',
];

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: existingTracks } = await supabase.from('karaoke_tracks').select('spotify_track_id');
  const alreadySeeded = new Set((existingTracks ?? []).map((row) => row.spotify_track_id));

  const spotifyToken = await getSpotifyToken();

  const results: Record<string, { fetched: number; inserted: number; skipped: number }> = {};

  for (const genre of GENRES) {
    console.log(`Searching Spotify for genre: ${genre}`);

    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(`genre:"${genre}"`)}&type=track&market=US&limit=30`,
      { headers: { Authorization: `Bearer ${spotifyToken}` } }
    );
    const searchData = await searchRes.json();

    if (!searchRes.ok || !searchData.tracks?.items) {
      console.error(`Spotify search failed for genre "${genre}":`, JSON.stringify(searchData));
      results[genre] = { fetched: 0, inserted: 0, skipped: 0 };
      continue;
    }

    const items = searchData.tracks.items;
    let inserted = 0;
    let skipped = 0;

    for (const track of items) {
      if (!track?.id || alreadySeeded.has(track.id)) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from('karaoke_tracks').insert({
        spotify_track_id: track.id,
        title: track.name,
        artist: track.artists?.[0]?.name ?? null,
        genre,
      });

      if (error) {
        console.error(`Karaoke track insert failed for "${track.name}":`, JSON.stringify(error));
      } else {
        alreadySeeded.add(track.id);
        inserted++;
      }
    }

    results[genre] = { fetched: items.length, inserted, skipped };
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function getSpotifyToken() {
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')!;
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return data.access_token;
}
