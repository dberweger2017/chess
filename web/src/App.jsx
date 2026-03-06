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
const REVIEW_ANALYSIS_DEPTH = 10;
const LIVE_ANALYSIS_DEPTH = 24;
const ANALYSIS_LINE_COUNT = 3;
const ANALYSIS_SCHEMA_VERSION = 2;
const MAX_UI_EVAL = 12;

// Connect to the Node server (using default host for reverse proxy support)
const socket = io();

function getSnapshotTurn(snapshot, index) {
  return snapshot?.turn || (index % 2 === 0 ? 'white' : 'black');
}

function getSnapshotFullMoveNumber(snapshot, index) {
  return snapshot?.fullMoveNumber || Math.floor(index / 2) + 1;
}

function createBoardFromHistory(history, { ended = false } = {}) {
  const nextBoard = new Board();
  if (!Array.isArray(history) || history.length === 0) return nextBoard;

  const lastSnapshot = history[history.length - 1];
  nextBoard.history = history;
  nextBoard.pieces = lastSnapshot.pieces;
  nextBoard.turn = getSnapshotTurn(lastSnapshot, history.length - 1);
  nextBoard.enPassantSquare = lastSnapshot.enPassantSquare || null;
  nextBoard.halfMoveClock = lastSnapshot.halfMoveClock || 0;
  nextBoard.fullMoveNumber = getSnapshotFullMoveNumber(lastSnapshot, history.length - 1);
  nextBoard.gameStatus = ended ? 'ended' : (lastSnapshot.gameStatus || nextBoard.gameStatus);

  return nextBoard;
}

function getFenFromSnapshot(snapshot, index) {
  if (!snapshot) return null;

  const tmpBoard = new Board();
  tmpBoard.pieces = snapshot.pieces;
  tmpBoard.turn = getSnapshotTurn(snapshot, index);
  tmpBoard.enPassantSquare = snapshot.enPassantSquare || null;
  tmpBoard.halfMoveClock = snapshot.halfMoveClock || 0;
  tmpBoard.fullMoveNumber = getSnapshotFullMoveNumber(snapshot, index);
  return tmpBoard.toFEN();
}

function buildFenList(history) {
  return history.map((snapshot, index) => getFenFromSnapshot(snapshot, index));
}

function buildAnalysisPackage(positions, depth) {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    depth,
    numLines: ANALYSIS_LINE_COUNT,
    positions
  };
}

function normalizeStoredAnalysis(rawAnalysis, expectedLength, minimumDepth) {
  if (!rawAnalysis) return null;

  try {
    const parsed = typeof rawAnalysis === 'string' ? JSON.parse(rawAnalysis) : rawAnalysis;
    if (!parsed || parsed.schemaVersion !== ANALYSIS_SCHEMA_VERSION || !Array.isArray(parsed.positions)) {
      return null;
    }

    if (parsed.positions.length !== expectedLength || (parsed.depth || 0) < minimumDepth) {
      return null;
    }

    const hasTopLines = parsed.positions.every((position) => position && Array.isArray(position.topLines));
    return hasTopLines ? parsed.positions : null;
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatGameOutcome(game) {
  if (game.result === 'draw') return '🤝 Tablas';
  if (game.termination === 'resignation') return 'Resignation';
  if (game.termination === 'checkmate') return 'Checkmate';
  if (game.termination === 'disconnect') return 'Disconnect';
  if (game.termination === 'stalemate') return 'Stalemate';
  return 'Finished';
}

function formatParticipantLabel(name, winnerColor, color, currentUserName) {
  const fallback = color === 'white' ? 'White' : 'Black';
  const currentUser = currentUserName?.trim().toLowerCase();
  const participant = name?.trim();
  const label = currentUser && participant && participant.toLowerCase() === currentUser
    ? 'YOU'
    : (participant || fallback);

  return winnerColor === color ? `👑 ${label}` : label;
}

function buildPrecisionStats(history, analysis) {
  const totals = {
    white: { loss: 0, moves: 0 },
    black: { loss: 0, moves: 0 }
  };

  for (let idx = 1; idx < history.length; idx += 1) {
    const before = analysis[idx - 1];
    const after = analysis[idx];
    if (!before || !after) continue;

    const mover = idx % 2 === 1 ? 'white' : 'black';
    const expected = getComparableNumericScore(before);
    const actual = -getComparableNumericScore(after);
    const loss = Math.max(0, expected - actual);

    totals[mover].loss += loss;
    totals[mover].moves += 1;
  }

  const makeStat = (color) => {
    const moveCount = totals[color].moves;
    const averageLoss = moveCount > 0 ? totals[color].loss / moveCount : 0;
    const precision = clamp(100 - averageLoss * 12, 0, 100);

    return {
      color,
      moves: moveCount,
      averageLoss,
      precision
    };
  };

  return {
    white: makeStat('white'),
    black: makeStat('black')
  };
}

function getComparableNumericScore(analysisEntry) {
  if (!analysisEntry) return 0;

  if (typeof analysisEntry.score === 'string' && analysisEntry.score.startsWith('M')) {
    return analysisEntry.score.includes('-') ? -MAX_UI_EVAL : MAX_UI_EVAL;
  }

  const numericScore = Number(analysisEntry.numericScore ?? analysisEntry.score ?? 0);
  if (!Number.isFinite(numericScore)) return 0;
  return clamp(numericScore, -MAX_UI_EVAL, MAX_UI_EVAL);
}

function getWhitePerspectiveEval(snapshot, analysisEntry, index) {
  if (!analysisEntry) return null;
  const sideToMove = getSnapshotTurn(snapshot, index);
  const sidePerspective = getComparableNumericScore(analysisEntry);
  return sideToMove === 'white' ? sidePerspective : -sidePerspective;
}

function formatPlyLabel(snapshot, index) {
  if (index === 0) return 'Start';
  const moveNumber = Math.ceil(index / 2);
  return index % 2 === 1
    ? `${moveNumber}. ${snapshot.move}`
    : `${moveNumber}... ${snapshot.move}`;
}

function formatEvalLabel(whiteEval) {
  if (whiteEval == null) return 'No eval';
  if (Math.abs(whiteEval) < 0.05) return 'Equal';
  return `${whiteEval > 0 ? 'White' : 'Black'} +${Math.abs(whiteEval).toFixed(2)}`;
}

function formatSwingLabel(swing) {
  if (!Number.isFinite(swing) || Math.abs(swing) < 0.05) return 'No major swing';
  return `${swing > 0 ? 'White' : 'Black'} ${swing > 0 ? '+' : '-'}${Math.abs(swing).toFixed(2)}`;
}

function buildEvaluationChartData(history, analysis) {
  const pointCount = Math.min(history.length, analysis.length);
  if (pointCount === 0) return [];

  return history.slice(0, pointCount).map((snapshot, index) => {
    const evalAfterMove = getWhitePerspectiveEval(snapshot, analysis[index], index);
    const previousEval = index > 0
      ? getWhitePerspectiveEval(history[index - 1], analysis[index - 1], index - 1)
      : 0;
    const swing = index > 0 && evalAfterMove != null && previousEval != null
      ? evalAfterMove - previousEval
      : 0;
    const preMoveAnalysis = index > 0 ? analysis[index - 1] : null;

    return {
      index,
      ply: index,
      moveLabel: formatPlyLabel(snapshot, index),
      moveText: index === 0 ? 'Start position' : snapshot.move,
      eval: evalAfterMove ?? 0,
      evalText: formatEvalLabel(evalAfterMove),
      swing,
      swingText: formatSwingLabel(swing),
      score: analysis[index]?.score || '0.00',
      bestMoveBefore: index === 0
        ? (analysis[index]?.bestMove || null)
        : (preMoveAnalysis?.bestMove || null)
    };
  });
}

function EvaluationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="evaluation-tooltip">
      <strong>{point.moveLabel}</strong>
      <span>{point.evalText}</span>
      <span>{point.swingText}</span>
      {point.bestMoveBefore && <span>Engine best before move: {point.bestMoveBefore}</span>}
    </div>
  );
}

