// =========================================
// ChessEngine.js — Full Legal Chess Engine
// =========================================

// ── Helpers ──
const FILES = 'abcdefgh';
function posToCoord(pos) {
    return [pos.charCodeAt(0) - 97, parseInt(pos[1]) - 1];
}
function coordToPos([x, y]) {
    return FILES[x] + (y + 1);
}
function inBounds(x, y) {
    return x >= 0 && x <= 7 && y >= 0 && y <= 7;
}

// ── Piece Classes ──
export class Piece {
    constructor(color, position, type) {
        this.color = color;
        this.position = position;
        this.type = type;
    }
    clone() {
        const p = new this.constructor(this.color, this.position);
        p.hasMoved = this.hasMoved;
        return p;
    }
    // Raw pseudo-legal moves (ignoring check)
    pseudoMoves(board) { return []; }
}

export class Pawn extends Piece {
    constructor(color, position) {
        super(color, position, 'pawn');
    }
    pseudoMoves(board) {
        const moves = [];
        const [x, y] = posToCoord(this.position);
        const dir = this.color === 'white' ? 1 : -1;
        const startRank = this.color === 'white' ? 1 : 6;
        const promoRank = this.color === 'white' ? 7 : 0;

        // Forward
        const fy = y + dir;
        if (inBounds(x, fy)) {
            const fPos = coordToPos([x, fy]);
            if (!board.pieces[fPos]) {
                moves.push({ from: this.position, to: fPos, promotion: fy === promoRank });
                // Double move
                const ffy = y + 2 * dir;
                if (y === startRank && inBounds(x, ffy)) {
                    const ffPos = coordToPos([x, ffy]);
                    if (!board.pieces[ffPos]) {
                        moves.push({ from: this.position, to: ffPos });
                    }
                }
            }
        }

        // Captures (including en passant)
        for (const dx of [-1, 1]) {
            const nx = x + dx;
            const ny = y + dir;
            if (!inBounds(nx, ny)) continue;
            const cPos = coordToPos([nx, ny]);
            const target = board.pieces[cPos];
            if (target && target.color !== this.color) {
                moves.push({ from: this.position, to: cPos, promotion: ny === promoRank });
            }
            // En passant
            if (cPos === board.enPassantSquare) {
                moves.push({ from: this.position, to: cPos, enPassant: true });
            }
        }
        return moves;
    }
}

export class Rook extends Piece {
    constructor(color, position) {
        super(color, position, 'rook');
        this.hasMoved = false;
    }
    pseudoMoves(board) {
        return slidingMoves(this, board, [[0, 1], [0, -1], [1, 0], [-1, 0]]);
    }
}

