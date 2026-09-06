export default function Lobby({ roomCode, onStart }) {
  return (
    <div>
      <h2>Room {roomCode}</h2>
      <p>Waiting for players to join...</p>
      <button onClick={onStart}>Start Game</button>
    </div>
  );
}
