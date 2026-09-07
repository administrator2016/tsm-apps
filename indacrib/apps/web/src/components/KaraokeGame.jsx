import { useState } from 'react';
import { startRound } from '../gameLogic.js';
import { useGenreRoulette } from '../useGenreRoulette.js';
import VoiceMicToggle from './VoiceMicToggle.jsx';

// How many recent artists to steer the next pick away from (see
// get-karaoke-track's excludeArtists handling).
const ARTIST_MEMORY = 3;

export default function KaraokeGame({ topics, onBack, turnScorePanel }) {
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [recentArtists, setRecentArtists] = useState([]);

  const spinningGenre = useGenreRoulette(loading, topics);

  async function handleNewPrompt() {
    if (loading) return; // guards the voice-command path, which has no `disabled` to rely on
    setLoading(true);
    setRevealed(false);
    const result = await startRound('karaoke', topic || undefined, recentArtists);
    setPrompt(result);
    setLoading(false);
    if (result?.artist) {
      setRecentArtists((prev) => [result.artist, ...prev].slice(0, ARTIST_MEMORY));
    }
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h2 className="idc-mode-title">Karaoke</h2>
        <p className="idc-subtitle">Sing along to the 30-second preview — name it before it's revealed!</p>

        {turnScorePanel}

        <div className="idc-field">
          <label htmlFor="kk-genre">Genre</label>
          <select
            id="kk-genre"
            className="idc-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={loading}
          >
            <option value="">Any genre</option>
            {topics.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div className={prompt ? 'idc-prompt' : 'idc-prompt idc-prompt-empty'}>
          {loading && spinningGenre ? (
            <span className="idc-roulette">{spinningGenre}</span>
          ) : prompt ? (
            revealed ? `${prompt.title} — ${prompt.artist}` : 'Name that tune...'
          ) : (
            'Hit New Karaoke Track to start'
          )}
        </div>

        {prompt?.preview_url && (
          <audio className="idc-audio" controls src={prompt.preview_url} onEnded={() => setRevealed(true)} />
        )}
        {prompt && !revealed && (
          <button className="idc-btn idc-btn-secondary" onClick={() => setRevealed(true)} style={{ marginTop: 8 }}>
            Reveal title &amp; artist
          </button>
        )}

        <div className="idc-primary-row" style={{ marginTop: 16 }}>
          <button className="idc-btn idc-btn-primary" onClick={handleNewPrompt} disabled={loading}>
            {loading ? 'Loading…' : 'New Karaoke Track'}
          </button>
          <VoiceMicToggle
            triggers={['new song', 'new track', 'next song']}
            onCommand={handleNewPrompt}
            label="Hands-free new song"
          />
        </div>
        <button className="idc-btn idc-btn-secondary" onClick={onBack} style={{ marginTop: 10 }}>
          Back to games
        </button>
      </div>
    </div>
  );
}
