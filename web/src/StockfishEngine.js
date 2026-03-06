// StockfishEngine.js — Wrapper for Stockfish WASM Web Worker

export class StockfishEngine {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.onBestMove = null;
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
            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const bestMove = parts[1]; // e.g. "e2e4"
                if (this.onBestMove) {
                    this.onBestMove(bestMove);
                }
            }
        };
        this.worker.postMessage('uci');
    }

    // Set engine skill level (0-20, default 20 = strongest)
    setSkillLevel(level) {
        this.worker.postMessage(`setoption name Skill Level value ${level}`);
    }

    // Set search depth
    setDepth(depth) {
        this._depth = depth || 15;
    }

    // Ask engine for best move given a FEN position
    getBestMove(fen) {
        if (!this.ready) {
            console.warn('Stockfish not ready yet');
            return;
        }
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${this._depth || 15}`);
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
