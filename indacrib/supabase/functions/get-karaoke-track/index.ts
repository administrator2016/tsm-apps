import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: tracks } = await supabase.from('karaoke_tracks').select('*');
  const track = tracks[Math.floor(Math.random() * tracks.length)];

  // Fetch the live 30s preview URL from Spotify using the stored track ID
  const spotifyToken = await getSpotifyToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${track.spotify_track_id}`, {
    headers: { Authorization: `Bearer ${spotifyToken}` },
  });
  const spotifyData = await res.json();

  return new Response(
    JSON.stringify({ ...track, preview_url: spotifyData.preview_url }),
    { headers: { 'Content-Type': 'application/json' } }
  );
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
