import { useEffect, useRef, useState } from 'react';
import { listenForCommand, matchesCommand, voiceSupported } from '../voice.js';

// Small opt-in 🎤 toggle, reused for every hands-free command in the app
// (host's "next player", each mini-game's "new song/phrase/word"). Browser
// speech recognition only — no AWS Lex/Transcribe, no API key.
export default function VoiceMicToggle({ triggers, onCommand, label = 'Voice control' }) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const stopRef = useRef(null);

  useEffect(() => () => stopRef.current?.(), []);

  if (!voiceSupported()) return null;

  function toggle() {
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      setHeard('');
      return;
    }
    setListening(true);
    stopRef.current = listenForCommand((said) => {
      setHeard(said);
      if (matchesCommand(said, triggers)) onCommand();
    });
  }

  return (
    <div className="idc-voice">
      <button
        type="button"
        className={listening ? 'idc-voice-btn idc-voice-btn-active' : 'idc-voice-btn'}
        onClick={toggle}
        title={listening ? `Listening for "${triggers[0]}"` : `${label} (off)`}
        aria-pressed={listening}
      >
        🎤
      </button>
      {listening && <span className="idc-voice-hint">say "{triggers[0]}"{heard ? ` — heard: "${heard}"` : ''}</span>}
    </div>
  );
}
