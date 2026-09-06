-- Switch karaoke_tracks from Spotify track IDs to iTunes Search API track IDs.
-- Spotify's Web API now gates search/track lookups behind the app owner
-- having an active Premium subscription (403: "Active premium subscription
-- required for the owner of the app"), so we're moving to Apple's free,
-- unauthenticated iTunes Search API instead.
--
-- Any rows already in the table were seeded before this switch was possible
-- (every seed attempt 403'd), so this should be an empty table in practice.
-- We clear it defensively rather than leaving orphaned Spotify IDs that will
-- never resolve against iTunes.
truncate table karaoke_tracks;

alter table karaoke_tracks rename column spotify_track_id to itunes_track_id;
