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

// A fixed set of movies picked for being genuinely widely-known and
// quotable — a party game needs "everyone's seen this" hits, not whatever
// TMDB says is trending this week. TMDB's `popular` endpoint is "trending
// right now" (new releases, awards-season titles, anime, foreign films —
// not necessarily anything a random group of friends has actually seen),
// which is how a line from a brand-new 2026 release like "The Odyssey"
// ended up in the game. We still hit TMDB per title, just for genre
// metadata (via search-by-title) rather than as the discovery source.
const ICONIC_MOVIES = [
  'The Godfather', 'Star Wars', 'The Dark Knight', 'Jurassic Park', 'Titanic',
  'Forrest Gump', 'The Lion King', 'Jaws', 'E.T. the Extra-Terrestrial',
  'The Shawshank Redemption', 'Pulp Fiction', 'The Matrix', 'Toy Story',
  'Back to the Future', 'Gladiator', 'The Wizard of Oz', 'Rocky',
  'Casablanca', 'The Terminator', 'Finding Nemo',
];

// No TMDB TV genre lookup here — see the comment on `genre` in the shows
// loop below for why shows use a fixed kind-based label instead.

// Sitcoms and cartoons — widely-known, heavily-quoted shows. `kind` feeds
// the genre fallback label if TMDB's lookup misses, so a show still gets a
// meaningful bucket instead of the movie list's generic "Classic".
//
// The prompt below asks for character catchphrases/taglines rather than
// verbatim scene quotes (unlike ICONIC_MOVIES) — a sitcom or cartoon has
// far more dialogue than a movie, so "the exact line from episode X" is
// exactly the kind of thing a model will confidently misremember instead
// of correctly declining. A catchphrase repeated dozens of times across a
// series ("D'oh!", "How you doin'?") is something the model is far more
// reliably right about, and it fits a game called CatchPhrase better too.
const ICONIC_SHOWS = [
  { title: 'Friends', kind: 'sitcom' },
  { title: 'The Office', kind: 'sitcom' },
  { title: 'Seinfeld', kind: 'sitcom' },
  { title: 'Parks and Recreation', kind: 'sitcom' },
  { title: 'Brooklyn Nine-Nine', kind: 'sitcom' },
  { title: 'How I Met Your Mother', kind: 'sitcom' },
  { title: 'The Big Bang Theory', kind: 'sitcom' },
  { title: 'Cheers', kind: 'sitcom' },
  { title: 'The Simpsons', kind: 'cartoon' },
  { title: 'SpongeBob SquarePants', kind: 'cartoon' },
  { title: 'Rick and Morty', kind: 'cartoon' },
  { title: 'Family Guy', kind: 'cartoon' },
  { title: 'Tom and Jerry', kind: 'cartoon' },
  { title: 'Looney Tunes', kind: 'cartoon' },
  { title: 'South Park', kind: 'cartoon' },
  { title: 'Scooby-Doo', kind: 'cartoon' },
];

