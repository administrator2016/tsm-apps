// Admin/one-off function: populates karaoke_tracks with a genre tag, using
// Spotify's documented `genre:"X"` search field filter (Search for Item —
// developer.spotify.com/documentation/web-api/reference/search — "The genre
// filter can be used while searching artists and tracks"). Run manually
// (or on a cron), not called during gameplay — mirrors seed-content's shape.
//
// Every external fetch is wrapped so a network failure returns a structured
// JSON error instead of an uncaught exception (which the edge runtime turns
// into an opaque plain-text "Internal Server Error" with no detail).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GENRES = [
  'Pop', 'Rock', 'Hip-Hop', 'Country', 'R&B',
  'Electronic', 'Latin', 'Jazz', 'Reggae', 'Metal', 'Folk',
];

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: existingTracks, error: existingErr } = await supabase
      .from('karaoke_tracks')
      .select('spotify_track_id');
    if (existingErr) {
      return jsonError('Failed to read existing karaoke_tracks', existingErr.message);
    }
    const alreadySeeded = new Set((existingTracks ?? []).map((row) => row.spotify_track_id));

    let spotifyToken: string;
    try {
      spotifyToken = await getSpotifyToken();
    } catch (err) {
      return jsonError('Spotify auth failed', String(err));
    }
    if (!spotifyToken) {
      return jsonError('Spotify auth returned no access_token — check SPOTIFY_CLIENT_ID/SECRET', null);
    }

    const results: Record<string, unknown> = {};

    for (const genre of GENRES) {
      try {
        const searchRes = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(`genre:"${genre}"`)}&type=track&market=US&limit=30`,
          { headers: { Authorization: `Bearer ${spotifyToken}` } }
        );
        const rawText = await searchRes.text();
        let searchData: any;
        try {
          searchData = JSON.parse(rawText);
        } catch {
          results[genre] = {
            error: `Non-JSON response (status ${searchRes.status})`,
            rawBodySnippet: rawText.slice(0, 300),
            contentType: searchRes.headers.get('content-type'),
          };
          continue;
        }

        if (!searchRes.ok || !searchData.tracks?.items) {
          results[genre] = { error: searchData?.error?.message ?? `HTTP ${searchRes.status}` };
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
      } catch (err) {
        // A single genre's network failure shouldn't abort the whole seed run.
        results[genre] = { error: String(err) };
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError('Unhandled error in seed-karaoke-tracks', String(err));
  }
});

function jsonError(message: string, detail: string | null) {
  return new Response(JSON.stringify({ error: message, detail }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
  if (!res.ok) {
    throw new Error(`Spotify token endpoint returned ${res.status}: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}
