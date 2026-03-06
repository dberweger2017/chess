import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
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
  const [preMove, setPreMove] = useState(null); // { startPos, endPos }
  const [draggedPos, setDraggedPos] = useState(null); // The square currently being dragged from
  const [historyIndex, setHistoryIndex] = useState(-1);
  const stockfishRef = useRef(null);
  const [cpuThinking, setCpuThinking] = useState(false);
  const [cpuDepth, setCpuDepth] = useState(15);
  const [cpuMode, setCpuMode] = useState('depth'); // 'depth' or 'time'
  const [cpuTime, setCpuTime] = useState(3); // seconds
  const [engineStats, setEngineStats] = useState({}); // { moveIndex: { depth, timeMs } }

  // Analysis mode
  const [analysisLines, setAnalysisLines] = useState([]);
  const [analysisCache, setAnalysisCache] = useState({}); // { fen: lines[] }
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzerRef = useRef(null);

  // Auto Game Analysis
  const [gameAnalysis, setGameAnalysis] = useState([]); // Array of analysis results
  const gameAnalysisRef = useRef([]); // Persistent cache for incremental analysis
  const [analysisProgress, setAnalysisProgress] = useState(null); // { current, total }

  // Multiplayer states
  const [view, setView] = useState('LOBBY');
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [playerColor, setPlayerColor] = useState(null);
  const [errorStatus, setErrorStatus] = useState('');

  // Game explorer
  const [liveGames, setLiveGames] = useState([]);
  const [pastGames, setPastGames] = useState([]);
  const [pendingAnalysisId, setPendingAnalysisId] = useState(null);
  const [savedGameId, setSavedGameId] = useState(null);
  const [waitingCount, setWaitingCount] = useState(0);

  // User Profile
  const [userProfile, setUserProfile] = useState(() => {
    const saved = localStorage.getItem('chess_profile');
    return saved ? JSON.parse(saved) : { name: '', cyberNumber: '' };
  });
  const [tempProfile, setTempProfile] = useState({ name: '', cyberNumber: '' });
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    socket.on('game_created', ({ code, color }) => {
      window.history.pushState({}, '', '/?game=' + code);
      setRoomCode(code);
      setPlayerColor(color);
      setView('WAITING');
    });

    socket.on('game_joined', ({ code, color }) => {
      window.history.pushState({}, '', '/?game=' + code);
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
    socket.on('waiting_count', (count) => setWaitingCount(count));

    socket.on('cpu_game_created', (code) => {
      setRoomCode(code);
      setView('VS_CPU');
      window.history.pushState({}, '', '/?game=' + code);
      initStockfish(code);
    });

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

        // Apply the opponent's move first
        b.movePiece(startPos, endPos);

        // Then check if it's my turn now and I have a pre-move queued
        if (b.turn === playerColor && preMove) {
          // Validate pre-move against new board state
          const pMoves = b.getLegalMovesForPiece(preMove.startPos);
          if (pMoves.includes(preMove.endPos)) {
            b.movePiece(preMove.startPos, preMove.endPos);
            socket.emit('make_move', {
              code: roomCode,
              startPos: preMove.startPos,
              endPos: preMove.endPos,
              newHistoryItem: b.history[b.history.length - 1]
            });
          }
          // Clear pre-move whether valid or not
          setPreMove(null);
        }

        return b;
      });
      setHistoryIndex(-1);
    });

    socket.on('opponent_disconnected', () => {
      // If the game was already over, just let them review the board.
      // Otherwise notify them it ended abruptly.
      if (document.querySelector('.status-bar')?.textContent?.includes('Checkmate') ||
        document.querySelector('.status-bar')?.textContent?.includes('Stalemate')) {
        console.log("Opponent left finished game.");
      } else {
        alert("Opponent disconnected!");
        window.history.pushState({}, '', '/');
        setView('LOBBY');
        setBoard(new Board());
      }
    });

    socket.on('game_saved', (id) => {
      setSavedGameId(id);
      window.open('/?analysis=' + id, '_blank');
      socket.emit('get_past_games'); // Refresh games list
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
      socket.off('game_saved');
      socket.off('waiting_count');
      socket.off('cpu_game_created');
    };
  }, []);

  useEffect(() => {
    if (view === 'LOBBY') {
      const urlParams = new URLSearchParams(window.location.search);
      const isRedirecting = urlParams.get('game') || urlParams.get('spectate') || urlParams.get('analysis');

      if (!isRedirecting) {
        window.history.pushState({}, '', '/');
      }

      socket.emit('get_live_games');
      socket.emit('get_past_games');
      socket.emit('get_waiting_count');

      // Auto-join from URL if specified
      const gameCode = urlParams.get('game');
      if (gameCode && joinCodeInput !== gameCode) {
        setJoinCodeInput(gameCode);
        socket.emit('join_game', gameCode.toUpperCase());
      }
    }
  }, [view]);

  // Keyboard History Navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (view === 'LOBBY' || view === 'WAITING' || view === 'SEARCHING') return;

      if (e.key === 'ArrowLeft') {
        setHistoryIndex(prev => {
          let newIdx = prev;
          if (prev === -1) {
            if (board.history.length > 1) newIdx = board.history.length - 2;
          } else if (prev > 0) {
            newIdx = prev - 1;
          }

          if (newIdx !== prev) {
            setSelectedPos(null);
            setLegalMoves([]);
            setIsAnalyzing(false);
            setAnalysisLines([]);
          }
          return newIdx;
        });
      } else if (e.key === 'ArrowRight') {
        setHistoryIndex(prev => {
          let newIdx = prev;
          if (prev !== -1) {
            if (prev < board.history.length - 2) {
              newIdx = prev + 1;
            } else {
              newIdx = -1;
            }
          }

          if (newIdx !== prev) {
            setSelectedPos(null);
            setLegalMoves([]);
            setIsAnalyzing(false);
            setAnalysisLines([]);
          }
          return newIdx;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [board.history.length, view]);

  // Auto Analysis URL Trigger
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const analysisId = urlParams.get('analysis') || pendingAnalysisId;
    const spectateCode = urlParams.get('spectate');

    if (spectateCode) {
      socket.emit('spectate_game', spectateCode);
    } else if (analysisId && pastGames.length > 0) {
      const gameToAnalyze = pastGames.find(g => g.id === parseInt(analysisId));
      if (gameToAnalyze) {
        setRoomCode(gameToAnalyze.room_code);
        const reviewBoard = new Board();
        const moves = JSON.parse(gameToAnalyze.moves);
        reviewBoard.history = moves;

        if (moves.length > 0) {
          const lastSnap = moves[moves.length - 1];
          reviewBoard.pieces = lastSnap.pieces;
          reviewBoard.turn = moves.length % 2 === 1 ? 'black' : 'white';
        }
        reviewBoard.gameStatus = 'ended'; // Force ended status

        setBoard(reviewBoard);
        setHistoryIndex(-1);
        setView('REVIEW');
        setPendingAnalysisId(null);

        if (gameToAnalyze.analysis) {
          // Already have cached analysis! Use it immediately
          setGameAnalysis(JSON.parse(gameToAnalyze.analysis));
        } else if (!analyzerRef.current || !analyzerRef.current._isAnalyzing) {
          // Start the auto analysis sequence
          runAutoAnalysis(reviewBoard, gameToAnalyze.id);
        }
      }
    }
  }, [pastGames, pendingAnalysisId]);

  const runAutoAnalysis = (finalBoard, gameId = null) => {
    if (!analyzerRef.current) analyzerRef.current = new StockfishEngine();
    const analyzer = analyzerRef.current;

    // Generate FEN array for the whole game
    const allFens = [];
    const tmpBoard = new Board();

    for (let i = 0; i < finalBoard.history.length; i++) {
      const snap = finalBoard.history[i];
      tmpBoard.pieces = snap.pieces;
      tmpBoard.turn = (i % 2 === 0) ? 'white' : 'black';
      tmpBoard.enPassantSquare = snap.enPassantSquare;
      tmpBoard.halfMoveClock = snap.halfMoveClock;
      allFens.push(tmpBoard.toFEN());
    }

    const cached = gameAnalysisRef.current;

    // Clear cache if we switch to a different game or a completely new board
    if (finalBoard.history.length === 0 || (cached.length > 0 && cached[0].fen !== allFens[0])) {
      gameAnalysisRef.current = [];
      setGameAnalysis([]);
    }

    const unanalyzedFens = allFens.slice(gameAnalysisRef.current.length);
    if (unanalyzedFens.length === 0) {
      setGameAnalysis([...gameAnalysisRef.current]);
      return;
    }

    analyzer.analyzeGame(unanalyzedFens, 10, (current, total) => {
      setAnalysisProgress({ current, total });
    }, (results) => {
      // Append new analysis to the ref
      const startIdx = gameAnalysisRef.current.length;
      results.forEach((r, i) => {
        gameAnalysisRef.current.push({ ...r, moveIdx: startIdx + i });
      });

      setGameAnalysis([...gameAnalysisRef.current]);
      setAnalysisProgress(null);

      // Save to server if we have a full game ID
      if (gameId) {
        socket.emit('save_game_analysis', { id: gameId, analysis: gameAnalysisRef.current });
      }

      // If new moves arrived while we were analyzing, they won't be in the cache. 
      // The useEffect will trigger this again, but we can proactively trigger just in case:
      if (board.history.length > finalBoard.history.length && view === 'SPECTATING') {
        runAutoAnalysis(board);
      }
    });
  };

  // Live Spectator Analysis Trigger
  useEffect(() => {
    if (view === 'SPECTATING' && board.history.length > 0) {
      runAutoAnalysis(board);
    }
  }, [board.history.length, view]);

  const handleCreateGameLegacy = () => socket.emit('create_game');
  const handleFindGameLegacy = () => socket.emit('find_game');
  const handleCancelFindGame = () => {
    socket.emit('cancel_find_game');
    setView('LOBBY');
  };

  // Helper to save CPU game to DB
  const saveCpuGame = (b) => {
    if (b && b.history && b.history.length > 1) {
      socket.emit('save_cpu_game', { history: b.history });
    }
  };

  const handlePlayCPU = () => {
    socket.emit('create_cpu_game');
    const newBoard = new Board();
    setBoard(newBoard);
    setPlayerColor('white');
    setRoomCode('CPU (WAITING...)');
    setEngineStats({});
  };

  const initStockfish = (code) => {
    // Initialize Stockfish with a specific room code
    if (stockfishRef.current) stockfishRef.current.destroy();
    const sf = new StockfishEngine();
    sf.setMode(cpuMode);
    sf.setDepth(cpuDepth);
    sf.setMoveTime(cpuTime * 1000);
    sf.onBestMove = (uciMove, stats) => {
      const from = uciMove.substring(0, 2);
      const to = uciMove.substring(2, 4);
      let updatedB = null;
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

        // Sync CPU move to server room using the code passed to initStockfish
        const newHistoryItem = b.history[b.history.length - 1];
        socket.emit('make_move', { code: code, startPos: from, endPos: to, newHistoryItem });

        // Record stats for this move index
        const moveIdx = b.history.length - 1;
        setEngineStats(prev => ({ ...prev, [moveIdx]: stats }));

        // Execute pre-move if present and valid
        if (preMove) {
          const pMoves = b.getLegalMovesForPiece(preMove.startPos);
          if (pMoves.includes(preMove.endPos)) {
            b.movePiece(preMove.startPos, preMove.endPos);
            // Trigger the engine's next move after our pre-move
            setTimeout(() => {
              stockfishRef.current?.getBestMove(b.toFEN());
            }, 200);
          } else {
            // Pre-move was invalid, it's just our turn now
            setCpuThinking(false);
          }
          setPreMove(null);
        } else {
          setCpuThinking(false);
        }

        updatedB = b;
        return b;
      });
      setCpuThinking(false);

      if (updatedB && updatedB.gameStatus !== 'active') {
        saveCpuGame(updatedB);
      }
    };
    stockfishRef.current = sf;
  };

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (joinCodeInput.trim().length === 3) {
      socket.emit('join_game', {
        code: joinCodeInput.trim().toUpperCase(),
        profile: userProfile
      });
    }
  };

  const handleCreateGame = () => {
    socket.emit('create_game', { profile: userProfile });
  };

  const handleFindGame = () => {
    socket.emit('find_game', { profile: userProfile });
  };

  const saveProfile = () => {
    if (!tempProfile.name.trim() || !tempProfile.cyberNumber.trim()) {
      setProfileError('Incomplete Protocol. Fill all fields.');
      return;
    }
    const profile = {
      name: tempProfile.name.trim(),
      cyberNumber: tempProfile.cyberNumber.trim()
    };
    localStorage.setItem('chess_profile', JSON.stringify(profile));
    setUserProfile(profile);
  };

  const IdentityModal = () => (
    <div className="identity-overlay">
      <div className="identity-modal">
        <h2>Identity Setup</h2>
        <p>Your signature is required to access the neural chess network. Please provide your handle and identification number.</p>
        <div className="identity-form">
          <div className="input-block">
            <label>Shadow Handle</label>
            <input
              type="text"
              className="cyber-input"
              placeholder="e.g. ZeroCool"
              value={tempProfile.name}
              onChange={e => setTempProfile(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="input-block">
            <label>Cyber Number</label>
            <input
              type="text"
              className="cyber-input"
              placeholder="e.g. 7749-X"
              value={tempProfile.cyberNumber}
              onChange={e => setTempProfile(prev => ({ ...prev, cyberNumber: e.target.value }))}
            />
          </div>
          <button className="btn-cyber" onClick={saveProfile}>
            Authorize Access
          </button>
          {profileError && <div className="cyber-status">{profileError}</div>}
        </div>
      </div>
    </div>
  );

  const handleSquareClick = (pos) => {
    // If we just finished dragging, don't trigger a click on the same frame.
    // The drag handlers manage movement. We keep click logic for click-to-move.
    const isVsCPU = view === 'VS_CPU';
    if (view !== 'GAME' && !isVsCPU) return;
    if (historyIndex !== -1) return;
    if (playerColor === 'spectator') return;
    if (board.gameStatus !== 'active') return;

    // --- Opponent's Turn: Handle Pre-moves ---
    if (board.turn !== playerColor) {
      if (cpuThinking) return;

      // If clicking outside, cancel pre-move and selection
      if (preMove) {
        setPreMove(null);
        setSelectedPos(null);
        setLegalMoves([]);
        return;
      }

      const piece = board.pieces[pos];
      if (selectedPos) {
        // Only allow "pseudo-legal" moves for pre-moves since board state will change
        // For simplicity, we just check if it's a generally valid move for that piece on the CURRENT board.
        // It gets validated properly when the turn arrives.
        if (legalMoves.includes(pos)) {
          setPreMove({ startPos: selectedPos, endPos: pos });
          setSelectedPos(null);
          setLegalMoves([]);
        } else if (piece && piece.color === playerColor) {
          // Switch pre-move piece selection
          setSelectedPos(pos);
          setLegalMoves(board.getLegalMovesForPiece(pos));
        } else {
          // Cancel selection
          setSelectedPos(null);
          setLegalMoves([]);
        }
      } else if (piece && piece.color === playerColor) {
        setSelectedPos(pos);
        setLegalMoves(board.getLegalMovesForPiece(pos));
      }
      return;
    }

    // --- My Turn ---
    // If I had a pre-move queued somehow, cancel it
    if (preMove) setPreMove(null);

    if (selectedPos) {
      if (legalMoves.includes(pos)) {
        const success = board.movePiece(selectedPos, pos);
        if (success) {
          const newHistoryItem = board.history[board.history.length - 1];
          // Emit move even in VS_CPU if we have a server room code
          socket.emit('make_move', { code: roomCode, startPos: selectedPos, endPos: pos, newHistoryItem });

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

          // Trigger save if game ended in multiplayer
          if (!isVsCPU && updatedBoard.gameStatus !== 'active') {
            socket.emit('save_multiplayer_game', { code: roomCode, history: updatedBoard.history });
          }

          // If vs CPU, ask Stockfish or save if game over
          if (isVsCPU) {
            if (updatedBoard.gameStatus === 'active') {
              setCpuThinking(true);
              const fen = board.toFEN();
              setTimeout(() => {
                stockfishRef.current?.getBestMove(fen);
              }, 200);
            } else {
              saveCpuGame(updatedBoard);
            }
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

  // ──────── DRAG AND DROP HANDLERS ────────

  const onDragStart = (e, pos) => {
    // Only allow drag if it's our color and game is active
    const activePieces = historyIndex === -1 ? board.pieces : board.history[historyIndex].pieces;
    const piece = activePieces[pos];

    if (!piece || piece.color !== playerColor) {
      e.preventDefault();
      return;
    }

    // We can drag on our turn (normal move) or opponent turn (pre-move)
    if (view !== 'GAME' && view !== 'VS_CPU') {
      e.preventDefault();
      return;
    }

    if (historyIndex !== -1 || board.gameStatus !== 'active' || (board.turn !== playerColor && cpuThinking)) {
      e.preventDefault();
      return;
    }

    // Pre-select the piece so legal moves show up instantly during drag
    setSelectedPos(pos);
    setLegalMoves(board.getLegalMovesForPiece(pos));
    setDraggedPos(pos);

    // Custom drag image (hide default to make it look cleaner, or leave it)
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires some data to be set
    e.dataTransfer.setData('text/plain', pos);
  };

  const onDragOver = (e, pos) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (e, pos) => {
    e.preventDefault();
    if (!draggedPos) return;

    // Simulate a click on the destination square to leverage existing move/pre-move logic
    // We temporarily select the dragged pos just in case, then trigger click
    if (legalMoves.includes(pos)) {
      handleSquareClick(pos);
    } else {
      // Invalid drop, clear selection
      setSelectedPos(null);
      setLegalMoves([]);
    }
    setDraggedPos(null);
  };

  const onDragEnd = () => {
    setDraggedPos(null);
  };

  const AnalysisArrows = () => {
    if (analysisLines.length === 0) return null;

    // Helper to get square center in pixels (board is 8 * var(--sq))
    // board size is boardSize, square size is boardSize / 8
    const getSquareCenter = (pos) => {
      const [c, r] = Board.posToCoord(pos);
      // c, r are 0-7 from white's perspective
      // We need to account for board flipping (playerColor === 'black')
      let displayC = playerColor === 'black' ? 7 - c : c;
      let displayR = playerColor === 'black' ? r : 7 - r;

      // Center of sq (50% of square size)
      const x = (displayC + 0.5) * (100 / 8);
      const y = (displayR + 0.5) * (100 / 8);
      return { x: `${x}%`, y: `${y}%` };
    };

    // Calculate relative weights for arrows
    // We normalize scores to a 0-1 range among the top 5
    const parsedLines = analysisLines.map(line => {
      let numericScore = 0;
      if (line.score.startsWith('M')) {
        numericScore = line.score.includes('-') ? -10000 : 10000;
      } else {
        numericScore = parseFloat(line.score) * 100;
      }
      return { ...line, numericScore };
    });

    const maxScore = Math.max(...parsedLines.map(l => l.numericScore));
    const minScore = Math.min(...parsedLines.map(l => l.numericScore));
    const range = maxScore - minScore || 1;

    return (
      <svg className="analysis-arrows-overlay" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10
      }}>
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(0, 242, 255, 0.8)" />
          </marker>
        </defs>
        {parsedLines.map((line, idx) => {
          const move = line.moves[0];
          if (!move) return null;
          const fromPos = move.slice(0, 2);
          const toPos = move.slice(2, 4);

          const from = getSquareCenter(fromPos);
          const to = getSquareCenter(toPos);

          // Weight from 0.3 to 1.0
          const weight = 0.3 + (parsedLines.length > 1 ? (line.numericScore - minScore) / range : 0.7) * 0.7;
          const thickness = 4 + weight * 8;
          const opacity = 0.2 + weight * 0.8;

          return (
            <line
              key={idx}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(0, 242, 255, 0.6)"
              strokeWidth={thickness}
              strokeOpacity={opacity}
              markerEnd="url(#arrowhead)"
              style={{ transition: 'all 0.3s ease' }}
            />
          );
        })}
      </svg>
    );
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
        className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''} ${isCapture ? 'legal-capture' : ''} ${draggedPos === pos ? 'dragging' : ''}`}
        onClick={() => handleSquareClick(pos)}
        onDragOver={(e) => onDragOver(e, pos)}
        onDrop={(e) => onDrop(e, pos)}
      >
        {showRank && <span className="coord-label rank">{displayR + 1}</span>}
        {showFile && <span className="coord-label file">{FILES[displayC]}</span>}
        {isLegalMove && <div className="legal-move-hint" />}
        {piece && (
          <img
            src={PIECE_IMAGES[piece.color][piece.type]}
            alt={`${piece.color} ${piece.type}`}
            className="piece"
            draggable={piece.color === playerColor && historyIndex === -1 && board.gameStatus === 'active'}
            onDragStart={(e) => onDragStart(e, pos)}
            onDragEnd={onDragEnd}
          />
        )}
      </div>
    );
  };

  if (!userProfile.name || !userProfile.cyberNumber) {
    return (
      <div id="app-root">
        <IdentityModal />
      </div>
    );
  }

  // ──────── LOBBY ────────
  if (view === 'LOBBY') {
    return (
      <div className="chess-container" style={{ maxWidth: '900px' }}>
        <h1>
          <span className="icon">♟️</span> Cyber Chess
        </h1>
        <p className="subtitle">Secure Neural Link Established</p>

        <div className="lobby-grid">
          <div className="card">
            <span className="card-icon">⚡</span>
            <h2>Quick Match</h2>
            <p>Find a random opponent instantly</p>
            <div style={{ marginBottom: '10px', fontSize: '13px', color: 'var(--text-muted)' }}>
              {waitingCount === 1 ? '1 person looking for a match' : `${waitingCount} people waiting`}
            </div>
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
                  <div key={game.code} className="list-item" onClick={() => window.open(`/?spectate=${game.code}`, '_blank')}>
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
                pastGames.map(game => {
                  const moves = game.moves ? JSON.parse(game.moves) : [];
                  const moveCount = Math.max(0, moves.length - 1);
                  return (
                    <div key={game.id} className="list-item" onClick={() => window.open(`/?analysis=${game.id}`, '_blank')}>
                      <span>{game.room_code} · {moveCount} moves</span>
                      <span className="badge">{(new Date(game.ended_at)).toLocaleDateString()}</span>
                    </div>
                  );
                })
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
        <button className="btn-red" onClick={handleCancelFindGame} style={{ marginTop: '20px' }}>Cancel Search</button>
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
    // Stop current analysis when navigating
    setIsAnalyzing(false);
    setAnalysisLines([]);
  };

  // Analysis: compute FEN for the current position being viewed
  const getViewedFEN = () => {
    // Build a temporary board from the history snapshot
    const snapshot = historyIndex === -1
      ? board.history[board.history.length - 1]
      : board.history[historyIndex];
    if (!snapshot) return null;
    const tmpBoard = new Board();
    tmpBoard.pieces = snapshot.pieces;
    const moveNum = historyIndex === -1 ? board.history.length - 1 : historyIndex;
    tmpBoard.turn = moveNum % 2 === 0 ? 'white' : 'black';
    return tmpBoard.toFEN();
  };

  const handleAnalyze = () => {
    const fen = getViewedFEN();
    if (!fen) return;

    // Check cache first
    if (analysisCache[fen]) {
      setAnalysisLines(analysisCache[fen]);
      setIsAnalyzing(false);
      return;
    }

    // Start analysis
    if (!analyzerRef.current) {
      analyzerRef.current = new StockfishEngine();
    }
    const analyzer = analyzerRef.current;
    setIsAnalyzing(true);
    setAnalysisLines([]);

    analyzer.onAnalysisUpdate = (lines) => {
      setAnalysisLines([...lines]);
    };
    analyzer.onAnalysisDone = (lines) => {
      setAnalysisLines([...lines]);
      setAnalysisCache(prev => ({ ...prev, [fen]: [...lines] }));
      setIsAnalyzing(false);
    };

    // Small timeout to let the engine finish initialization if needed
    setTimeout(() => analyzer.analyzePosition(fen, 5, 25), 100);
  };

  const isSpectating = view === 'SPECTATING';
  const isVsCPU = view === 'VS_CPU';
  const isReview = view === 'REVIEW';
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
          <div className="room-badge">{isReview ? '📜 Review' : isSpectating ? '📡 Spectating' : isVsCPU ? '🤖 vs Stockfish' : `Room ${roomCode}`}</div>
          {view === 'GAME' && (
            <button className="btn-ghost" onClick={() => window.open(`/?spectate=${roomCode}`, '_blank')} style={{ fontSize: '11px', padding: '4px 8px', marginLeft: 'auto' }}>
              🔍 Live Spectator Analysis
            </button>
          )}
          <div className={`status-bar ${statusClass}`} style={{ marginLeft: view === 'GAME' ? '8px' : 'auto' }}>{statusText}</div>
        </div>
        <div className="board" style={{ position: 'relative' }}>
          <AnalysisArrows />
          {boardRows}
        </div>
        <div className="controls">
          <p>{isReview ? <b>Game Review</b> : isSpectating ? <b>Observer Mode</b> : isVsCPU ? <>You (White) vs <b>Stockfish</b></> : <>Playing as <b>{playerColor}</b></>}</p>
          <button className="btn-red" onClick={() => {
            if (isVsCPU) saveCpuGame(board);
            setView('LOBBY'); setBoard(new Board());
            if (stockfishRef.current) { stockfishRef.current.destroy(); stockfishRef.current = null; }
            if (analyzerRef.current) { analyzerRef.current.destroy(); analyzerRef.current = null; }
            setAnalysisLines([]); setIsAnalyzing(false);
          }}>Leave</button>
        </div>
      </div>

      <div className="history-panel">
        <h3>Moves</h3>

        {/* Evaluation Chart */}
        {gameAnalysis.length > 0 && (
          <div className="evaluation-chart" style={{ height: '100px', marginBottom: '12px', background: 'rgba(0,0,0,0.2)', padding: '5px', borderRadius: '8px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={gameAnalysis}>
                <YAxis domain={[-10, 10]} hide />
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
                  contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', fontSize: '11px', borderRadius: '4px' }}
                  labelFormatter={(idx) => `Move ${idx}`}
                  formatter={(value) => [Number(value).toFixed(2), 'Eval']}
                />
                <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="numericScore" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Analysis Progress Bar */}
        {analysisProgress && (
          <div className="analysis-progress-container" style={{ marginBottom: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '4px', width: `${(analysisProgress.current / analysisProgress.total) * 100}%`, background: 'var(--green)', transition: 'width 0.2s' }}></div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', padding: '4px' }}>
              Analyzing game {Math.min(analysisProgress.current + 1, analysisProgress.total)} / {analysisProgress.total}...
            </div>
          </div>
        )}

        <div className="history-list">
          {board.history.map((snapshot, idx) => {
            const isActive = historyIndex === idx || (historyIndex === -1 && idx === board.history.length - 1);
            const stats = engineStats[idx];
            // Analysis of the position BEFORE this move was made
            const analysis = idx > 0 ? gameAnalysis[idx - 1] : null;
            return (
              <div
                key={idx}
                className={`history-item ${isActive ? 'active' : ''}`}
                onClick={() => handleHistoryClick(idx)}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>{idx === 0 ? "Start" : `${idx}. ${snapshot.move}`}</span>
                  {stats && (
                    <span className="engine-stats">d{stats.depth} · {(stats.timeMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
                {analysis && idx > 0 && (
                  <div className="move-analysis" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                    <span style={{ color: analysis.numericScore > 0 ? '#4ade80' : analysis.numericScore < -0 ? '#f87171' : '#9ca3af' }}>{analysis.score}</span>
                    <span>Best: {analysis.bestMove}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Analysis button — show in review mode, or when viewing history in any game */}
        {(isReview || isVsCPU || isSpectating || historyIndex !== -1) && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className="btn-ghost" onClick={handleAnalyze} disabled={isAnalyzing} style={{ fontSize: '13px', padding: '8px' }}>
              {isAnalyzing ? 'Analyzing Position…' : '🔍 Analyze This Position Here'}
            </button>
            <button className="btn-blue"
              onClick={() => {
                const analysisId = savedGameId;
                if (analysisId) {
                  window.open('/?analysis=' + analysisId, '_blank');
                } else {
                  window.open('/?spectate=' + roomCode, '_blank');
                }
              }}
              style={{ fontSize: '13px', padding: '8px' }}>
              📊 Analyze Full Game in New Tab
            </button>
          </div>
        )}

        {/* Analysis results */}
        {analysisLines.length > 0 && (
          <div className="analysis-panel">
            <h4>Engine Lines {isAnalyzing && <span className="loading-dot">●</span>}</h4>
            {analysisLines.map((line, i) => (
              <div key={i} className="analysis-line">
                <span className="analysis-score">{line.score}</span>
                <span className="analysis-moves">{line.moves.join(' ')}</span>
                <span className="analysis-depth">d{line.depth}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
