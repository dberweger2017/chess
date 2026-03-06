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

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// Connect to the Node server (using default host for reverse proxy support)
const socket = io();

function App() {
  const [board, setBoard] = useState(new Board());
  const [selectedPos, setSelectedPos] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Multiplayer states
  const [view, setView] = useState('LOBBY');
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
      const newBoard = new Board();
      if (history && history.length > 0) {
        newBoard.history = history;
        newBoard.pieces = history[history.length - 1].pieces;
        newBoard.turn = history.length % 2 === 1 ? 'white' : 'black';
      }
      setBoard(newBoard);
      setView('SPECTATING');
    });

    socket.on('live_games_list', (games) => setLiveGames(games));
    socket.on('past_games_list', (games) => setPastGames(games));

    socket.on('opponent_move', ({ startPos, endPos }) => {
      setBoard(prevBoard => {
        const newBoard = Object.assign(Object.create(Object.getPrototypeOf(prevBoard)), prevBoard);
        newBoard.movePiece(startPos, endPos);
        return newBoard;
      });
      setHistoryIndex(-1);
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

  useEffect(() => {
    if (view === 'LOBBY') {
      socket.emit('get_live_games');
      socket.emit('get_past_games');
    }
  }, [view]);

  const handleCreateGame = () => socket.emit('create_game');
  const handleFindGame = () => socket.emit('find_game');

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (joinCodeInput.trim().length === 3) {
      socket.emit('join_game', joinCodeInput.trim().toUpperCase());
    }
  };

  const handleSquareClick = (pos) => {
    if (view !== 'GAME') return;
    if (historyIndex !== -1) return;
    if (playerColor === 'spectator') return;
    if (board.turn !== playerColor) return;

    if (selectedPos) {
      if (legalMoves.includes(pos)) {
        const success = board.movePiece(selectedPos, pos);
        if (success) {
          const newHistoryItem = board.history[board.history.length - 1];
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
    if (piece && piece.color === playerColor && piece.color === board.turn) {
      setSelectedPos(pos);
      setLegalMoves(piece.getMoves(board));
    } else {
      setSelectedPos(null);
      setLegalMoves([]);
    }
  };

  const renderSquare = (c, r) => {
    const displayR = playerColor === 'black' ? r : 7 - r;
    const displayC = playerColor === 'black' ? 7 - c : c;
    const pos = Board.coordToPos([displayC, displayR]);
    const activePieces = historyIndex === -1 ? board.pieces : board.history[historyIndex].pieces;
    const piece = activePieces[pos];
    const isLight = (displayC + displayR) % 2 !== 0;
    const isSelected = selectedPos === pos;
    const isLegalMove = legalMoves.includes(pos);
    const isCapture = isLegalMove && piece;

    // Show file label on the bottom row, rank label on the leftmost column
    const showFile = r === 7;
    const showRank = c === 0;

    return (
      <div
        key={pos}
        className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''} ${isCapture ? 'legal-capture' : ''}`}
        onClick={() => handleSquareClick(pos)}
      >
        {showRank && <span className="coord-label rank">{displayR + 1}</span>}
        {showFile && <span className="coord-label file">{FILES[displayC]}</span>}
        {isLegalMove && <div className="legal-move-hint" />}
        {piece && (
          <img
            src={PIECE_IMAGES[piece.color][piece.type]}
            alt={`${piece.color} ${piece.type}`}
            className="piece"
            draggable="false"
          />
        )}
      </div>
    );
  };

  // ──────── LOBBY ────────
  if (view === 'LOBBY') {
    return (
      <div className="chess-container" style={{ maxWidth: '900px' }}>
        <h1><span className="icon">♟</span>Chess App</h1>
        <p className="subtitle">Real-time multiplayer chess</p>

        <div className="lobby-grid">
          <div className="card">
            <span className="card-icon">⚡</span>
            <h2>Quick Match</h2>
            <p>Find a random opponent instantly</p>
            <button className="btn-green" onClick={handleFindGame}>Find Match</button>
          </div>

          <div className="card">
            <span className="card-icon">🤝</span>
            <h2>Play with Friend</h2>
            <p>Create a private room or join one</p>
            <button className="btn-blue" onClick={handleCreateGame} style={{ marginBottom: '10px' }}>Create Game</button>
            <form onSubmit={handleJoinGame} className="join-form">
              <input
                type="text"
                placeholder="Code"
                maxLength={3}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              />
              <button type="submit" className="btn-orange">Join Game</button>
            </form>
          </div>

          <div className="card list-card">
            <span className="card-icon">📡</span>
            <h2>Live Games</h2>
            <p>Watch active matches</p>
            <div className="item-list">
              {liveGames.length === 0 ? <p className="empty-msg">No active games right now</p> :
                liveGames.map(game => (
                  <div key={game.code} className="list-item" onClick={() => socket.emit('spectate_game', game.code)}>
                    <span>Room {game.code}</span>
                    <span className="badge">{game.moves} moves</span>
                  </div>
                ))
              }
            </div>
          </div>

          <div className="card list-card">
            <span className="card-icon">📜</span>
            <h2>Past Games</h2>
            <p>Review completed matches</p>
            <div className="item-list">
              {pastGames.length === 0 ? <p className="empty-msg">No past games yet</p> :
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

  // ──────── WAITING ────────
  if (view === 'WAITING') {
    return (
      <div className="chess-container">
        <h1>Waiting for Opponent</h1>
        <p className="subtitle">Share this code with a friend</p>
        <div className="room-code-display">{roomCode}</div>
        <p className="loading-pulse">Waiting for opponent to join…</p>
      </div>
    );
  }

  // ──────── SEARCHING ────────
  if (view === 'SEARCHING') {
    return (
      <div className="chess-container">
        <h1>Matchmaking</h1>
        <p className="subtitle">Looking for an opponent…</p>
        <div className="search-icon">♟</div>
        <p className="loading-pulse">Searching…</p>
      </div>
    );
  }

  // ──────── GAME / SPECTATING VIEW ────────
  const boardRows = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      boardRows.push(renderSquare(c, r));
    }
  }

  const handleHistoryClick = (idx) => {
    if (idx === board.history.length - 1) {
      setHistoryIndex(-1);
    } else {
      setHistoryIndex(idx);
    }
    setSelectedPos(null);
    setLegalMoves([]);
  };

  const isSpectating = view === 'SPECTATING';
  const isMyTurn = board.turn === playerColor;

  const statusText = historyIndex !== -1
    ? "Viewing History"
    : isSpectating
      ? `${board.turn === 'white' ? 'White' : 'Black'} to move`
      : isMyTurn ? "Your Turn" : "Opponent's Turn";

  const statusClass = historyIndex !== -1
    ? 'analyzing'
    : isMyTurn && !isSpectating ? '' : 'opponent-turn';

  return (
    <div className="chess-container game-layout">
      <div className="game-wrapper">
        <div className="game-header">
          <div className="room-badge">{isSpectating ? '📡 Spectating' : `Room ${roomCode}`}</div>
          <div className={`status-bar ${statusClass}`}>{statusText}</div>
        </div>
        <div className="board">{boardRows}</div>
        <div className="controls">
          <p>{isSpectating ? <b>Observer Mode</b> : <>Playing as <b>{playerColor}</b></>}</p>
          <button className="btn-red" onClick={() => { setView('LOBBY'); setBoard(new Board()); }}>Leave Game</button>
        </div>
      </div>

      <div className="history-panel">
        <h3>Moves</h3>
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
