-- Wires up the RLS policies scoring/turn-taking actually needs. Without
-- these, the anon-key client can only ever SELECT: `games` had no insert
-- policy (so JoinScreen's "Start a new game" would 401 the moment RLS is
-- enforced) and no update policy (so nothing can ever advance
-- current_player_id or status), and `scores` had no insert/update policy
-- at all. There's no auth layer here — access is already scoped by
-- knowledge of the 4-letter room code — so these mirror the existing
-- "readable by anyone" policies rather than adding new restrictions.

create policy "anyone can create a game"
  on games for insert with check (true);

create policy "anyone can update a game they know the room code for"
  on games for update using (true);

create policy "players can award points"
  on scores for insert with check (true);

create policy "players can update points"
  on scores for update using (true);

-- One row per player per game so awarding a point can be a plain upsert
-- (increment on conflict) instead of a select-then-insert-or-update dance.
alter table scores add constraint scores_game_player_unique unique (game_id, player_id);

-- Atomic +delta so two people tapping "award point" for the same player at
-- the same moment can't clobber each other the way a client-side
-- read-then-write increment would.
create or replace function increment_score(p_game_id uuid, p_player_id uuid, p_delta int)
returns void
language sql
as $$
  insert into scores (game_id, player_id, points)
  values (p_game_id, p_player_id, p_delta)
  on conflict (game_id, player_id)
  do update set points = scores.points + excluded.points, updated_at = now();
$$;

