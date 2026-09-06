// Admin/one-off function: populates catchphrases and charades_words tables.
// Run manually (or on a monthly cron) — not called during gameplay.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
  const tmdbKey = Deno.env.get('TMDB_API_KEY')!;

  // 1. Pull popular movie titles from TMDB
  const tmdbRes = await fetch(
    `https://api.themoviedb.org/3/movie/popular?api_key=${tmdbKey}`
  );
  const { results: movies } = await tmdbRes.json();

  // 2. Ask GPT-4o-mini for catchphrases per title, insert into catchphrases table
  for (const movie of movies.slice(0, 10)) {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: `Give 2 famous catchphrases from "${movie.title}", one per line, no extra text.` },
        ],
      }),
    });
    const gptData = await gptRes.json();
    const lines = gptData.choices[0].message.content.split('\n').filter(Boolean);

    for (const phrase of lines) {
      await supabase.from('catchphrases').insert({ phrase, source: movie.title });
    }
  }

  return new Response(JSON.stringify({ seeded: movies.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
