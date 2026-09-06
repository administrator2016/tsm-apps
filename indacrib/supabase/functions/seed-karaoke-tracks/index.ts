// Admin/one-off function: populates karaoke_tracks with a genre tag, using
// Apple's iTunes Search API (itunes.apple.com/search) — free, unauthenticated,
// no developer account or subscription required. Run manually (or on a cron),
// not called during gameplay — mirrors seed-content's shape.
//
// We previously used Spotify's Web API, but Spotify now gates search/track
// lookups behind the app owner having an active Premium subscription (403:
// "Active premium subscription required for the owner of the app"). The
// iTunes Search API has no such requirement — see
// https://performance-partners.apple.com/search-api — but it IS rate-limited
// (roughly 20 requests/minute per IP), so genres are queried sequentially
// with a short delay between calls rather than in parallel.
//
// Every external fetch is wrapped so a network failure returns a structured
// JSON error instead of an uncaught exception (which the edge runtime turns
// into an opaque plain-text "Internal Server Error" with no detail).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GENRES = [
  'Pop', 'Rock', 'Hip-Hop', 'Country', 'R&B',
  'Electronic', 'Latin', 'Jazz', 'Reggae', 'Metal', 'Folk',
];

// Stay comfortably under iTunes' ~20 req/min-per-IP limit even though we
// only make one request per genre per run.
const DELAY_BETWEEN_GENRES_MS = 3500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: existingTracks, error: existingErr } = await supabase
      .from('karaoke_tracks')
      .select('itunes_track_id');
    if (existingErr) {
      return jsonError('Failed to read existing karaoke_tracks', existingErr.message);
    }
    const alreadySeeded = new Set((existingTracks ?? []).map((row) => row.itunes_track_id));

    const results: Record<string, unknown> = {};

    for (let i = 0; i < GENRES.length; i++) {
      const genre = GENRES[i];
      try {
        const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(genre)}&media=music&entity=song&limit=30`;
        const searchRes = await fetch(searchUrl);
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

        if (searchRes.status === 429) {
          results[genre] = {
            error: 'Rate limited by iTunes Search API',
            retryAfter: searchRes.headers.get('retry-after'),
          };
          continue;
        }

        if (!searchRes.ok || !Array.isArray(searchData.results)) {
          results[genre] = { error: searchData?.errorMessage ?? `HTTP ${searchRes.status}` };
          continue;
        }

        const items = searchData.results;
        let inserted = 0;
        let skipped = 0;

        for (const track of items) {
          const trackId = track?.trackId != null ? String(track.trackId) : null;
          if (!trackId || !track.previewUrl || alreadySeeded.has(trackId)) {
            skipped++;
            continue;
          }
          const { error } = await supabase.from('karaoke_tracks').insert({
            itunes_track_id: trackId,
            title: track.trackName,
            artist: track.artistName ?? null,
            genre,
          });
          if (error) {
            console.error(`Karaoke track insert failed for "${track.trackName}":`, JSON.stringify(error));
          } else {
            alreadySeeded.add(trackId);
            inserted++;
          }
        }

        results[genre] = { fetched: items.length, inserted, skipped };
      } catch (err) {
        // A single genre's network failure shouldn't abort the whole seed run.
        results[genre] = { error: String(err) };
      }

      if (i < GENRES.length - 1) {
        await sleep(DELAY_BETWEEN_GENRES_MS);
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
