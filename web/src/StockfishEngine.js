// StockfishEngine.js — Wrapper for Stockfish WASM Web Worker

export class StockfishEngine {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.onBestMove = null;       // (uciMove, stats) => void
        this.onAnalysisUpdate = null; // (lines) => void
        this.onAnalysisDone = null;   // (lines, stats) => void
        this._mode = 'depth';
        this._depth = 15;
        this._moveTime = 3000;
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = 0;
        this._analysisLines = {};
        this._isAnalyzing = false;
        this._readyResolvers = [];
        this._init();
    }

    _init() {
        this.worker = new Worker('/stockfish.js');
        this.worker.onmessage = (e) => {
            const line = typeof e.data === 'string' ? e.data : e.data?.data;
            if (!line) return;

            if (line === 'uciok') {
                this.worker.postMessage('isready');
                return;
            }

            if (line === 'readyok') {
                this.ready = true;
                this._readyResolvers.splice(0).forEach((resolve) => resolve());
                return;
            }

            if (line.startsWith('info') && line.includes('depth')) {
                this._captureAnalysisLine(line, this._currentStats, this._analysisLines, () => {
                    if (this._isAnalyzing && this.onAnalysisUpdate) {
                        this.onAnalysisUpdate(this._getAnalysisArray());
                    }
                });
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
                        this.onAnalysisDone(this._getAnalysisArray(), stats);
                    }
                } else if (this.onBestMove) {
                    this.onBestMove(bestMove, stats);
                }
            }
        };
        this.worker.postMessage('uci');
    }

    whenReady() {
        if (this.ready) return Promise.resolve();
        return new Promise((resolve) => {
            this._readyResolvers.push(resolve);
        });
    }

    _scoreSortValue(scoreType, scoreVal) {
        if (scoreType === 'mate') {
            return scoreVal > 0 ? 100000 - Math.abs(scoreVal) : -100000 + Math.abs(scoreVal);
        }
        return scoreVal;
    }

    _displayNumericScore(scoreType, scoreVal) {
        if (scoreType === 'mate') {
            return scoreVal > 0 ? 1000 : -1000;
        }
        return scoreVal / 100;
    }

    _captureAnalysisLine(line, statsTarget, analysisLinesTarget, onUpdate) {
        const depthMatch = line.match(/\bdepth (\d+)/);
        const timeMatch = line.match(/\btime (\d+)/);
        const nodesMatch = line.match(/\bnodes (\d+)/);
        const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
        const pvMatch = line.match(/\bpv (.+)$/);
        const multipvMatch = line.match(/\bmultipv (\d+)/);

        if (depthMatch) statsTarget.depth = parseInt(depthMatch[1], 10);
        if (timeMatch) statsTarget.time = parseInt(timeMatch[1], 10);
        if (nodesMatch) statsTarget.nodes = parseInt(nodesMatch[1], 10);

        if (!analysisLinesTarget || !depthMatch || !scoreMatch || !pvMatch) {
            return;
        }

        const pvIdx = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
        const depth = parseInt(depthMatch[1], 10);
        const scoreType = scoreMatch[1];
        const scoreVal = parseInt(scoreMatch[2], 10);
        const score = scoreType === 'mate' ? `M${scoreVal}` : (scoreVal / 100).toFixed(2);
        const pv = pvMatch[1].trim();
        const moves = pv.split(' ').slice(0, 8);

        analysisLinesTarget[pvIdx] = {
            depth,
            score,
            scoreType,
            scoreVal,
            moves,
            pv,
            bestMove: moves[0] || null,
            numericScore: this._displayNumericScore(scoreType, scoreVal),
        };

        if (onUpdate) onUpdate();
    }

    _getAnalysisArray(source = this._analysisLines) {
        return Object.values(source)
            .sort((a, b) => this._scoreSortValue(b.scoreType, b.scoreVal) - this._scoreSortValue(a.scoreType, a.scoreVal));
    }

    _buildPositionSummary(fen, lines, fallbackBestMove, stats) {
        const safeFallbackBestMove = fallbackBestMove && fallbackBestMove !== '(none)'
            ? fallbackBestMove
            : null;
        const topLines = lines.map((line) => ({
            ...line,
            bestMove: line.bestMove || line.moves[0] || null,
        }));
        const primary = topLines[0] || null;

        return {
            fen,
            bestMove: primary?.bestMove || safeFallbackBestMove,
            score: primary?.score || '0.00',
            numericScore: primary?.numericScore ?? 0,
            depth: primary?.depth || stats.depth || 0,
            topLines,
            stats: {
                depth: stats.depth || 0,
                timeMs: stats.time || 0,
                nodes: stats.nodes || 0,
            },
        };
    }

    setMode(mode) { this._mode = mode; }
    setDepth(depth) { this._depth = depth; }
    setMoveTime(ms) { this._moveTime = ms; }

    getBestMove(fen) {
        if (!fen) return;
        if (!this.ready) {
            this.whenReady().then(() => this.getBestMove(fen));
            return;
        }

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
        if (!fen) return;
        if (!this.ready) {
            this.whenReady().then(() => this.analyzePosition(fen, numLines, maxDepth));
            return;
        }

        this._isAnalyzing = true;
        this._analysisLines = {};
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = Date.now();
        this.worker.postMessage('stop');
        this.worker.postMessage(`setoption name MultiPV value ${numLines}`);
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${maxDepth}`);
    }

    analyzeGame(fens, optionsOrDepth = 17, onProgress, onDone) {
        const options = typeof optionsOrDepth === 'number'
            ? { targetDepth: optionsOrDepth, numLines: 1, onProgress, onDone }
            : (optionsOrDepth || {});

        const {
            targetDepth = 17,
            numLines = 5,
            onProgress: progressHandler,
            onPositionDone,
            onDone: doneHandler,
        } = options;

        if (!Array.isArray(fens) || fens.length === 0) {
            if (doneHandler) doneHandler([]);
            return;
        }

        this.whenReady().then(() => {
            let currentIndex = 0;
            const results = [];
            const originalOnMessage = this.worker.onmessage;

            let currentLines = {};
            let currentStats = { depth: 0, time: 0, nodes: 0 };

            const restoreWorker = () => {
                this.worker.onmessage = originalOnMessage;
                this.worker.postMessage('setoption name MultiPV value 1');
            };

            const processNext = () => {
                if (currentIndex >= fens.length) {
                    restoreWorker();
                    if (doneHandler) doneHandler(results);
                    return;
                }

                currentLines = {};
                currentStats = { depth: 0, time: 0, nodes: 0 };
                if (progressHandler) progressHandler(currentIndex, fens.length);

                this.worker.postMessage(`position fen ${fens[currentIndex]}`);
                this.worker.postMessage(`go depth ${targetDepth}`);
            };

            this.worker.postMessage('stop');
            this.worker.postMessage(`setoption name MultiPV value ${numLines}`);

            this.worker.onmessage = (e) => {
                const line = typeof e.data === 'string' ? e.data : e.data?.data;
                if (!line) return;

                if (line.startsWith('info') && line.includes('depth')) {
                    this._captureAnalysisLine(line, currentStats, currentLines);
                    return;
                }

                if (!line.startsWith('bestmove')) return;

                const fallbackBestMove = line.split(' ')[1];
                const lines = this._getAnalysisArray(currentLines);
                const summary = this._buildPositionSummary(
                    fens[currentIndex],
                    lines,
                    fallbackBestMove,
                    currentStats
                );

                results.push(summary);
                if (onPositionDone) onPositionDone(summary, currentIndex, fens.length);
                currentIndex += 1;
                processNext();
            };

            processNext();
        });
    }

    stopAnalysis() {
        this._isAnalyzing = false;
        if (this.worker) {
            this.worker.postMessage('stop');
        }
    }

    destroy() {
        this._readyResolvers.splice(0).forEach((resolve) => resolve());
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
