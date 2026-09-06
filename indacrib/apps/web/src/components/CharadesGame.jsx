import { useState } from 'react';
import { startRound } from '../gameLogic.js';

export default function CharadesGame({ topics, onBack }) {
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleNewPrompt() {
    setLoading(true);
    const result = await startRound('charades', topic || undefined);
    setPrompt(result);
    setLoading(false);
  }

  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <h2 className="idc-mode-title">Charades</h2>
        <p className="idc-subtitle">Act it out, no talking!</p>

        <div className="idc-field">
          <label htmlFor="ch-category">Category</label>
          <select
            id="ch-category"
            className="idc-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">Any category</option>
            {topics.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className={prompt ? 'idc-prompt' : 'idc-prompt idc-prompt-empty'}>
          {prompt ? prompt.word : 'Hit New Charades Word to start'}
        </div>
        {prompt?.category && <p className="idc-badge">{prompt.category}</p>}

        <button className="idc-btn idc-btn-primary" onClick={handleNewPrompt} disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Loading…' : 'New Charades Word'}
        </button>
        <button className="idc-btn idc-btn-secondary" onClick={onBack} style={{ marginTop: 10 }}>
          Back to games
        </button>
      </div>
    </div>
  );
}
