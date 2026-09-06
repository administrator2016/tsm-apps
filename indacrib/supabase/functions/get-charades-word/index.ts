import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const { category } = await req.json().catch(() => ({}));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('charades_words').select('*');
  if (category) query = query.eq('category', category);

  const { data, error } = await query.limit(50);
  if (error || !data?.length) {
    return new Response(JSON.stringify({ word: 'Error fetching data' }), { status: 500 });
  }

  const word = data[Math.floor(Math.random() * data.length)];
  return new Response(JSON.stringify(word), {
    headers: { 'Content-Type': 'application/json' },
  });
});
