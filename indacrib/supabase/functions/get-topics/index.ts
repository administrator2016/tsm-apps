// Returns the distinct topic values actually present in each content table,
// so the client's topic pickers stay in sync with real seeded data instead
// of a hardcoded list that can drift.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const [catchphrase, karaoke, charades] = await Promise.all([
    supabase.from('catchphrases').select('genre'),
    supabase.from('karaoke_tracks').select('genre'),
    supabase.from('charades_words').select('category'),
  ]);

  const distinct = (rows, key) =>
    [...new Set((rows ?? []).map((r) => r[key]).filter(Boolean))].sort();

  return new Response(
    JSON.stringify({
      catchphrase: distinct(catchphrase.data, 'genre'),
      karaoke: distinct(karaoke.data, 'genre'),
      charades: distinct(charades.data, 'category'),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