export class Knight extends Piece {
    constructor(color, position) {
        super(color, position, 'knight');
    }
    pseudoMoves(board) {
        const moves = [];
        const [x, y] = posToCoord(this.position);
        for (const [dx, dy] of [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (inBounds(nx, ny)) {
                const pos = coordToPos([nx, ny]);
                if (!board.pieces[pos] || board.pieces[pos].color !== this.color) {
                    moves.push({ from: this.position, to: pos });
                }
            }
        }
        return moves;
    }
}

export class Bishop extends Piece {
    constructor(color, position) {
        super(color, position, 'bishop');
    }
    pseudoMoves(board) {
        return slidingMoves(this, board, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    }
}

export class Queen extends Piece {
    constructor(color, position) {
        super(color, position, 'queen');
    }
    pseudoMoves(board) {
        return slidingMoves(this, board, [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
    }
}

export class King extends Piece {
    constructor(color, position) {
        super(color, position, 'king');
        this.hasMoved = false;
    }
    pseudoMoves(board) {
        const moves = [];
        const [x, y] = posToCoord(this.position);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (inBounds(nx, ny)) {
                    const pos = coordToPos([nx, ny]);
                    if (!board.pieces[pos] || board.pieces[pos].color !== this.color) {
                        moves.push({ from: this.position, to: pos });
                    }
                }
            }
        }
        // Castling
        if (!this.hasMoved && !board.isSquareAttacked(this.position, this.color === 'white' ? 'black' : 'white')) {
            const rank = this.color === 'white' ? 1 : 8;
            const enemy = this.color === 'white' ? 'black' : 'white';

            // Kingside
            const rookKS = board.pieces[`h${rank}`];
            if (rookKS && rookKS.type === 'rook' && rookKS.color === this.color && !rookKS.hasMoved) {
                if (!board.pieces[`f${rank}`] && !board.pieces[`g${rank}`] &&
                    !board.isSquareAttacked(`f${rank}`, enemy) &&
                    !board.isSquareAttacked(`g${rank}`, enemy)) {
                    moves.push({ from: this.position, to: `g${rank}`, castling: 'kingside' });
                }
            }
            // Queenside
            const rookQS = board.pieces[`a${rank}`];
            if (rookQS && rookQS.type === 'rook' && rookQS.color === this.color && !rookQS.hasMoved) {
                if (!board.pieces[`d${rank}`] && !board.pieces[`c${rank}`] && !board.pieces[`b${rank}`] &&
                    !board.isSquareAttacked(`d${rank}`, enemy) &&
                    !board.isSquareAttacked(`c${rank}`, enemy)) {
                    moves.push({ from: this.position, to: `c${rank}`, castling: 'queenside' });
                }
            }
        }
        return moves;
    }
}

function slidingMoves(piece, board, dirs) {
    const moves = [];
    const [x, y] = posToCoord(piece.position);
    for (const [dx, dy] of dirs) {
        for (let i = 1; i < 8; i++) {
            const nx = x + dx * i, ny = y + dy * i;
            if (!inBounds(nx, ny)) break;
            const pos = coordToPos([nx, ny]);
            if (board.pieces[pos]) {
                if (board.pieces[pos].color !== piece.color) moves.push({ from: piece.position, to: pos });
                break;
            }
            moves.push({ from: piece.position, to: pos });
        }
    }
    return moves;
}

// ── Board ──
export class Board {
    constructor() {
        this.pieces = {};
        this.turn = 'white';
        this.history = [];
        this.enPassantSquare = null;
        this.halfMoveClock = 0;
        this.fullMoveNumber = 1;
        this.gameStatus = 'active'; // 'active', 'checkmate', 'stalemate', 'draw'
        this.reset();
    }

    static posToCoord(pos) { return posToCoord(pos); }
    static coordToPos(c) { return coordToPos(c); }
    posToCoord(pos) { return posToCoord(pos); }
    coordToPos(c) { return coordToPos(c); }

    clonePieces() {
        const cloned = {};
        for (const [pos, piece] of Object.entries(this.pieces)) {
            cloned[pos] = piece.clone();
        }
        return cloned;
    }

    placePiece(piece, position) {
        this.pieces[position] = piece;
        piece.position = position;
    }

    createSnapshot(moveText) {
        return {
            move: moveText,
            pieces: this.clonePieces(),
            turn: this.turn,
            enPassantSquare: this.enPassantSquare,
            halfMoveClock: this.halfMoveClock,
            fullMoveNumber: this.fullMoveNumber,
            gameStatus: this.gameStatus
        };
    }

    // Check if a square is attacked by attackerColor
    isSquareAttacked(square, attackerColor) {
        for (const piece of Object.values(this.pieces)) {
            if (piece.color !== attackerColor) continue;
            // For pawns, only check diagonal attack squares (not forward moves)
            if (piece.type === 'pawn') {
                const [px, py] = posToCoord(piece.position);
                const dir = piece.color === 'white' ? 1 : -1;
                for (const dx of [-1, 1]) {
                    const ax = px + dx, ay = py + dir;
                    if (inBounds(ax, ay) && coordToPos([ax, ay]) === square) return true;
                }
            } else if (piece.type === 'king') {
                // King attacks adjacent squares (but don't recurse castling)
                const [kx, ky] = posToCoord(piece.position);
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        if (inBounds(kx + dx, ky + dy) && coordToPos([kx + dx, ky + dy]) === square) return true;
                    }
                }
            } else {
                const pMoves = piece.pseudoMoves(this);
                if (pMoves.some(m => m.to === square)) return true;
            }
        }
        return false;
    }

    // Find the king position for a given color
    findKing(color) {
        for (const [pos, piece] of Object.entries(this.pieces)) {
            if (piece.type === 'king' && piece.color === color) return pos;
        }
        return null;
    }

    isInCheck(color) {
        const kingPos = this.findKing(color);
        if (!kingPos) return false;
        const enemy = color === 'white' ? 'black' : 'white';
        return this.isSquareAttacked(kingPos, enemy);
    }

