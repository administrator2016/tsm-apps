import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// A plain `pick a random row` over the whole genre pool weights by however
// many tracks that artist happens to have in the table, not by how many
// distinct artists there are — a genre seeded with 30 iTunes chart hits
// where 8 happen to be Beyoncé means a ~27% chance of Beyoncé every single
// round. Picking the artist first, then a track from that artist, makes
// every artist in the pool equally likely regardless of how lopsided the
// underlying catalog is.
function pickDiverseTrack(tracks: any[]) {
  const byArtist = new Map<string, any[]>();
  for (const track of tracks) {
    const key = track.artist ?? '__unknown__';
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key)!.push(track);
  }
  const artists = [...byArtist.keys()];
  const artist = artists[Math.floor(Math.random() * artists.length)];
  const artistTracks = byArtist.get(artist)!;
  return artistTracks[Math.floor(Math.random() * artistTracks.length)];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { genre, excludeArtists } = await req.json().catch(() => ({}));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('karaoke_tracks').select('*');
  if (genre) query = query.eq('genre', genre);

  const { data: tracks, error } = await query;

  if (error || !tracks?.length) {
    return new Response(JSON.stringify({ error: error?.message ?? 'No tracks found for that genre' }), {
      status: error ? 500 : 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Also steer away from whichever artists just came up (client sends its
  // last couple of picks), so back-to-back rounds don't repeat an artist
  // even within a single "equally likely" draw. Falls back to the full
  // pool if that would leave nothing to pick from.
  const exclude = new Set((excludeArtists ?? []).filter(Boolean));
  const filtered = exclude.size ? tracks.filter((t) => !exclude.has(t.artist)) : tracks;
  const track = pickDiverseTrack(filtered.length ? filtered : tracks);

  // Fetch the live 30s preview URL from the free, unauthenticated iTunes
  // Search API lookup endpoint using the stored track ID. Previews can
  // occasionally be re-encoded or briefly removed from Apple's CDN, so we
  // still fall back gracefully instead of throwing if the lookup fails.
  try {
    const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(track.itunes_track_id)}`);
    const rawText = await lookupRes.text();

    let lookupData: any;
    try {
      lookupData = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({
          ...track,
          preview_url: null,
          previewError: `Non-JSON response from iTunes lookup (status ${lookupRes.status})`,
          rawBodySnippet: rawText.slice(0, 300),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const previewUrl = lookupData?.results?.[0]?.previewUrl ?? null;

    return new Response(
      JSON.stringify({ ...track, preview_url: previewUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ...track, preview_url: null, previewError: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
