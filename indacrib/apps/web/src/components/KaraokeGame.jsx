import { useState } from 'react';
import { startRound } from '../gameLogic.js';

export default function KaraokeGame({ topics, onBack }) {
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleNewPrompt() {
    setLoading(true);
    const result = await startRound('karaoke', topic || undefined);
    setPrompt(result);
    setLoading(false);
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h2 className="idc-mode-title">Karaoke</h2>
        <p className="idc-subtitle">Sing along to the 30-second preview</p>

        <div className="idc-field">
          <label htmlFor="kk-genre">Genre</label>
          <select
            id="kk-genre"
            className="idc-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">Any genre</option>
            {topics.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div className={prompt ? 'idc-prompt' : 'idc-prompt idc-prompt-empty'}>
          {prompt ? `${prompt.title} — ${prompt.artist}` : 'Hit New Karaoke Track to start'}
        </div>
        {prompt?.preview_url && (
          <audio className="idc-audio" controls src={prompt.preview_url} />
        )}

        <button className="idc-btn idc-btn-primary" onClick={handleNewPrompt} disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Loading…' : 'New Karaoke Track'}
        </button>
        <button className="idc-btn idc-btn-secondary" onClick={onBack} style={{ marginTop: 10 }}>
          Back to games
        </button>
      </div>
    </div>
  );
}
