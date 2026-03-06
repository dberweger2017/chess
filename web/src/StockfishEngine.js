// StockfishEngine.js — Wrapper for Stockfish WASM Web Worker

export class StockfishEngine {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.onBestMove = null;  // (uciMove, stats) => void
        this._mode = 'depth';    // 'depth' or 'time'
        this._depth = 15;
        this._moveTime = 3000;   // ms
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = 0;
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
                console.log('Stockfish engine ready.');
            }

            // Parse info lines for stats (depth, time, nodes)
            if (line.startsWith('info') && line.includes('depth')) {
                const depthMatch = line.match(/\bdepth (\d+)/);
                const timeMatch = line.match(/\btime (\d+)/);
                const nodesMatch = line.match(/\bnodes (\d+)/);
                if (depthMatch) this._currentStats.depth = parseInt(depthMatch[1]);
                if (timeMatch) this._currentStats.time = parseInt(timeMatch[1]);
                if (nodesMatch) this._currentStats.nodes = parseInt(nodesMatch[1]);
            }

            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const bestMove = parts[1];
                // Compute wall-clock time as fallback
                const wallTime = Date.now() - this._searchStart;
                const stats = {
                    depth: this._currentStats.depth,
                    timeMs: this._currentStats.time || wallTime,
                    nodes: this._currentStats.nodes,
                };
                if (this.onBestMove) {
                    this.onBestMove(bestMove, stats);
                }
            }
        };
        this.worker.postMessage('uci');
    }

    setMode(mode) { this._mode = mode; }
    setDepth(depth) { this._depth = depth; }
    setMoveTime(ms) { this._moveTime = ms; }

    getBestMove(fen) {
        if (!this.ready) {
            console.warn('Stockfish not ready yet');
            return;
        }
        this._currentStats = { depth: 0, time: 0, nodes: 0 };
        this._searchStart = Date.now();
        this.worker.postMessage(`position fen ${fen}`);
        if (this._mode === 'time') {
            this.worker.postMessage(`go movetime ${this._moveTime}`);
        } else {
            this.worker.postMessage(`go depth ${this._depth}`);
        }
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
