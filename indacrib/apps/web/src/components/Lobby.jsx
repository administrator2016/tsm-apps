export default function Lobby({ roomCode, onStart }) {
  return (
    <div className="idc-canvas">
      <div className="idc-card">
        <p className="idc-room-label">Room code</p>
        <p className="idc-room-code">{roomCode}</p>
        <p className="idc-waiting">
          <span className="idc-pulse-dot" />
          Waiting for players to join...
        </p>
        <button className="idc-btn idc-btn-primary" onClick={onStart}>
          Start Game
        </button>
      </div>
    </div>
  );
}
