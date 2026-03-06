import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Board } from './ChessEngine';
import './index.css';

const PIECE_IMAGES = {
  white: {
    king: '/w_king_svg_withShadow.svg',
    queen: '/w_queen_svg_withShadow.svg',
    rook: '/w_rook_svg_withShadow.svg',
    bishop: '/w_bishop_svg_withShadow.svg',
    knight: '/w_knight_svg_withShadow.svg',
    pawn: '/w_pawn_svg_withShadow.svg'
  },
  black: {
    king: '/b_king_svg_withShadow.svg',
    queen: '/b_queen_svg_withShadow.svg',
    rook: '/b_rook_svg_withShadow.svg',
    bishop: '/b_bishop_svg_withShadow.svg',
    knight: '/b_knight_svg_withShadow.svg',
    pawn: '/b_pawn_svg_withShadow.svg'
  },
};

// Connect to the local Node server
const socket = io('http://localhost:3001');

function App() {
  const [board, setBoard] = useState(new Board());
  const [selectedPos, setSelectedPos] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Multiplayer states
  const [view, setView] = useState('LOBBY'); // LOBBY, WAITING, SEARCHING, GAME, SPECTATING
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [playerColor, setPlayerColor] = useState(null);
  const [errorStatus, setErrorStatus] = useState('');

  // Game explorer
  const [liveGames, setLiveGames] = useState([]);
  const [pastGames, setPastGames] = useState([]);

  useEffect(() => {
    socket.on('game_created', ({ code, color }) => {
      setRoomCode(code);
      setPlayerColor(color);
      setView('WAITING');
    });

    socket.on('game_joined', ({ code, color }) => {
      setRoomCode(code);
      setPlayerColor(color);
      setView('GAME');
    });

    socket.on('game_start', () => {
      setView('GAME');
    });

    socket.on('waiting_for_match', () => {
      setView('SEARCHING');
    });

    socket.on('join_error', (msg) => {
      setErrorStatus(msg);
      setTimeout(() => setErrorStatus(''), 3000);
    });

    socket.on('spectator_joined', ({ code, history }) => {
      setRoomCode(code);
      setPlayerColor('spectator');

      // Reconstruct board from history
      const newBoard = new Board();
      if (history && history.length > 0) {
        newBoard.history = history;
        newBoard.pieces = history[history.length - 1].pieces;
        // Estimate turn based on history length (White moves first)
        newBoard.turn = history.length % 2 === 1 ? 'white' : 'black';
      }
      setBoard(newBoard);
      setView('SPECTATING');
    });

    socket.on('live_games_list', (games) => {
      setLiveGames(games);
    });

    socket.on('past_games_list', (games) => {
      setPastGames(games);
    });

    socket.on('opponent_move', ({ startPos, endPos }) => {
      setBoard(prevBoard => {
        const newBoard = Object.assign(Object.create(Object.getPrototypeOf(prevBoard)), prevBoard);
        newBoard.movePiece(startPos, endPos); // Apply remote move
        return newBoard;
      });
      setHistoryIndex(-1); // Snap back to present when opponent moves
    });

    socket.on('opponent_disconnected', () => {
      alert("Opponent disconnected!");
      setView('LOBBY');
      setBoard(new Board());
    });

    return () => {
      socket.off('game_created');
      socket.off('game_joined');
      socket.off('game_start');
      socket.off('waiting_for_match');
      socket.off('spectator_joined');
      socket.off('live_games_list');
      socket.off('past_games_list');
      socket.off('join_error');
      socket.off('opponent_move');
      socket.off('opponent_disconnected');
    };
  }, []);

  // Fetch games when entering lobby
  useEffect(() => {
    if (view === 'LOBBY') {
      socket.emit('get_live_games');
      socket.emit('get_past_games');
    }
  }, [view]);

  const handleCreateGame = () => {
    socket.emit('create_game');
  };

  const handleFindGame = () => {
    socket.emit('find_game');
  };

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (joinCodeInput.trim().length === 3) {
      socket.emit('join_game', joinCodeInput.trim().toUpperCase());
    }
  };

  const handleSquareClick = (pos) => {
    if (view !== 'GAME') return; // Only allow clicks in active game
    if (historyIndex !== -1) return; // Cannot play moves from the past!
    if (playerColor === 'spectator') return; // Spectators cannot move
    if (board.turn !== playerColor) return; // Only allow clicks on our turn

    if (selectedPos) {
      if (legalMoves.includes(pos)) {
        // Perform local move
        const success = board.movePiece(selectedPos, pos);
        if (success) {
          const newHistoryItem = board.history[board.history.length - 1]; // get the item just pushed
          // Emit move to server
          socket.emit('make_move', { code: roomCode, startPos: selectedPos, endPos: pos, newHistoryItem });

          setBoard(Object.assign(Object.create(Object.getPrototypeOf(board)), board));
          setSelectedPos(null);
          setLegalMoves([]);
          setHistoryIndex(-1);
          return;
        }
      }
    }

    const activePieces = historyIndex === -1 ? board.pieces : board.history[historyIndex].pieces;
    const piece = activePieces[pos];
    // Can only select our own pieces
    if (piece && piece.color === playerColor && piece.color === board.turn) {
      setSelectedPos(pos);
      setLegalMoves(piece.getMoves(board));
    } else {
      setSelectedPos(null);
      setLegalMoves([]);
    }
  };

  const renderSquare = (c, r) => {
    // If playing Black, render the board from Black's perspective. Specs and White see normally.
    const displayR = playerColor === 'black' ? r : 7 - r;
    const displayC = playerColor === 'black' ? 7 - c : c;

    const pos = Board.coordToPos([displayC, displayR]);
    const activePieces = historyIndex === -1 ? board.pieces : board.history[historyIndex].pieces;
    const piece = activePieces[pos];
    const isLight = (displayC + displayR) % 2 !== 0;
    const isSelected = selectedPos === pos;
    const isLegalMove = legalMoves.includes(pos);

    return (
      <div
        key={pos}
        className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''}`}
        onClick={() => handleSquareClick(pos)}
      >
        {isLegalMove && <div className="legal-move-hint" />}
        {piece && (
          <img
            src={PIECE_IMAGES[piece.color][piece.type]}
            alt={`${piece.color} ${piece.type}`}
            className={`piece ${piece.color}`}
            draggable="false"
          />
        )}
      </div>
    );
  };

  if (view === 'LOBBY') {
    return (
      <div className="chess-container" style={{ maxWidth: '900px' }}>
        <h1 style={{ fontSize: '40px', marginBottom: '40px' }}>Chess App</h1>

        <div className="lobby-grid">
          {/* Card 1: Random Game */}
          <div className="card">
            <h2>Quick Match</h2>
            <p>Find a random opponent instantly.</p>
            <button className="primary-btn" onClick={handleFindGame} style={{ background: '#27ae60' }}>
              Find Random Match
            </button>
          </div>

          {/* Card 2: Play with Friend */}
          <div className="card">
            <h2>Play with Friend</h2>
            <p>Create a room or join one.</p>
            <button className="primary-btn" onClick={handleCreateGame} style={{ marginBottom: '10px' }}>Create Game</button>
            <form onSubmit={handleJoinGame} className="join-form">
              <input
                type="text"
                placeholder="Code"
                maxLength={3}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              />
              <button type="submit" className="secondary-btn">Join Game</button>
            </form>
          </div>

          {/* Card 3: Live Games */}
          <div className="card list-card">
            <h2>Live Games (Spectate)</h2>
            <p>Watch active games.</p>
            <div className="item-list">
              {liveGames.length === 0 ? <p className="empty-msg">No active games.</p> :
                liveGames.map(game => (
                  <div key={game.code} className="list-item" onClick={() => socket.emit('spectate_game', game.code)}>
                    <span>Room {game.code}</span>
                    <span className="badge">{game.moves} moves</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Card 4: Past Games */}
          <div className="card list-card">
            <h2>Past Games</h2>
            <p>Review finished games.</p>
            <div className="item-list">
              {pastGames.length === 0 ? <p className="empty-msg">No past games yet.</p> :
                pastGames.map(game => (
                  <div key={game.id} className="list-item">
                    <span>Room {game.room_code}</span>
                    <span className="badge">{(new Date(game.ended_at)).toLocaleDateString()}</span>
                  </div>
                ))
              }
            </div>
          </div>

        </div>
        {errorStatus && <p className="error">{errorStatus}</p>}
      </div>
    );
  }

  if (view === 'WAITING') {
    return (
      <div className="chess-container lobby">
        <h1>Waiting for Opponent</h1>
        <p>Your Game Code is:</p>
        <h2 className="room-code">{roomCode}</h2>
        <p className="loading-dots">Waiting</p>
      </div>
    );
  }

  if (view === 'SEARCHING') {
    return (
      <div className="chess-container lobby">
        <h1>Matchmaking</h1>
        <p>Looking for an opponent...</p>
        <p className="loading-dots" style={{ marginTop: '20px', fontSize: '30px' }}>🔍</p>
      </div>
    );
  }

  // GAME view
  const boardRows = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      boardRows.push(renderSquare(c, r));
    }
  }

  const handleHistoryClick = (idx) => {
    if (idx === board.history.length - 1) {
      setHistoryIndex(-1); // Back to live
    } else {
      setHistoryIndex(idx);
    }
    setSelectedPos(null);
    setLegalMoves([]);
  };

  const isSpectating = view === 'SPECTATING';

  return (
    <div className="chess-container" style={{ flexDirection: 'row', alignItems: 'flex-start', maxWidth: '850px', justifyContent: 'space-between' }}>

      <div className="game-wrapper">
        <div className="game-header">
          <div className="room-badge">{isSpectating ? 'Spectating ' : 'Room: '}{roomCode}</div>
          <div className="status-bar">
            {historyIndex !== -1 ? "Analyzing Past Move" : (isSpectating ? `Turn: ${board.turn}` : (board.turn === playerColor ? "Your Turn" : "Opponent's Turn"))}
          </div>
        </div>
        <div className="board">
          {boardRows}
        </div>
        <div className="controls">
          <p>{isSpectating ? <b>Observer</b> : `You are playing as ${playerColor}`}</p>
          <button onClick={() => { setView('LOBBY'); setBoard(new Board()); }} style={{ marginTop: '10px', background: '#e74c3c' }}>Leave to Lobby</button>
        </div>
      </div>

      <div className="history-panel">
        <h3>Move History</h3>
        <div className="history-list">
          {board.history.map((snapshot, idx) => {
            const isActive = historyIndex === idx || (historyIndex === -1 && idx === board.history.length - 1);
            return (
              <div
                key={idx}
                className={`history-item ${isActive ? 'active' : ''}`}
                onClick={() => handleHistoryClick(idx)}
              >
                {idx === 0 ? "Start" : `${idx}. ${snapshot.move}`}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

export default App;
