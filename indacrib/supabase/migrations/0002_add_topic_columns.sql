-- Add topic/genre columns so CatchPhrase and Karaoke can be filtered by topic,
-- matching the category support charades_words already has.

alter table catchphrases add column if not exists genre text;
alter table karaoke_tracks add column if not exists genre text;

create index if not exists catchphrases_genre_idx on catchphrases (genre);
create index if not exists karaoke_tracks_genre_idx on karaoke_tracks (genre);
create index if not exists charades_words_category_idx on charades_words (category);
