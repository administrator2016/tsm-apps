// Admin/one-off function: populates catchphrases and charades_words tables.
// Run manually (or on a monthly cron) — not called during gameplay.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// TMDB's genre id → name mapping is a fixed public reference table
// (https://developer.themoviedb.org/reference/genre-movie-list), not seeded data.
const TMDB_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
  const tmdbKey = Deno.env.get('TMDB_API_KEY')!;

  // ---------- CATCHPHRASES ----------
  const tmdbRes = await fetch(
    `https://api.themoviedb.org/3/movie/popular?api_key=${tmdbKey}`
  );
  const { results: movies } = await tmdbRes.json();

  const { data: existingPhrases } = await supabase.from('catchphrases').select('source');
  const alreadySeededMovies = new Set((existingPhrases ?? []).map((row) => row.source));

  let phrasesProcessed = 0;
  let phrasesSkipped = 0;

  for (const movie of movies.slice(0, 10)) {
    if (alreadySeededMovies.has(movie.title)) {
      console.log(`Skipping catchphrases for "${movie.title}" — already seeded`);
      phrasesSkipped++;
      continue;
    }

    console.log(`Processing catchphrases: ${movie.title}`);

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

    if (!gptRes.ok || !gptData.choices) {
      console.error(`OpenAI request failed for "${movie.title}":`, JSON.stringify(gptData));
      continue;
    }

    const lines = gptData.choices[0].message.content.split('\n').filter(Boolean);
    const genre = TMDB_GENRES[movie.genre_ids?.[0]] ?? null;

    for (const phrase of lines) {
      const { error } = await supabase.from('catchphrases').insert({ phrase, source: movie.title, genre });
      if (error) console.error(`Catchphrase insert failed for "${movie.title}":`, JSON.stringify(error));
    }

    phrasesProcessed++;
  }

  // ---------- CHARADES WORDS ----------
  const { data: existingWords } = await supabase.from('charades_words').select('word');
  const alreadySeededWords = new Set((existingWords ?? []).map((row) => row.word.toLowerCase()));

  console.log('Requesting charades words batch from OpenAI');

  const charadesRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content:
            'Generate 30 fun charades words or short phrases for a party game, spanning a mix of categories: movies, animals, actions/verbs, everyday objects, famous people, and jobs. ' +
            'Respond with exactly one per line in the format "word | category" (e.g. "Riding a bike | Action"). No numbering, no extra text, no blank lines.',
        },
      ],
    }),
  });
  const charadesData = await charadesRes.json();

  let wordsInserted = 0;
  let wordsSkipped = 0;

  if (!charadesRes.ok || !charadesData.choices) {
    console.error('OpenAI request failed for charades words:', JSON.stringify(charadesData));
  } else {
    const lines = charadesData.choices[0].message.content.split('\n').filter(Boolean);
    console.log(`Got ${lines.length} charades word candidates`);

    for (const line of lines) {
      const [wordRaw, categoryRaw] = line.split('|').map((part) => part?.trim());
      if (!wordRaw || !categoryRaw) {
        console.error(`Skipping malformed charades line: "${line}"`);
        continue;
      }

      if (alreadySeededWords.has(wordRaw.toLowerCase())) {
        wordsSkipped++;
        continue;
      }

      const { error } = await supabase
        .from('charades_words')
        .insert({ word: wordRaw, category: categoryRaw });

      if (error) {
        console.error(`Charades word insert failed for "${wordRaw}":`, JSON.stringify(error));
      } else {
        wordsInserted++;
      }
    }
  }

  return new Response(
    JSON.stringify({
      catchphrases: { totalMovies: movies.length, processed: phrasesProcessed, skipped: phrasesSkipped },
      charadesWords: { inserted: wordsInserted, skipped: wordsSkipped },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});