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

// A bare `term=Pop` search returns iTunes' current top-chart matches for
// that word, which skews hard toward whichever handful of artists are
// popular right now (this is the root cause of runs like 8 Beyoncé tracks
// in a row — she's simply overrepresented in "Pop" results). Querying the
// genre alongside a few different decade/descriptor qualifiers pulls from
// different slices of the catalog per genre, so the seeded pool ends up
// spanning far more distinct artists instead of one search's chart-toppers.
const QUALIFIERS = ['', '90s', '2000s', 'classics'];

// Stay comfortably under iTunes' ~20 req/min-per-IP limit. We now make up
// to 4 requests per genre instead of 1, so the delay applies between every
// request, not just between genres.
const DELAY_BETWEEN_REQUESTS_MS = 3500;

// "3 songs per artist" rule — a bare genre search still skews toward
// whoever's charting, so cap how many of any one artist's tracks we'll
// seed per genre even before the DB trigger (migration 0006) would reject
// the insert. Checking here avoids burning iTunes' rate limit on inserts
// we already know will be turned away.
const MAX_TRACKS_PER_ARTIST_PER_GENRE = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  try {
    // Optional { "genre": "Pop" } body scopes this run to a single genre.
    // Running all 11 genres x 4 qualifiers x 3.5s delay in one invocation
    // took ~150s and tripped the edge function's execution ceiling
    // (WORKER_RESOURCE_LIMIT) before most genres even ran. Scoping to one
    // genre keeps a single call to ~14s; call once per genre (or loop the
    // GENRES list client-side) to seed everything.
    const body = await req.json().catch(() => ({}));
    const requestedGenre = typeof body?.genre === 'string' ? body.genre : null;
    if (requestedGenre && !GENRES.includes(requestedGenre)) {
      return jsonError('Unknown genre', `"${requestedGenre}" is not one of: ${GENRES.join(', ')}`);
    }
    const genresToRun = requestedGenre ? [requestedGenre] : GENRES;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: existingTracks, error: existingErr } = await supabase
      .from('karaoke_tracks')
      .select('itunes_track_id, genre, artist');
    if (existingErr) {
      return jsonError('Failed to read existing karaoke_tracks', existingErr.message);
    }
    const alreadySeeded = new Set((existingTracks ?? []).map((row) => row.itunes_track_id));

    // artist-cap counts, keyed `${genre}::${artist}`, seeded from what's
    // already in the table so a re-run of this function respects tracks
    // inserted by earlier runs, not just this run's own inserts.
    const artistCounts = new Map<string, number>();
    for (const row of existingTracks ?? []) {
      if (!row.artist) continue;
      const key = `${row.genre ?? ''}::${row.artist}`;
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
    }

    const results: Record<string, unknown> = {};
    const requestPlan = genresToRun.flatMap((genre) => QUALIFIERS.map((qualifier) => ({ genre, qualifier })));

    for (let i = 0; i < requestPlan.length; i++) {
      const { genre, qualifier } = requestPlan[i];
      const term = qualifier ? `${genre} ${qualifier}` : genre;
      const genreStats = (results[genre] ??= { fetched: 0, inserted: 0, skipped: 0, artists: new Set<string>() });

      try {
        const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=30`;
        const searchRes = await fetch(searchUrl);
        const rawText = await searchRes.text();

        let searchData: any;
        try {
          searchData = JSON.parse(rawText);
        } catch {
          genreStats.errors ??= [];
          genreStats.errors.push(`"${term}": non-JSON response (status ${searchRes.status})`);
          continue;
        }

        if (searchRes.status === 429) {
          genreStats.errors ??= [];
          genreStats.errors.push(`"${term}": rate limited by iTunes Search API`);
          continue;
        }

        if (!searchRes.ok || !Array.isArray(searchData.results)) {
          genreStats.errors ??= [];
          genreStats.errors.push(`"${term}": ${searchData?.errorMessage ?? `HTTP ${searchRes.status}`}`);
          continue;
        }

        const items = searchData.results;
        genreStats.fetched += items.length;

        for (const track of items) {
          const trackId = track?.trackId != null ? String(track.trackId) : null;
          if (!trackId || !track.previewUrl || alreadySeeded.has(trackId)) {
            genreStats.skipped++;
            continue;
          }

          const artistKey = `${genre}::${track.artistName ?? ''}`;
          if (track.artistName && (artistCounts.get(artistKey) ?? 0) >= MAX_TRACKS_PER_ARTIST_PER_GENRE) {
            genreStats.skipped++;
            genreStats.artistCapped = (genreStats.artistCapped ?? 0) + 1;
            continue;
          }

          const { error } = await supabase.from('karaoke_tracks').insert({
            itunes_track_id: trackId,
            title: track.trackName,
            artist: track.artistName ?? null,
            genre,
          });
          if (error) {
            // Also catches the DB-level cap trigger (migration 0006) if two
            // concurrent runs raced past the in-memory check above.
            console.error(`Karaoke track insert failed for "${track.trackName}":`, JSON.stringify(error));
          } else {
            alreadySeeded.add(trackId);
            genreStats.inserted++;
            if (track.artistName) {
              genreStats.artists.add(track.artistName);
              artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
            }
          }
        }
      } catch (err) {
        // A single request's network failure shouldn't abort the whole seed run.
        genreStats.errors ??= [];
        genreStats.errors.push(`"${term}": ${String(err)}`);
      }

      if (i < requestPlan.length - 1) {
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      }
    }

    // Sets don't serialize to JSON — surface distinct-artist counts instead
    // of the raw set so the response actually shows the diversity win.
    for (const genre of Object.keys(results)) {
      const stats = results[genre] as any;
      stats.distinctArtists = stats.artists.size;
      delete stats.artists;
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
