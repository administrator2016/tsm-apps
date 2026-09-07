import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { genre } = await req.json().catch(() => ({}));

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

  const track = tracks[Math.floor(Math.random() * tracks.length)];

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