function AppLogo({ onClick }) {
  return (
    <button type="button" className="app-logo" onClick={onClick}>
      <span className="app-logo-mark">♟</span>
      <span className="app-logo-text">Cyber Chess</span>
    </button>
  );
}

function AnalysisArrows({ analysisLines = [], playerColor }) {
  if (analysisLines.length === 0) return null;

  const getSquareCenter = (pos) => {
    const [c, r] = Board.posToCoord(pos);
    const displayC = playerColor === 'black' ? 7 - c : c;
    const displayR = playerColor === 'black' ? r : 7 - r;
    const x = (displayC + 0.5) * (100 / 8);
    const y = (displayR + 0.5) * (100 / 8);
    return { x: `${x}%`, y: `${y}%` };
  };

  const parsedLines = analysisLines.map((line) => {
    let numericScore = 0;
    if (line.score.startsWith('M')) {
      numericScore = line.score.includes('-') ? -10000 : 10000;
    } else {
      numericScore = parseFloat(line.score) * 100;
    }
    return { ...line, numericScore };
  });

  const maxScore = Math.max(...parsedLines.map((line) => line.numericScore));
  const minScore = Math.min(...parsedLines.map((line) => line.numericScore));
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
}

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
  const positionAnalyzerRef = useRef(null);
  const gameAnalyzerRef = useRef(null);
  const positionAnalysisTokenRef = useRef(0);
  const reviewLoadTokenRef = useRef(0);
  const autoAnalysisRunningRef = useRef(false);
  const pendingAutoAnalysisRef = useRef(null);
  const analysisMetaRef = useRef({ firstFen: null, depth: null });

  // Auto Game Analysis
  const [gameAnalysis, setGameAnalysis] = useState([]); // Array of analysis results
  const gameAnalysisRef = useRef([]); // Persistent cache for incremental analysis
  const [analysisProgress, setAnalysisProgress] = useState(null); // { current, total }
  const [analysisLoadingState, setAnalysisLoadingState] = useState(null);

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
  const [gameEndState, setGameEndState] = useState(null);
  const [drawOfferState, setDrawOfferState] = useState('idle');
  const [reviewGameMeta, setReviewGameMeta] = useState(null);

  // User Profile
  const [userProfile, setUserProfile] = useState(() => {
    const saved = localStorage.getItem('chess_profile');
    return saved ? JSON.parse(saved) : { name: '' };
  });
  const [tempProfile, setTempProfile] = useState({ name: '' });
  const [profileError, setProfileError] = useState('');

  const destroyEngine = (ref) => {
    if (ref.current) {
      ref.current.destroy();
      ref.current = null;
    }
  };

  const resetAnalysisState = () => {
    positionAnalysisTokenRef.current += 1;
    autoAnalysisRunningRef.current = false;
    pendingAutoAnalysisRef.current = null;
    analysisMetaRef.current = { firstFen: null, depth: null };
    gameAnalysisRef.current = [];
    destroyEngine(positionAnalyzerRef);
    destroyEngine(gameAnalyzerRef);
    setGameAnalysis([]);
    setAnalysisLines([]);
    setAnalysisCache({});
    setIsAnalyzing(false);
    setAnalysisProgress(null);
    setAnalysisLoadingState(null);
    setReviewGameMeta(null);
  };

  const resetMultiplayerState = () => {
    setGameEndState(null);
    setDrawOfferState('idle');
  };

  const getViewedPositionIndex = () => {
    if (board.history.length === 0) return -1;
    return historyIndex === -1 ? board.history.length - 1 : historyIndex;
  };

  const getViewedFEN = () => {
    const positionIndex = getViewedPositionIndex();
    if (positionIndex < 0) return null;
    return getFenFromSnapshot(board.history[positionIndex], positionIndex);
  };

  const getViewedAnalysisEntry = () => {
    const positionIndex = getViewedPositionIndex();
    if (positionIndex < 0) return null;
    return gameAnalysis[positionIndex] || null;
  };

  const runAutoAnalysis = (targetBoard, options = {}) => {
    const {
      gameId = null,
      targetDepth = REVIEW_ANALYSIS_DEPTH,
    } = options;

    return new Promise((resolve) => {
      const history = targetBoard?.history || [];
      const allFens = buildFenList(history).filter(Boolean);

      if (allFens.length === 0) {
        setAnalysisProgress(null);
        resolve([]);
        return;
      }

      const firstFen = allFens[0];
      const metaChanged = (
        analysisMetaRef.current.firstFen !== firstFen ||
        analysisMetaRef.current.depth !== targetDepth ||
        gameAnalysisRef.current.length > allFens.length
      );

      if (metaChanged) {
        analysisMetaRef.current = { firstFen, depth: targetDepth };
        gameAnalysisRef.current = [];
        setGameAnalysis([]);
      }

      const startIdx = gameAnalysisRef.current.length;
      const unanalyzedFens = allFens.slice(startIdx);

      if (unanalyzedFens.length === 0) {
        setAnalysisProgress(null);
        setGameAnalysis([...gameAnalysisRef.current]);
        resolve(gameAnalysisRef.current);
        return;
      }

      if (!gameAnalyzerRef.current) {
        gameAnalyzerRef.current = new StockfishEngine();
      }

      gameAnalyzerRef.current.analyzeGame(unanalyzedFens, {
        targetDepth,
        numLines: ANALYSIS_LINE_COUNT,
        onProgress: (current) => {
          setAnalysisProgress({
            current: startIdx + current,
            total: allFens.length,
            depth: targetDepth
          });
        },
        onPositionDone: (summary, relativeIndex) => {
          const absoluteIndex = startIdx + relativeIndex;
          gameAnalysisRef.current[absoluteIndex] = summary;
          setGameAnalysis([...gameAnalysisRef.current]);
        },
        onDone: () => {
          setAnalysisProgress(null);
          setGameAnalysis([...gameAnalysisRef.current]);

          if (gameId) {
            socket.emit('save_game_analysis', {
              id: gameId,
              analysis: buildAnalysisPackage(gameAnalysisRef.current, targetDepth)
            });
          }

          resolve(gameAnalysisRef.current);
        }
      });
    });
  };

  const startPendingAutoAnalysis = () => {
    if (autoAnalysisRunningRef.current || !pendingAutoAnalysisRef.current) return;

    const nextRun = pendingAutoAnalysisRef.current;
    pendingAutoAnalysisRef.current = null;
    autoAnalysisRunningRef.current = true;

    runAutoAnalysis(nextRun.targetBoard, nextRun.options).finally(() => {
      autoAnalysisRunningRef.current = false;
      if (pendingAutoAnalysisRef.current) {
        startPendingAutoAnalysis();
      }
    });
  };

  const queueAutoAnalysis = (targetBoard, options = {}) => {
    pendingAutoAnalysisRef.current = { targetBoard, options };
    startPendingAutoAnalysis();
  };

  function buildMultiplayerResultPayload(nextBoard) {
    if (nextBoard.gameStatus === 'checkmate') {
      const winnerColor = nextBoard.turn === 'white' ? 'black' : 'white';
      return {
        result: winnerColor === 'white' ? 'white_win' : 'black_win',
        winnerColor,
        termination: 'checkmate'
      };
    }

    if (nextBoard.gameStatus === 'stalemate' || nextBoard.gameStatus === 'draw') {
      return {
        result: 'draw',
        winnerColor: null,
        termination: nextBoard.gameStatus === 'draw' ? 'draw_agreement' : 'stalemate'
      };
    }

    return null;
  }

  function saveCpuGame(nextBoard) {
    if (nextBoard && nextBoard.history && nextBoard.history.length > 1) {
      socket.emit('save_cpu_game', { code: roomCode, history: nextBoard.history });
    }
  }

  function initStockfish(code) {
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
            setTimeout(() => {
              stockfishRef.current?.getBestMove(b.toFEN());
            }, 200);
          } else {
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
  }

  useEffect(() => {
    socket.on('game_created', ({ code, color }) => {
      resetAnalysisState();
      resetMultiplayerState();
      setSavedGameId(null);
      window.history.pushState({}, '', '/?game=' + code);
      setRoomCode(code);
      setPlayerColor(color);
      setView('WAITING');
    });

    socket.on('game_joined', ({ code, color }) => {
      resetAnalysisState();
      resetMultiplayerState();
      setSavedGameId(null);
      window.history.pushState({}, '', '/?game=' + code);
      setRoomCode(code);
      setPlayerColor(color);
      setView('GAME');
    });

    socket.on('game_start', () => {
      resetMultiplayerState();
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
      resetAnalysisState();
      resetMultiplayerState();
      setSavedGameId(null);
      setRoomCode(code);
      setPlayerColor('spectator');
      const newBoard = createBoardFromHistory(history || []);
      setBoard(newBoard);
      setHistoryIndex(-1);
      setView('SPECTATING');
    });

    socket.on('live_games_list', (games) => setLiveGames(games));
    socket.on('past_games_list', (games) => setPastGames(games));
    socket.on('waiting_count', (count) => setWaitingCount(count));

    socket.on('cpu_game_created', (code) => {
      resetAnalysisState();
      resetMultiplayerState();
      setSavedGameId(null);
      setRoomCode(code);
      setView('VS_CPU');
      window.history.pushState({}, '', '/?game=' + code);
      initStockfish(code);
    });

    socket.on('opponent_move', ({ startPos, endPos }) => {
      setDrawOfferState('idle');
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

    socket.on('draw_offer_sent', () => {
      setDrawOfferState('sent');
    });

    socket.on('draw_offer_received', ({ code, fromName }) => {
      const accepted = window.confirm(`${fromName} offered tablas. Do you agree?`);
      socket.emit('respond_draw_offer', { code, accepted });
    });

    socket.on('draw_offer_declined', () => {
      setDrawOfferState('idle');
      alert('Your tablas offer was declined.');
    });

    socket.on('game_ended', (payload) => {
      setDrawOfferState('idle');
      setGameEndState(payload);
      setBoard(prevBoard => {
        const b = new Board();
        b.pieces = prevBoard.clonePieces();
        b.turn = prevBoard.turn;
        b.history = [...prevBoard.history];
        b.enPassantSquare = prevBoard.enPassantSquare;
        b.halfMoveClock = prevBoard.halfMoveClock;
        b.fullMoveNumber = prevBoard.fullMoveNumber;
        b.gameStatus = payload.result === 'draw' ? 'draw' : 'resigned';

        if (b.history.length > 0) {
          const lastIndex = b.history.length - 1;
          b.history[lastIndex] = {
            ...b.history[lastIndex],
            gameStatus: b.gameStatus
          };
        }

        return b;
      });
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
        resetAnalysisState();
        resetMultiplayerState();
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
      socket.off('draw_offer_sent');
      socket.off('draw_offer_received');
      socket.off('draw_offer_declined');
      socket.off('game_ended');
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
      if (gameCode) {
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
            positionAnalyzerRef.current?.stopAnalysis();
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
            positionAnalyzerRef.current?.stopAnalysis();
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
      return;
    }

    if (!analysisId || pastGames.length === 0) {
      return;
    }

    const gameToAnalyze = pastGames.find(g => g.id === parseInt(analysisId, 10));
    if (!gameToAnalyze) return;

    const reviewRequestId = reviewLoadTokenRef.current + 1;
    reviewLoadTokenRef.current = reviewRequestId;

    const frameId = window.requestAnimationFrame(() => {
      resetAnalysisState();
      resetMultiplayerState();
      setReviewGameMeta(gameToAnalyze);
      setRoomCode(gameToAnalyze.room_code);
      setSavedGameId(gameToAnalyze.id);
      setPlayerColor('spectator');

      const moves = gameToAnalyze.moves ? JSON.parse(gameToAnalyze.moves) : [];
      const reviewBoard = createBoardFromHistory(moves, { ended: true });
      setBoard(reviewBoard);
      setHistoryIndex(-1);
      setPendingAnalysisId(null);

      const cachedAnalysis = normalizeStoredAnalysis(
        gameToAnalyze.analysis,
        moves.length,
        REVIEW_ANALYSIS_DEPTH
      );

      if (cachedAnalysis) {
        analysisMetaRef.current = {
          firstFen: cachedAnalysis[0]?.fen || buildFenList(moves)[0] || null,
          depth: REVIEW_ANALYSIS_DEPTH
        };
        gameAnalysisRef.current = cachedAnalysis;
        setGameAnalysis(cachedAnalysis);
        setView('REVIEW');
        return;
      }

      setAnalysisLoadingState({
        roomCode: gameToAnalyze.room_code,
        current: 0,
        total: moves.length,
        depth: REVIEW_ANALYSIS_DEPTH
      });
      setView('ANALYZING');

      runAutoAnalysis(reviewBoard, {
        gameId: gameToAnalyze.id,
        targetDepth: REVIEW_ANALYSIS_DEPTH
      }).then((positions) => {
        if (reviewLoadTokenRef.current !== reviewRequestId) return;
        gameAnalysisRef.current = positions;
        setGameAnalysis([...positions]);
        setAnalysisLoadingState(null);
        setView('REVIEW');
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [pastGames, pendingAnalysisId]);

  // Live Spectator Analysis Trigger
  useEffect(() => {
    if (view === 'SPECTATING' && board.history.length > 0) {
      queueAutoAnalysis(board, { targetDepth: LIVE_ANALYSIS_DEPTH });
    }
  }, [board, view]);

  const handleCancelFindGame = () => {
    socket.emit('cancel_find_game');
    resetMultiplayerState();
    setView('LOBBY');
  };

  const handleReturnToLobby = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (view === 'SEARCHING') {
      socket.emit('cancel_find_game');
    }
    if (view === 'VS_CPU') {
      saveCpuGame(board);
    }

    reviewLoadTokenRef.current += 1;
    destroyEngine(stockfishRef);
    resetAnalysisState();
    resetMultiplayerState();
    setSavedGameId(null);
    setPendingAnalysisId(null);
    setHistoryIndex(-1);
    setRoomCode('');
    setPlayerColor(null);
    setSelectedPos(null);
    setLegalMoves([]);
    setPreMove(null);
    setEngineStats({});
    setBoard(new Board());
    setView('LOBBY');
    window.history.pushState({}, '', '/');
  };

  const handlePlayCPU = () => {
    resetAnalysisState();
    resetMultiplayerState();
    setSavedGameId(null);
    socket.emit('create_cpu_game');
    const newBoard = new Board();
    setBoard(newBoard);
    setPlayerColor('white');
    setRoomCode('CPU (WAITING...)');
    setEngineStats({});
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

  const handleSurrender = () => {
    if (!window.confirm('Are you sure you want to surrender this game?')) {
      return;
    }
    socket.emit('resign_game', { code: roomCode });
  };

  const handleOfferDraw = () => {
    socket.emit('offer_draw', { code: roomCode });
  };

  const saveProfile = () => {
    if (!tempProfile.name.trim()) {
      setProfileError('Identification required.');
      return;
    }
    const profile = {
      name: tempProfile.name.trim()
    };
    localStorage.setItem('chess_profile', JSON.stringify(profile));
    setUserProfile(profile);
  };



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
            const resultPayload = buildMultiplayerResultPayload(updatedBoard);
            setGameEndState(resultPayload);
            socket.emit('save_multiplayer_game', {
              code: roomCode,
              history: updatedBoard.history,
              result: resultPayload
            });
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

  const onDragOver = (e) => {
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

  useEffect(() => {
    return () => {
      destroyEngine(stockfishRef);
      destroyEngine(positionAnalyzerRef);
      destroyEngine(gameAnalyzerRef);
    };
  }, []);

  useEffect(() => {
    if (view !== 'SPECTATING' || historyIndex !== -1 || board.history.length === 0) return;

    const fen = getViewedFEN();
    if (!fen) return;

    const token = positionAnalysisTokenRef.current + 1;
    positionAnalysisTokenRef.current = token;

    if (!positionAnalyzerRef.current) {
      positionAnalyzerRef.current = new StockfishEngine();
    }

    const analyzer = positionAnalyzerRef.current;
    const startId = window.requestAnimationFrame(() => {
      setIsAnalyzing(true);
      if (analysisCache[fen]) {
        setAnalysisLines(analysisCache[fen]);
      } else {
        setAnalysisLines([]);
      }
    });

    analyzer.onAnalysisUpdate = (lines) => {
      if (positionAnalysisTokenRef.current !== token) return;
      setAnalysisLines([...lines]);
    };

    analyzer.onAnalysisDone = (lines) => {
      if (positionAnalysisTokenRef.current !== token) return;
      setAnalysisCache((prev) => ({ ...prev, [fen]: [...lines] }));
      setAnalysisLines([...lines]);
      setIsAnalyzing(false);
    };

    analyzer.analyzePosition(fen, ANALYSIS_LINE_COUNT, LIVE_ANALYSIS_DEPTH);

    return () => {
      window.cancelAnimationFrame(startId);
      if (positionAnalysisTokenRef.current === token) {
        positionAnalysisTokenRef.current += 1;
        analyzer.stopAnalysis();
        setIsAnalyzing(false);
      }
    };
  }, [board, historyIndex, view]);

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
        onDragOver={onDragOver}
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

  if (!userProfile.name) {
    return (
      <div className="app-shell">
        <IdentityModal
          tempProfile={tempProfile}
          setTempProfile={setTempProfile}
          saveProfile={saveProfile}
          profileError={profileError}
        />
      </div>
    );
  }

  // ──────── LOBBY ────────
  if (view === 'LOBBY') {
    return (
      <div className="app-shell">
        <AppLogo onClick={handleReturnToLobby} />
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
	            <button type="button" className="btn-green" onClick={handleFindGame}>Find Match</button>
          </div>

          <div className="card">
            <span className="card-icon">🤖</span>
            <h2>Play vs Computer</h2>
            <p>Challenge Stockfish AI</p>

            {/* Mode toggle */}
            <div className="mode-toggle">
	              <button type="button" className={`toggle-btn ${cpuMode === 'depth' ? 'active' : ''}`} onClick={() => setCpuMode('depth')}>By Depth</button>
	              <button type="button" className={`toggle-btn ${cpuMode === 'time' ? 'active' : ''}`} onClick={() => setCpuMode('time')}>By Time</button>
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

	            <button type="button" className="btn-green" onClick={handlePlayCPU} style={{ background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' }}>Start Game</button>
          </div>

          <div className="card">
            <span className="card-icon">🤝</span>
            <h2>Play with Friend</h2>
            <p>Create a private room or join one</p>
	            <button type="button" className="btn-blue" onClick={handleCreateGame} style={{ marginBottom: '10px' }}>Create Game</button>
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
	                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
	                      <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{game.players || `Room ${game.code}`}</span>
	                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Room {game.code}</span>
	                    </div>
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
	            <div className="item-list past-games-list">
	              {pastGames.length === 0 ? <p className="empty-msg">No past games yet</p> :
	                pastGames.map(game => {
	                  const moves = game.moves ? JSON.parse(game.moves) : [];
	                  const moveCount = Math.max(0, moves.length - 1);
	                  const gameName = game.game_name || `Game ${game.room_code}`;
	                  const whitePlayer = formatParticipantLabel(game.white_name, game.winner_color, 'white', userProfile.name);
	                  const blackPlayer = formatParticipantLabel(game.black_name, game.winner_color, 'black', userProfile.name);
                  return (
                    <div key={game.id} className="list-item past-game-item" onClick={() => window.open(`/?analysis=${game.id}`, '_blank')}>
                      <div className="past-game-main">
                        <span className="past-game-title">{gameName}</span>
                        <span className="past-game-players">{whitePlayer} vs {blackPlayer}</span>
                        <span className="past-game-outcome">{formatGameOutcome(game)} · {moveCount} moves</span>
                      </div>
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
      </div>
    );
  }

  // ──────── WAITING ────────
  if (view === 'WAITING') {
    return (
      <div className="app-shell">
        <AppLogo onClick={handleReturnToLobby} />
        <div className="chess-container">
          <h1>Waiting for Opponent</h1>
          <p className="subtitle">Share this code with a friend</p>
          <div className="room-code-display">{roomCode}</div>
          <p className="loading-pulse">Waiting for opponent to join…</p>
        </div>
      </div>
    );
  }

  // ──────── SEARCHING ────────
  if (view === 'SEARCHING') {
    return (
      <div className="app-shell">
        <AppLogo onClick={handleReturnToLobby} />
        <div className="chess-container">
          <h1>Matchmaking</h1>
          <p className="subtitle">Looking for an opponent…</p>
          <div className="search-icon">♟</div>
          <p className="loading-pulse">Searching…</p>
	          <button type="button" className="btn-red" onClick={handleCancelFindGame} style={{ marginTop: '20px' }}>Cancel Search</button>
        </div>
      </div>
    );
  }

  if (view === 'ANALYZING') {
    const totalPositions = analysisProgress?.total || analysisLoadingState?.total || 0;
    const completedPositions = Math.min(analysisProgress?.current ?? analysisLoadingState?.current ?? 0, totalPositions);
    const analysisDepth = analysisProgress?.depth || analysisLoadingState?.depth || REVIEW_ANALYSIS_DEPTH;
    const progressPercent = totalPositions > 0 ? (completedPositions / totalPositions) * 100 : 0;

    return (
      <div className="app-shell">
        <AppLogo onClick={handleReturnToLobby} />
        <div className="chess-container analysis-loading-view">
          <h1>Analyzing Game</h1>
          <p className="subtitle">
            {analysisLoadingState?.roomCode
              ? `Preparing cached review for ${analysisLoadingState.roomCode}`
              : 'Preparing cached review'}
          </p>

          <div className="analysis-loading-card">
            <div className="analysis-loading-spinner" />
            <p className="loading-pulse">Running Stockfish through every position…</p>

            <div className="analysis-progress-container analysis-loading-progress">
              <div className="analysis-progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>

            <div className="analysis-loading-meta">
              <span>Depth {analysisDepth}</span>
              <span>
                {totalPositions > 0
                  ? `Position ${Math.min(completedPositions + 1, totalPositions)} / ${totalPositions}`
                  : 'Starting engine…'}
              </span>
            </div>

            <p className="analysis-loading-note">
              The finished move-by-move analysis is saved so the next viewer can open it instantly.
            </p>
          </div>
        </div>
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
    positionAnalyzerRef.current?.stopAnalysis();
    positionAnalysisTokenRef.current += 1;
    setIsAnalyzing(false);
  };

  const handleAnalyze = () => {
    const fen = getViewedFEN();
    if (!fen) return;

    const storedEntry = getViewedAnalysisEntry();
    if (view === 'REVIEW' && storedEntry?.fen === fen && Array.isArray(storedEntry.topLines)) {
      setAnalysisLines(storedEntry.topLines);
      setIsAnalyzing(false);
      return;
    }

    if (analysisCache[fen]) {
      setAnalysisLines(analysisCache[fen]);
    }

    if (!positionAnalyzerRef.current) {
      positionAnalyzerRef.current = new StockfishEngine();
    }

    const analyzer = positionAnalyzerRef.current;
    const token = positionAnalysisTokenRef.current + 1;
    positionAnalysisTokenRef.current = token;
    const targetDepth = view === 'REVIEW' ? REVIEW_ANALYSIS_DEPTH : LIVE_ANALYSIS_DEPTH;

    setIsAnalyzing(true);
    if (!analysisCache[fen]) {
      setAnalysisLines([]);
    }

    analyzer.onAnalysisUpdate = (lines) => {
      if (positionAnalysisTokenRef.current !== token) return;
      setAnalysisLines([...lines]);
    };
    analyzer.onAnalysisDone = (lines) => {
      if (positionAnalysisTokenRef.current !== token) return;
      setAnalysisLines([...lines]);
      setAnalysisCache(prev => ({ ...prev, [fen]: [...lines] }));
      setIsAnalyzing(false);
    };

    analyzer.analyzePosition(fen, ANALYSIS_LINE_COUNT, targetDepth);
  };

  const isSpectating = view === 'SPECTATING';
  const isVsCPU = view === 'VS_CPU';
  const isReview = view === 'REVIEW';
  const isLiveMultiplayer = view === 'GAME';
  const isMyTurn = board.turn === playerColor;
  const viewedFen = getViewedFEN();
  const currentAnalysisEntry = getViewedAnalysisEntry();
  const storedAnalysisLines = currentAnalysisEntry?.fen === viewedFen && Array.isArray(currentAnalysisEntry?.topLines)
    ? currentAnalysisEntry.topLines
    : null;
  const cachedAnalysisLines = viewedFen ? analysisCache[viewedFen] : null;
  const displayedAnalysisLines = (
    Array.isArray(storedAnalysisLines)
      ? storedAnalysisLines
      : Array.isArray(cachedAnalysisLines)
        ? cachedAnalysisLines
        : Array.isArray(analysisLines)
          ? analysisLines
          : []
  ).slice(0, ANALYSIS_LINE_COUNT);
  const currentBestMove = displayedAnalysisLines[0]?.bestMove || displayedAnalysisLines[0]?.moves?.[0] || currentAnalysisEntry?.bestMove || null;
  const canAnalyzeCurrentView = isReview || isVsCPU || isSpectating;
  const showAnalysisPanel = canAnalyzeCurrentView;
  const showSpectatorButton = isLiveMultiplayer;
  const showInlineAnalyzeButton = canAnalyzeCurrentView;
  const showAnalysisActions = showSpectatorButton || showInlineAnalyzeButton;
  const precisionStats = gameAnalysis.length > 1 ? buildPrecisionStats(board.history, gameAnalysis) : null;
  const evaluationChartData = buildEvaluationChartData(board.history, gameAnalysis);
  const selectedPositionIndex = getViewedPositionIndex();
  const selectedChartPoint = evaluationChartData[selectedPositionIndex] || null;
  const chartMaxAbsEval = clamp(
    evaluationChartData.reduce((maxEval, point) => Math.max(maxEval, Math.abs(point.eval)), 0),
    2,
    MAX_UI_EVAL
  );
  const persistedOutcome = reviewGameMeta ? {
    result: reviewGameMeta.result,
    winnerColor: reviewGameMeta.winner_color,
    termination: reviewGameMeta.termination
  } : null;
  const outcomeState = gameEndState || persistedOutcome;
  const outcomeWinnerText = outcomeState?.winnerColor === 'white' ? 'White' : outcomeState?.winnerColor === 'black' ? 'Black' : null;

  const statusText = outcomeState?.termination === 'resignation'
    ? `${outcomeWinnerText} wins by surrender`
    : outcomeState?.termination === 'draw_agreement'
      ? 'Tablas agreed'
    : board.gameStatus === 'checkmate'
      ? `Checkmate! ${board.turn === 'white' ? 'Black' : 'White'} wins!`
    : board.gameStatus === 'stalemate'
      ? 'Stalemate \u2014 Draw!'
      : board.gameStatus === 'draw'
        ? 'Tablas'
      : isReview
        ? (historyIndex === -1 ? 'Review Ready' : 'Reviewing Position')
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
    <div className="app-shell">
      <AppLogo onClick={handleReturnToLobby} />
      <div className="chess-container game-layout">
      <div className="game-wrapper">
        <div className="game-header">
          <div className="room-badge">{isReview ? '📜 Review' : isSpectating ? '📡 Spectating' : isVsCPU ? '🤖 vs Stockfish' : `Room ${roomCode}`}</div>
          <div className={`status-bar ${statusClass}`} style={{ marginLeft: view === 'GAME' ? '8px' : 'auto' }}>{statusText}</div>
        </div>
        <div className="board" style={{ position: 'relative' }}>
          <AnalysisArrows analysisLines={displayedAnalysisLines} playerColor={playerColor} />
          {boardRows}
        </div>
        <div className="controls">
          <p>{isReview ? <b>Game Review</b> : isSpectating ? <b>Observer Mode</b> : isVsCPU ? <>You (White) vs <b>Stockfish</b></> : <>Playing as <b>{playerColor}</b></>}</p>
          <div className="control-actions">
            {isLiveMultiplayer && board.gameStatus === 'active' && (
              <>
	                <button type="button" className="btn-orange" onClick={handleOfferDraw} disabled={drawOfferState === 'sent'}>
	                  {drawOfferState === 'sent' ? 'Tablas Offered' : 'Offer Tablas'}
	                </button>
	                <button type="button" className="btn-red" onClick={handleSurrender}>Surrender</button>
	              </>
	            )}
	            <button type="button" className="btn-red" onClick={handleReturnToLobby}>Leave</button>
          </div>
        </div>
      </div>

      <div className="history-panel">
        <h3>Moves</h3>

        {precisionStats && (
          <div className="precision-grid">
            <div className="precision-card">
              <span className="precision-label">White Precision</span>
              <strong>{precisionStats.white.precision.toFixed(1)}%</strong>
              <span className="precision-meta">{precisionStats.white.averageLoss.toFixed(2)} eval loss / move</span>
            </div>
            <div className="precision-card">
              <span className="precision-label">Black Precision</span>
              <strong>{precisionStats.black.precision.toFixed(1)}%</strong>
              <span className="precision-meta">{precisionStats.black.averageLoss.toFixed(2)} eval loss / move</span>
            </div>
          </div>
        )}

	        {evaluationChartData.length > 0 && (
	          <div className="evaluation-chart-card">
	            <div className="evaluation-chart-head">
	              <div>
	                <h4>Winning Trend</h4>
	                <span className="evaluation-subtitle">Positive values mean White is better</span>
	              </div>
	              {selectedChartPoint && (
	                <span className="evaluation-pill">{selectedChartPoint.evalText}</span>
	              )}
	            </div>
	            <div className="evaluation-chart-scale">
	              <span>White better</span>
	              <span>Black better</span>
	            </div>
	            <div className="evaluation-chart">
	              <ResponsiveContainer width="100%" height="100%">
	                <LineChart
	                  data={evaluationChartData}
	                  onClick={(state) => {
	                    const nextIndex = state?.activeTooltipIndex;
	                    if (typeof nextIndex === 'number' && evaluationChartData[nextIndex]) {
	                      handleHistoryClick(evaluationChartData[nextIndex].index);
	                    }
	                  }}
	                >
	                  <XAxis dataKey="ply" hide />
	                  <YAxis domain={[-chartMaxAbsEval, chartMaxAbsEval]} hide />
	                  <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.1)' }} content={<EvaluationTooltip />} />
	                  <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
	                  {selectedPositionIndex >= 0 && (
	                    <ReferenceLine x={selectedPositionIndex} stroke="rgba(255,255,255,0.18)" />
	                  )}
	                  <Line
	                    type="monotone"
	                    dataKey="eval"
	                    stroke="#38bdf8"
	                    strokeWidth={2.5}
	                    dot={false}
	                    activeDot={{ r: 4, strokeWidth: 0, fill: '#f8fafc' }}
	                    isAnimationActive={false}
	                  />
	                </LineChart>
	              </ResponsiveContainer>
	            </div>
	          </div>
	        )}

        {/* Analysis Progress Bar */}
        {analysisProgress && (
          <div className="analysis-progress-container" style={{ marginBottom: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '4px', width: `${analysisProgress.total > 0 ? ((analysisProgress.current + 1) / analysisProgress.total) * 100 : 0}%`, background: 'var(--green)', transition: 'width 0.2s' }}></div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', padding: '4px' }}>
              Analyzing game {Math.min(analysisProgress.current + 1, analysisProgress.total)} / {analysisProgress.total} at depth {analysisProgress.depth}...
            </div>
          </div>
        )}

	        <div className="history-list">
	          {board.history.map((snapshot, idx) => {
	            const isActive = historyIndex === idx || (historyIndex === -1 && idx === board.history.length - 1);
	            const stats = engineStats[idx];
	            // Analysis of the position BEFORE this move was made
	            const analysis = idx > 0 ? gameAnalysis[idx - 1] : null;
	            const chartPoint = evaluationChartData[idx] || null;
	            return (
              <div
                key={idx}
                className={`history-item ${isActive ? 'active' : ''}`}
                onClick={() => handleHistoryClick(idx)}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}
              >
	                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
	                  <span>{formatPlyLabel(snapshot, idx)}</span>
	                  {stats && (
	                    <span className="engine-stats">d{stats.depth} · {(stats.timeMs / 1000).toFixed(1)}s</span>
	                  )}
	                </div>
	                {(analysis || chartPoint) && idx > 0 && (
	                  <div className="move-analysis" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
	                    {chartPoint && (
	                      <>
	                        <span style={{ color: chartPoint.eval > 0 ? '#4ade80' : chartPoint.eval < 0 ? '#f87171' : '#9ca3af' }}>{chartPoint.evalText}</span>
	                        <span>{chartPoint.swingText}</span>
	                      </>
	                    )}
	                    {analysis?.bestMove && <span>Best: {analysis.bestMove}</span>}
	                  </div>
	                )}
              </div>
            );
          })}
        </div>

        {showAnalysisActions && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {showInlineAnalyzeButton && (
	              <button type="button" className="btn-ghost" onClick={handleAnalyze} disabled={isAnalyzing} style={{ fontSize: '13px', padding: '8px' }}>
	                {isAnalyzing ? 'Analyzing Position…' : '🔍 Refresh Top 3 Here'}
	              </button>
	            )}
	            <button type="button" className="btn-blue"
	              onClick={() => {
                if (isLiveMultiplayer) {
                  window.open('/?spectate=' + roomCode, '_blank');
                } else {
                  const analysisId = savedGameId;
                  if (analysisId) {
                    window.open('/?analysis=' + analysisId, '_blank');
                  } else {
                    window.open('/?spectate=' + roomCode, '_blank');
                  }
                }
              }}
              style={{ fontSize: '13px', padding: '8px' }}>
              {isLiveMultiplayer ? 'See Game as Spectator' : '📊 Analyze Full Game in New Tab'}
            </button>
          </div>
        )}

        {/* Analysis results */}
        {showAnalysisPanel && (
          <div className="analysis-panel">
            <h4>Top 3 Engine Lines {isAnalyzing && <span className="loading-dot">●</span>}</h4>
            {currentBestMove && (
              <div className="analysis-summary">
                <span>Best move</span>
                <strong>{currentBestMove}</strong>
              </div>
            )}
	            {displayedAnalysisLines.length > 0 ? displayedAnalysisLines.map((line, i) => (
	              <div key={i} className="analysis-line">
	                <span className="analysis-rank">#{i + 1}</span>
	                <span className="analysis-score">{line.score}</span>
	                <span className="analysis-moves">{Array.isArray(line.moves) ? line.moves.join(' ') : (line.bestMove || 'No principal variation')}</span>
	                <span className="analysis-depth">d{line.depth}</span>
	              </div>
	            )) : (
              <div className="analysis-empty">
                {isAnalyzing ? 'Calculating top moves for this position…' : 'No legal moves available from this position.'}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default App;

const IdentityModal = ({ tempProfile, setTempProfile, saveProfile, profileError }) => (
  <div className="identity-overlay">
    <div className="identity-modal">
      <h2>Identity Setup</h2>
      <p>Your handle is required to access the neural chess network.</p>
      <div className="identity-form">
        <div className="input-block">
          <label>Shadow Handle</label>
          <input
            type="text"
            className="cyber-input"
            placeholder="e.g. ZeroCool"
            value={tempProfile.name}
            onChange={e => setTempProfile({ name: e.target.value })}
            autoFocus
          />
        </div>
	        <button type="button" className="btn-cyber" style={{ marginTop: '10px' }} onClick={saveProfile}>
	          Authorize Access
	        </button>
        {profileError && <div className="cyber-status">{profileError}</div>}
      </div>
    </div>
  </div>
);