Deno.serve(async (req) => {
  // Optional { "target": "movies" | "shows" | "charades" } scopes this run
  // to one section. Running all of it (20 movies + 16 shows + a charades
  // batch, each with an OpenAI round-trip) in one invocation runs close to
  // the same edge-function execution ceiling that tripped up
  // seed-karaoke-tracks (WORKER_RESOURCE_LIMIT around ~150s) — scoping
  // keeps each call comfortably under it. Falls back to running
  // everything if omitted, for backward compatibility.
  const body = await req.json().catch(() => ({}));
  const target = typeof body?.target === 'string' ? body.target : null;
  if (target && !['movies', 'shows', 'charades'].includes(target)) {
    return new Response(
      JSON.stringify({ error: 'Unknown target', detail: `"${target}" must be one of: movies, shows, charades` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const runMovies = !target || target === 'movies';
  const runShows = !target || target === 'shows';
  const runCharades = !target || target === 'charades';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
  const tmdbKey = Deno.env.get('TMDB_API_KEY')!;

  // ---------- CATCHPHRASES: MOVIES ----------
  const { data: existingPhrases } = await supabase.from('catchphrases').select('source');
  const alreadySeededMovies = new Set((existingPhrases ?? []).map((row) => row.source));

  let phrasesProcessed = 0;
  let phrasesSkipped = 0;

  if (runMovies) {
  for (const title of ICONIC_MOVIES) {
    if (alreadySeededMovies.has(title)) {
      console.log(`Skipping catchphrases for "${title}" — already seeded`);
      phrasesSkipped++;
      continue;
    }

    console.log(`Processing catchphrases: ${title}`);

    // Genre metadata only — this is a curated list, not a discovery feed,
    // so we look each title up individually rather than paging a list.
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(title)}`
    );
    const tmdbData = await tmdbRes.json();
    const match = tmdbData?.results?.[0];
    // Every title above is a real, well-known genre movie, so if TMDB's
    // lookup or genre mapping ever comes back empty, fall back to a
    // labeled bucket rather than silently storing null — a genre-less row
    // is invisible to the app's genre filter, which is exactly the bug
    // that left the dropdown showing only "Any genre".
    const genre = TMDB_GENRES[match?.genre_ids?.[0]] ?? 'Classic';

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
              `Give 2 short, verbatim, instantly-recognizable movie quotes from "${title}" — ` +
              'lines a random group of friends would immediately recognize out of context. ' +
              'One per line, no numbering, no quotation marks, no extra text. ' +
              'If you are not confident you know an exact, genuinely famous line from this specific movie, ' +
              'respond with exactly NONE instead of guessing.',
          },
        ],
      }),
    });
    const gptData = await gptRes.json();

    if (!gptRes.ok || !gptData.choices) {
      console.error(`OpenAI request failed for "${title}":`, JSON.stringify(gptData));
      continue;
    }

    const rawContent = gptData.choices[0].message.content.trim();
    if (rawContent === 'NONE') {
      console.log(`Model declined to guess a quote for "${title}" — skipping`);
      phrasesSkipped++;
      continue;
    }

    const lines = rawContent.split('\n').filter(Boolean);

    for (const phrase of lines) {
      const { error } = await supabase.from('catchphrases').insert({ phrase, source: title, genre });
      if (error) console.error(`Catchphrase insert failed for "${title}":`, JSON.stringify(error));
    }

    phrasesProcessed++;
  }
  }

  // ---------- TV SITCOMS & CARTOONS ----------
  let showsProcessed = 0;
  let showsSkipped = 0;

  if (runShows) {
  for (const { title, kind } of ICONIC_SHOWS) {
    if (alreadySeededMovies.has(title)) {
      console.log(`Skipping catchphrases for "${title}" — already seeded`);
      showsSkipped++;
      continue;
    }

    console.log(`Processing catchphrases: ${title}`);

    // Genre is always the kind-based label ('Sitcom'/'Cartoon'), not a TMDB
    // lookup. TMDB tags sitcoms as its own "Comedy" (id 35) and cartoons as
    // "Animation" (id 16) — both of which already exist as movie genres —
    // so deferring to a TMDB TV genre lookup here (as an earlier version of
    // this function did) silently merged every show into an existing movie
    // bucket instead of surfacing "Sitcom"/"Cartoon" as filterable genres
    // of their own, which is the actual point of adding shows at all.
    const genre = kind === 'cartoon' ? 'Cartoon' : 'Sitcom';

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
              `Give 2 short, iconic catchphrases or taglines from the ${kind} "${title}" — ` +
              'lines said repeatedly across the show that a random group of friends would instantly ' +
              'recognize out of context (a character\'s signature catchphrase, not a one-off line from ' +
              'a specific episode). One per line, no numbering, no quotation marks, no extra text. ' +
              'If you are not confident a line is a genuine, well-known catchphrase from this specific ' +
              'show, respond with exactly NONE instead of guessing.',
          },
        ],
      }),
    });
    const gptData = await gptRes.json();

    if (!gptRes.ok || !gptData.choices) {
      console.error(`OpenAI request failed for "${title}":`, JSON.stringify(gptData));
      continue;
    }

    const rawContent = gptData.choices[0].message.content.trim();
    if (rawContent === 'NONE') {
      console.log(`Model declined to guess a catchphrase for "${title}" — skipping`);
      showsSkipped++;
      continue;
    }

    const lines = rawContent.split('\n').filter(Boolean);

    for (const phrase of lines) {
      const { error } = await supabase.from('catchphrases').insert({ phrase, source: title, genre });
      if (error) console.error(`Catchphrase insert failed for "${title}":`, JSON.stringify(error));
    }

    showsProcessed++;
  }
  }

  // ---------- CHARADES WORDS ----------
  const { data: existingWords } = await supabase.from('charades_words').select('word');
  const alreadySeededWords = new Set((existingWords ?? []).map((row) => row.word.toLowerCase()));

  let wordsInserted = 0;
  let wordsSkipped = 0;

  if (runCharades) {
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
  }

  return new Response(
    JSON.stringify({
      catchphrases: {
        movies: { total: ICONIC_MOVIES.length, processed: phrasesProcessed, skipped: phrasesSkipped },
        shows: { total: ICONIC_SHOWS.length, processed: showsProcessed, skipped: showsSkipped },
      },
      charadesWords: { inserted: wordsInserted, skipped: wordsSkipped },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
