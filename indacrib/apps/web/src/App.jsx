import { useState } from 'react';
import JoinScreen from './components/JoinScreen.jsx';
import Lobby from './components/Lobby.jsx';
import GameBoard from './components/GameBoard.jsx';

// Top-level view switcher: join -> lobby -> active game
export default function App() {
  const [view, setView] = useState('join');
  const [gameId, setGameId] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [isHost, setIsHost] = useState(false);

  if (view === 'join') {
    return (
      <JoinScreen
        onJoined={({ gameId, roomCode, playerId, isHost }) => {
          setGameId(gameId);
          setRoomCode(roomCode);
          setPlayerId(playerId);
          setIsHost(isHost);
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
        isHost={isHost}
        onStart={() => setView('game')}
      />
    );
  }

  return <GameBoard gameId={gameId} roomCode={roomCode} playerId={playerId} isHost={isHost} />;
}
