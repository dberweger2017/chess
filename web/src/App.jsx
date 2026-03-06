import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Board } from './ChessEngine';
import { StockfishEngine } from './StockfishEngine';
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
  const stockfishRef = useRef(null);
  const [cpuThinking, setCpuThinking] = useState(false);
  const [cpuDepth, setCpuDepth] = useState(15);
  const [cpuMode, setCpuMode] = useState('depth'); // 'depth' or 'time'
  const [cpuTime, setCpuTime] = useState(3); // seconds
  const [engineStats, setEngineStats] = useState({}); // { moveIndex: { depth, timeMs } }

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
        const b = new Board();
        b.pieces = prevBoard.clonePieces();
        b.turn = prevBoard.turn;
        b.history = [...prevBoard.history];
        b.enPassantSquare = prevBoard.enPassantSquare;
        b.halfMoveClock = prevBoard.halfMoveClock;
        b.fullMoveNumber = prevBoard.fullMoveNumber;
        b.gameStatus = prevBoard.gameStatus;
        b.movePiece(startPos, endPos);
        return b;
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

  const handlePlayCPU = () => {
    const newBoard = new Board();
    setBoard(newBoard);
    setPlayerColor('white');
    setRoomCode('CPU');
    setView('VS_CPU');
    setEngineStats({});

    // Initialize Stockfish
    if (stockfishRef.current) stockfishRef.current.destroy();
    const sf = new StockfishEngine();
    sf.setMode(cpuMode);
    sf.setDepth(cpuDepth);
    sf.setMoveTime(cpuTime * 1000);
    sf.onBestMove = (uciMove, stats) => {
      const from = uciMove.substring(0, 2);
      const to = uciMove.substring(2, 4);
      setBoard(prevBoard => {
        const b = new Board();
        b.pieces = prevBoard.clonePieces();
        b.turn = prevBoard.turn;
        b.history = [...prevBoard.history];
        b.enPassantSquare = prevBoard.enPassantSquare;
        b.halfMoveClock = prevBoard.halfMoveClock;
        b.fullMoveNumber = prevBoard.fullMoveNumber;
        b.gameStatus = prevBoard.gameStatus;
        b.movePiece(from, to);
        // Record stats for this move index
        const moveIdx = b.history.length - 1;
        setEngineStats(prev => ({ ...prev, [moveIdx]: stats }));
        return b;
      });
      setCpuThinking(false);
    };
    stockfishRef.current = sf;
  };

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (joinCodeInput.trim().length === 3) {
      socket.emit('join_game', joinCodeInput.trim().toUpperCase());
    }
  };

  const handleSquareClick = (pos) => {
    const isVsCPU = view === 'VS_CPU';
    if (view !== 'GAME' && !isVsCPU) return;
    if (historyIndex !== -1) return;
    if (playerColor === 'spectator') return;
    if (board.turn !== playerColor) return;
    if (board.gameStatus !== 'active') return;
    if (cpuThinking) return;

    if (selectedPos) {
      if (legalMoves.includes(pos)) {
        const success = board.movePiece(selectedPos, pos);
        if (success) {
          const newHistoryItem = board.history[board.history.length - 1];
          if (!isVsCPU) {
            socket.emit('make_move', { code: roomCode, startPos: selectedPos, endPos: pos, newHistoryItem });
          }

          // Create a proper deep clone for React state
          const updatedBoard = new Board();
          updatedBoard.pieces = board.clonePieces();
          updatedBoard.turn = board.turn;
          updatedBoard.history = [...board.history];
          updatedBoard.enPassantSquare = board.enPassantSquare;
          updatedBoard.halfMoveClock = board.halfMoveClock;
          updatedBoard.fullMoveNumber = board.fullMoveNumber;
          updatedBoard.gameStatus = board.gameStatus;

          setBoard(updatedBoard);
          setSelectedPos(null);
          setLegalMoves([]);
          setHistoryIndex(-1);

          // If vs CPU, ask Stockfish
          if (isVsCPU && updatedBoard.gameStatus === 'active') {
            setCpuThinking(true);
            const fen = board.toFEN();
            setTimeout(() => {
              stockfishRef.current?.getBestMove(fen);
            }, 200);
          }
          return;
        }
      }
    }

    // Select a piece — use the new legal moves API
    const activePieces = historyIndex === -1 ? board.pieces : board.history[historyIndex].pieces;
    const piece = activePieces[pos];
    if (piece && piece.color === playerColor && piece.color === board.turn) {
      setSelectedPos(pos);
      setLegalMoves(board.getLegalMovesForPiece(pos));
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
            <span className="card-icon">🤖</span>
            <h2>Play vs Computer</h2>
            <p>Challenge Stockfish AI</p>

            {/* Mode toggle */}
            <div className="mode-toggle">
              <button className={`toggle-btn ${cpuMode === 'depth' ? 'active' : ''}`} onClick={() => setCpuMode('depth')}>By Depth</button>
              <button className={`toggle-btn ${cpuMode === 'time' ? 'active' : ''}`} onClick={() => setCpuMode('time')}>By Time</button>
            </div>

            {cpuMode === 'depth' ? (
              <div style={{ width: '100%', marginBottom: '14px' }}>
                <label className="slider-label">
                  <span>Search Depth</span>
                  <span className="slider-value">{cpuDepth}</span>
                </label>
                <input type="range" min={1} max={25} value={cpuDepth} onChange={(e) => setCpuDepth(Number(e.target.value))} className="range-input purple" />
                <div className="slider-ticks">
                  <span>Easy</span>
                  <span style={{ color: cpuDepth === 15 ? '#8b5cf6' : undefined }}>15 ★</span>
                  <span>Hard</span>
                </div>
              </div>
            ) : (
              <div style={{ width: '100%', marginBottom: '14px' }}>
                <label className="slider-label">
                  <span>Think Time</span>
                  <span className="slider-value">{cpuTime}s</span>
                </label>
                <input type="range" min={1} max={30} value={cpuTime} onChange={(e) => setCpuTime(Number(e.target.value))} className="range-input purple" />
                <div className="slider-ticks">
                  <span>1s</span>
                  <span style={{ color: cpuTime === 3 ? '#8b5cf6' : undefined }}>3s ★</span>
                  <span>30s</span>
                </div>
              </div>
            )}

            <button className="btn-green" onClick={handlePlayCPU} style={{ background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' }}>Start Game</button>
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

  // ──────── GAME / SPECTATING / VS_CPU VIEW ────────
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
  const isVsCPU = view === 'VS_CPU';
  const isMyTurn = board.turn === playerColor;

  const statusText = board.gameStatus === 'checkmate'
    ? `Checkmate! ${board.turn === 'white' ? 'Black' : 'White'} wins!`
    : board.gameStatus === 'stalemate'
      ? 'Stalemate \u2014 Draw!'
      : cpuThinking
        ? 'Engine is thinking\u2026'
        : historyIndex !== -1
          ? 'Viewing History'
          : isSpectating
            ? `${board.turn === 'white' ? 'White' : 'Black'} to move`
            : isMyTurn ? 'Your Turn' : (isVsCPU ? 'Engine is thinking\u2026' : "Opponent's Turn");

  const statusClass = board.gameStatus !== 'active'
    ? 'analyzing'
    : cpuThinking || historyIndex !== -1
      ? 'analyzing'
      : isMyTurn && !isSpectating ? '' : 'opponent-turn';

  return (
    <div className="chess-container game-layout">
      <div className="game-wrapper">
        <div className="game-header">
          <div className="room-badge">{isSpectating ? '📡 Spectating' : isVsCPU ? '🤖 vs Stockfish' : `Room ${roomCode}`}</div>
          <div className={`status-bar ${statusClass}`}>{statusText}</div>
        </div>
        <div className="board">{boardRows}</div>
        <div className="controls">
          <p>{isSpectating ? <b>Observer Mode</b> : isVsCPU ? <>You (White) vs <b>Stockfish</b></> : <>Playing as <b>{playerColor}</b></>}</p>
          <button className="btn-red" onClick={() => { setView('LOBBY'); setBoard(new Board()); if (stockfishRef.current) { stockfishRef.current.destroy(); stockfishRef.current = null; } }}>Leave Game</button>
        </div>
      </div>

      <div className="history-panel">
        <h3>Moves</h3>
        <div className="history-list">
          {board.history.map((snapshot, idx) => {
            const isActive = historyIndex === idx || (historyIndex === -1 && idx === board.history.length - 1);
            const stats = engineStats[idx];
            return (
              <div
                key={idx}
                className={`history-item ${isActive ? 'active' : ''}`}
                onClick={() => handleHistoryClick(idx)}
              >
                <span>{idx === 0 ? "Start" : `${idx}. ${snapshot.move}`}</span>
                {stats && (
                  <span className="engine-stats">d{stats.depth} · {(stats.timeMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default App;
