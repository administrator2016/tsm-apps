import { useState } from 'react';
import JoinScreen from './components/JoinScreen.jsx';
import Lobby from './components/Lobby.jsx';
import GameBoard from './components/GameBoard.jsx';

// Top-level view switcher: join -> lobby -> active game
export default function App() {
  const [view, setView] = useState('join');
  const [gameId, setGameId] = useState(null);
  const [roomCode, setRoomCode] = useState(null);

  if (view === 'join') {
    return (
      <JoinScreen
        onJoined={({ gameId, roomCode }) => {
          setGameId(gameId);
          setRoomCode(roomCode);
          setView('lobby');
        }}
      />
    );
  }

  if (view === 'lobby') {
    return (
      <Lobby
        gameId={gameId}
        roomCode={roomCode}
        onStart={() => setView('game')}
      />
    );
  }

  return <GameBoard gameId={gameId} roomCode={roomCode} />;
}