    // Get all fully legal moves for the current turn
    getLegalMoves(color) {
        color = color || this.turn;
        const legalMoves = [];

        for (const piece of Object.values(this.pieces)) {
            if (piece.color !== color) continue;
            const pseudos = piece.pseudoMoves(this);
            for (const move of pseudos) {
                // Simulate the move and check if king is still safe
                if (this.isMoveLegal(move, color)) {
                    legalMoves.push(move);
                }
            }
        }
        return legalMoves;
    }

    // Get legal destination squares for a specific piece (used by UI)
    getLegalMovesForPiece(pos) {
        const piece = this.pieces[pos];
        if (!piece || piece.color !== this.turn) return [];
        const pseudos = piece.pseudoMoves(this);
        return pseudos.filter(m => this.isMoveLegal(m, piece.color)).map(m => m.to);
    }

    // Simulate a move and check if king remains safe
    isMoveLegal(move, color) {
        // Save state
        const savedPieces = this.clonePieces();
        const savedEP = this.enPassantSquare;

        // Apply move on a temporary basis
        this._applyMoveRaw(move);

        const kingPos = this.findKing(color);
        const enemy = color === 'white' ? 'black' : 'white';
        const inCheck = kingPos ? this.isSquareAttacked(kingPos, enemy) : true;

        // Restore
        this.pieces = savedPieces;
        this.enPassantSquare = savedEP;

        return !inCheck;
    }

    // Apply move without legality checks (used internally)
    _applyMoveRaw(move) {
        const piece = this.pieces[move.from];
        if (!piece) return;

        // Handle en passant capture
        if (move.enPassant) {
            const [ex, ey] = posToCoord(move.to);
            const capturedPawnPos = coordToPos([ex, ey + (piece.color === 'white' ? -1 : 1)]);
            delete this.pieces[capturedPawnPos];
        }

        // Handle castling
        if (move.castling) {
            const rank = piece.color === 'white' ? 1 : 8;
            if (move.castling === 'kingside') {
                const rook = this.pieces[`h${rank}`];
                delete this.pieces[`h${rank}`];
                this.placePiece(rook, `f${rank}`);
                rook.hasMoved = true;
            } else {
                const rook = this.pieces[`a${rank}`];
                delete this.pieces[`a${rank}`];
                this.placePiece(rook, `d${rank}`);
                rook.hasMoved = true;
            }
        }

        // Capture
        delete this.pieces[move.to];

        // Move the piece
        delete this.pieces[move.from];
        this.placePiece(piece, move.to);

        // Promotion (auto-queen)
        if (move.promotion) {
            const queen = new Queen(piece.color, move.to);
            this.placePiece(queen, move.to);
        }

        // Track hasMoved
        if (piece.type === 'king' || piece.type === 'rook') {
            piece.hasMoved = true;
        }
    }

    // Public movePiece — validates legality, updates state, detects game end
    movePiece(startPos, endPos) {
        if (this.gameStatus !== 'active') return false;

        const piece = this.pieces[startPos];
        if (!piece || piece.color !== this.turn) return false;

        // Find the matching legal move
        const legalMoves = this.getLegalMoves(this.turn);
        const move = legalMoves.find(m => m.from === startPos && m.to === endPos);
        if (!move) return false;

        // Update en passant square
        const oldEP = this.enPassantSquare;
        this.enPassantSquare = null;
        if (piece.type === 'pawn') {
            const [, sy] = posToCoord(startPos);
            const [, ey] = posToCoord(endPos);
            if (Math.abs(ey - sy) === 2) {
                // Set en passant target square
                const epY = (sy + ey) / 2;
                this.enPassantSquare = coordToPos([posToCoord(startPos)[0], epY]);
            }
        }

        // Half-move clock
        if (piece.type === 'pawn' || this.pieces[endPos]) {
            this.halfMoveClock = 0;
        } else {
            this.halfMoveClock++;
        }

        // Apply the move
        this._applyMoveRaw(move);

        // Switch turn
        this.turn = this.turn === 'white' ? 'black' : 'white';
        if (this.turn === 'white') this.fullMoveNumber++;

        // Build move notation
        let moveText;
        if (move.castling === 'kingside') {
            moveText = 'O-O';
        } else if (move.castling === 'queenside') {
            moveText = 'O-O-O';
        } else {
            moveText = piece.type === 'knight' ? 'N' : (piece.type === 'pawn' ? '' : piece.type.charAt(0).toUpperCase());
            moveText += startPos;
            moveText += move.enPassant || this.pieces[endPos] ? 'x' : '-';
            moveText += endPos;
            if (move.promotion) moveText += '=Q';
        }

        // Check / checkmate symbols
        const opponentLegalMoves = this.getLegalMoves(this.turn);
        if (this.isInCheck(this.turn)) {
            if (opponentLegalMoves.length === 0) {
                moveText += '#';
                this.gameStatus = 'checkmate';
            } else {
                moveText += '+';
            }
        } else if (opponentLegalMoves.length === 0) {
            this.gameStatus = 'stalemate';
        }

        // Save to history
        this.history.push(this.createSnapshot(moveText));

        return true;
    }

