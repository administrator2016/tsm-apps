import { useState } from 'react';
import { startRound } from '../gameLogic.js';
import { speakPhrase } from '../voice.js';
import { useGenreRoulette } from '../useGenreRoulette.js';

export default function CatchPhraseGame({ topics, onBack, turnScorePanel }) {
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [loading, setLoading] = useState(false);

  const spinningGenre = useGenreRoulette(loading, topics);

  async function handleNewPrompt() {
    setLoading(true);
    const result = await startRound('catchphrase', topic || undefined);
    setPrompt(result);
    setLoading(false);
    if (result?.phrase) speakPhrase(result.phrase);
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h2 className="idc-mode-title">CatchPhrase</h2>
        <p className="idc-subtitle">Guess the movie from the famous line</p>

        {turnScorePanel}

        <div className="idc-field">
          <label htmlFor="cp-genre">Genre</label>
          <select
            id="cp-genre"
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
            prompt.phrase
          ) : (
            'Hit New CatchPhrase to start'
          )}
        </div>
        {!loading && prompt?.source && <p className="idc-badge">{prompt.source}</p>}

        <button className="idc-btn idc-btn-primary" onClick={handleNewPrompt} disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Loading…' : 'New CatchPhrase'}
        </button>
        <button className="idc-btn idc-btn-secondary" onClick={onBack} style={{ marginTop: 10 }}>
          Back to games
        </button>
      </div>
    </div>
  );
}
