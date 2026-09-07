import { useEffect, useState } from 'react';
import { broadcastReaction } from '../realtime.js';

const REACTIONS = ['👍', '😂', '🔥', '😱'];

// Free stand-in for the AWS WebSocket "live interaction" idea: everyone in
// the room can tap an emoji, it broadcasts over the channel GameBoard
// already subscribes to, and floats up for a second on every screen
// (including the sender's, since the channel is `self: true`).
export default function ReactionBar({ roomCode, incoming }) {
  const [floaters, setFloaters] = useState([]);

  useEffect(() => {
    if (!incoming) return;
    setFloaters((prev) => [...prev, incoming]);
    const timer = setTimeout(() => {
      setFloaters((prev) => prev.filter((f) => f.id !== incoming.id));
    }, 1600);
    return () => clearTimeout(timer);
  }, [incoming]);

  return (
    <div className="idc-reactions">
      <div className="idc-reaction-float-layer" aria-hidden="true">
        {floaters.map((f, i) => (
          <span
            key={f.id}
            className="idc-reaction-float"
            style={{ left: `${12 + ((i * 17) % 76)}%` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>
      <div className="idc-reaction-bar">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            className="idc-reaction-btn"
            onClick={() => broadcastReaction(roomCode, emoji)}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