    // Convert current board to FEN string
    toFEN() {
        let fen = '';

        // 1. Piece placement
        for (let rank = 7; rank >= 0; rank--) {
            let empty = 0;
            for (let file = 0; file < 8; file++) {
                const pos = coordToPos([file, rank]);
                const piece = this.pieces[pos];
                if (piece) {
                    if (empty > 0) { fen += empty; empty = 0; }
                    const typeMap = { pawn: 'p', rook: 'r', knight: 'n', bishop: 'b', queen: 'q', king: 'k' };
                    const ch = typeMap[piece.type];
                    fen += piece.color === 'white' ? ch.toUpperCase() : ch;
                } else {
                    empty++;
                }
            }
            if (empty > 0) fen += empty;
            if (rank > 0) fen += '/';
        }

        // 2. Active color
        fen += ' ' + (this.turn === 'white' ? 'w' : 'b');

        // 3. Castling availability
        let castling = '';
        const whiteKing = this.findKing('white');
        const blackKing = this.findKing('black');
        if (whiteKing) {
            const wk = this.pieces[whiteKing];
            if (wk && !wk.hasMoved) {
                const rkH = this.pieces['h1'];
                if (rkH && rkH.type === 'rook' && !rkH.hasMoved) castling += 'K';
                const rkA = this.pieces['a1'];
                if (rkA && rkA.type === 'rook' && !rkA.hasMoved) castling += 'Q';
            }
        }
        if (blackKing) {
            const bk = this.pieces[blackKing];
            if (bk && !bk.hasMoved) {
                const rkH = this.pieces['h8'];
                if (rkH && rkH.type === 'rook' && !rkH.hasMoved) castling += 'k';
                const rkA = this.pieces['a8'];
                if (rkA && rkA.type === 'rook' && !rkA.hasMoved) castling += 'q';
            }
        }
        fen += ' ' + (castling || '-');

        // 4. En passant
        fen += ' ' + (this.enPassantSquare || '-');

        // 5. Half-move clock
        fen += ' ' + this.halfMoveClock;

        // 6. Full-move number
        fen += ' ' + this.fullMoveNumber;

        return fen;
    }

    reset() {
        this.pieces = {};
        this.turn = 'white';
        this.history = [];
        this.enPassantSquare = null;
        this.halfMoveClock = 0;
        this.fullMoveNumber = 1;
        this.gameStatus = 'active';
        this.setupBoard();
    }

    setupBoard() {
        const cols = 'abcdefgh';
        for (const c of cols) {
            this.placePiece(new Pawn('white', `${c}2`), `${c}2`);
            this.placePiece(new Pawn('black', `${c}7`), `${c}7`);
        }

        const setupRow = (color, rank) => {
            this.placePiece(new Rook(color, `a${rank}`), `a${rank}`);
            this.placePiece(new Knight(color, `b${rank}`), `b${rank}`);
            this.placePiece(new Bishop(color, `c${rank}`), `c${rank}`);
            this.placePiece(new Queen(color, `d${rank}`), `d${rank}`);
            this.placePiece(new King(color, `e${rank}`), `e${rank}`);
            this.placePiece(new Bishop(color, `f${rank}`), `f${rank}`);
            this.placePiece(new Knight(color, `g${rank}`), `g${rank}`);
            this.placePiece(new Rook(color, `h${rank}`), `h${rank}`);
        };

        setupRow('white', 1);
        setupRow('black', 8);

        this.history.push(this.createSnapshot('Start'));
    }
}
