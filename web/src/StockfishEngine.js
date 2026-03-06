// StockfishEngine.js — Wrapper for Stockfish WASM Web Worker

export class StockfishEngine {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.onBestMove = null;       // (uciMove, stats) => void
        this.onAnalysisUpdate = null;  // (lines) => void  — called progressively
        this.onAnalysisDone = null;    // (lines) => void  — called when search finishes
        this._mode = 'depth';
        this._depth = 15;
        this._moveTime = 3000;
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = 0;
        this._analysisLines = {};      // { pvIndex: { depth, score, pv, moves } }
        this._isAnalyzing = false;
        this._init();
    }

    _init() {
        this.worker = new Worker('/stockfish.js');
        this.worker.onmessage = (e) => {
            const line = typeof e.data === 'string' ? e.data : e.data?.data;
            if (!line) return;

            if (line === 'uciok') {
                this.worker.postMessage('isready');
            }
            if (line === 'readyok') {
                this.ready = true;
            }

            // Parse info lines
            if (line.startsWith('info') && line.includes('depth')) {
                const depthMatch = line.match(/\bdepth (\d+)/);
                const timeMatch = line.match(/\btime (\d+)/);
                const nodesMatch = line.match(/\bnodes (\d+)/);
                const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
                const pvMatch = line.match(/\bpv (.+)$/);
                const multipvMatch = line.match(/\bmultipv (\d+)/);

                if (depthMatch) this._currentStats.depth = parseInt(depthMatch[1]);
                if (timeMatch) this._currentStats.time = parseInt(timeMatch[1]);
                if (nodesMatch) this._currentStats.nodes = parseInt(nodesMatch[1]);

                // For analysis mode: track each PV line
                if (this._isAnalyzing && depthMatch && scoreMatch && pvMatch) {
                    const pvIdx = multipvMatch ? parseInt(multipvMatch[1]) : 1;
                    const depth = parseInt(depthMatch[1]);
                    const scoreType = scoreMatch[1];
                    const scoreVal = parseInt(scoreMatch[2]);
                    const score = scoreType === 'mate' ? `M${scoreVal}` : (scoreVal / 100).toFixed(2);
                    const pv = pvMatch[1].trim();
                    const moves = pv.split(' ').slice(0, 8); // show max 8 moves

                    this._analysisLines[pvIdx] = { depth, score, scoreType, scoreVal, moves, pv };

                    if (this.onAnalysisUpdate) {
                        this.onAnalysisUpdate(this._getAnalysisArray());
                    }
                }
            }

            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const bestMove = parts[1];
                const wallTime = Date.now() - this._searchStart;
                const stats = {
                    depth: this._currentStats.depth,
                    timeMs: this._currentStats.time || wallTime,
                    nodes: this._currentStats.nodes,
                };

                if (this._isAnalyzing) {
                    this._isAnalyzing = false;
                    if (this.onAnalysisDone) {
                        this.onAnalysisDone(this._getAnalysisArray());
                    }
                } else if (this.onBestMove) {
                    this.onBestMove(bestMove, stats);
                }
            }
        };
        this.worker.postMessage('uci');
    }

    _getAnalysisArray() {
        // Return sorted array of PV lines
        return Object.values(this._analysisLines)
            .sort((a, b) => {
                // Sort by score (higher is better for the side to move)
                if (a.scoreType === 'mate' && b.scoreType !== 'mate') return -1;
                if (b.scoreType === 'mate' && a.scoreType !== 'mate') return 1;
                return b.scoreVal - a.scoreVal;
            });
    }

    setMode(mode) { this._mode = mode; }
    setDepth(depth) { this._depth = depth; }
    setMoveTime(ms) { this._moveTime = ms; }

    getBestMove(fen) {
        if (!this.ready) return;
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = Date.now();
        this._isAnalyzing = false;
        this.worker.postMessage('setoption name MultiPV value 1');
        this.worker.postMessage(`position fen ${fen}`);
        if (this._mode === 'time') {
            this.worker.postMessage(`go movetime ${this._moveTime}`);
        } else {
            this.worker.postMessage(`go depth ${this._depth}`);
        }
    }

    analyzePosition(fen, numLines = 5, maxDepth = 25) {
        if (!this.ready) return;
        this._isAnalyzing = true;
        this._analysisLines = {};
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = Date.now();
        this.worker.postMessage('stop');
        this.worker.postMessage(`setoption name MultiPV value ${numLines}`);
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${maxDepth}`);
    }

    analyzeGame(fens, targetDepth = 17, onProgress, onDone) {
        if (!this.ready || fens.length === 0) {
            if (onDone) onDone([]);
            return;
        }

        this.worker.postMessage('stop');
        this.worker.postMessage('setoption name MultiPV value 1');

        let currentIndex = 0;
        const results = [];

        // We will repurpose the internal message handler temporarily
        const originalOnMessage = this.worker.onmessage;

        let currentDepth = 0;
        let currentScore = 0;
        let pScoreType = 'cp';

        const processNext = () => {
            if (currentIndex >= fens.length) {
                this.worker.onmessage = originalOnMessage;
                if (onDone) onDone(results);
                return;
            }
            if (onProgress) onProgress(currentIndex, fens.length);

            this.worker.postMessage(`position fen ${fens[currentIndex]}`);
            this.worker.postMessage(`go depth ${targetDepth}`);
        };

        this.worker.onmessage = (e) => {
            const line = typeof e.data === 'string' ? e.data : e.data?.data;
            if (!line) return;

            if (line.startsWith('info') && line.includes('depth')) {
                const depthMatch = line.match(/\bdepth (\d+)/);
                const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);

                if (depthMatch) currentDepth = parseInt(depthMatch[1]);
                if (scoreMatch) {
                    pScoreType = scoreMatch[1];
                    currentScore = parseInt(scoreMatch[2]);
                }
            }

            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const bestMove = parts[1];

                let numericScore = 0;
                let formattedScore = '';

                if (pScoreType === 'mate') {
                    numericScore = currentScore > 0 ? 1000 : -1000;
                    formattedScore = `M${currentScore}`;
                } else {
                    numericScore = currentScore / 100;
                    formattedScore = numericScore.toFixed(2);
                }

                results.push({
                    fen: fens[currentIndex],
                    bestMove,
                    score: formattedScore,
                    numericScore
                });

                currentIndex++;
                processNext();
            }
        };

        processNext();
    }

    stopAnalysis() {
        this.worker.postMessage('stop');
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
