-- InDaCrib schema

create table games (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  hotel_property text,
  game_mode text check (game_mode in ('catchphrase','karaoke','charades')),
  status text default 'lobby',
  current_player_id uuid,
  created_at timestamptz default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  display_name text not null,
  is_host boolean default false,
  joined_at timestamptz default now()
);

create table scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  points int default 0,
  updated_at timestamptz default now()
);

create table catchphrases (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,
  source text
);

create table charades_words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  category text
);

create table karaoke_tracks (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text not null,
  title text,
  artist text
);

-- Row Level Security: scope everything to the room it belongs to
alter table games enable row level security;
alter table players enable row level security;
alter table scores enable row level security;

create policy "games are readable by anyone with the room code"
  on games for select using (true);

create policy "players can read players in their game"
  on players for select using (true);

create policy "players can insert themselves"
  on players for insert with check (true);

create policy "scores are readable by anyone in the game"
  on scores for select using (true);

-- Enable realtime on the tables the client subscribes to
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table scores;
