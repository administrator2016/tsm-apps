// Pulls a random pre-seeded catchphrase from the database, optionally filtered by genre.
// No live external API call at play time — seeding happens via seed-content.
//
// Previously used a `random_catchphrase` Postgres RPC (not tracked in this repo's
// migrations, so its filtering behavior is unknown/unverifiable). Switched to a plain
// select + client-side random pick — same approach get-karaoke-track already uses —
// so genre filtering doesn't depend on an untracked DB function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const { genre } = await req.json().catch(() => ({}));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('catchphrases').select('*');
  if (genre) query = query.eq('genre', genre);

  const { data, error } = await query.limit(200);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!data?.length) {
    return new Response(JSON.stringify({ phrase: 'No catchphrases found for that genre' }), {
      status: 404,
    });
  }

  const phrase = data[Math.floor(Math.random() * data.length)];
  return new Response(JSON.stringify(phrase), {
    headers: { 'Content-Type': 'application/json' },
  });
});
