-- "3 songs per artist" rule — nothing (Beyoncé, etc.) should be able to
-- flood a genre's pool and dominate the Karaoke random pick.
--
-- Two parts:
--   1. Retroactively trim any artist already over the cap, per genre,
--      keeping their first 3 seeded tracks and deleting the rest.
--   2. A trigger that enforces the cap going forward at the database
--      level, so it holds regardless of which client/function inserts
--      (seed-karaoke-tracks already self-limits, but this makes it a
--      real invariant instead of an honor system).

-- 1. Retroactive trim
with ranked as (
  select
    id,
    row_number() over (
      partition by genre, artist
      order by id  -- no created_at column on this table; id order is
                    -- insertion order closely enough for a one-time cleanup
    ) as rn
  from karaoke_tracks
  where artist is not null
)
delete from karaoke_tracks
where id in (select id from ranked where rn > 3);

-- 2. Forward-enforcing trigger
create or replace function enforce_artist_track_cap()
returns trigger
language plpgsql
as $$
begin
  if new.artist is not null and (
    select count(*) from karaoke_tracks
    where genre is not distinct from new.genre
      and artist = new.artist
  ) >= 3 then
    raise exception 'artist_track_cap_exceeded: % already has 3 tracks in genre %', new.artist, new.genre;
  end if;
  return new;
end;
$$;

drop trigger if exists karaoke_tracks_artist_cap on karaoke_tracks;
create trigger karaoke_tracks_artist_cap
  before insert on karaoke_tracks
  for each row
  execute function enforce_artist_track_cap();
