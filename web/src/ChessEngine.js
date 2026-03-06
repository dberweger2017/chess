export class Piece {
    constructor(color, position, type) {
        this.color = color;
        this.position = position;
        this.type = type;
    }

    getMoves(board) {
        return [];
    }
}

export class Pawn extends Piece {
    constructor(color, position) {
        super(color, position, 'pawn');
    }

    getMoves(board) {
        const moves = [];
        const [x, y] = board.posToCoord(this.position);
        const direction = this.color === 'white' ? 1 : -1;

        // Forward move
        const fy = y + direction;
        if (fy >= 0 && fy <= 7) {
            const fPos = board.coordToPos([x, fy]);
            if (!board.pieces[fPos]) {
                moves.push(fPos);
                // Double move
                const startRank = this.color === 'white' ? 1 : 6;
                const ffy = y + 2 * direction;
                const ffPos = board.coordToPos([x, ffy]);
                if (y === startRank && !board.pieces[ffPos]) {
                    moves.push(ffPos);
                }
            }
        }

        // Captures
        const dxs = [-1, 1];
        for (const dx of dxs) {
            const nx = x + dx;
            const ny = y + direction;
            if (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
                const cPos = board.coordToPos([nx, ny]);
                if (board.pieces[cPos] && board.pieces[cPos].color !== this.color) {
                    moves.push(cPos);
                }
            }
        }

        return moves;
    }
}

export class Rook extends Piece {
    constructor(color, position) {
        super(color, position, 'rook');
    }

    getMoves(board) {
        const moves = [];
        const [x, y] = board.posToCoord(this.position);
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
            for (let i = 1; i < 8; i++) {
                const nx = x + dx * i;
                const ny = y + dy * i;
                if (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
                    const pos = board.coordToPos([nx, ny]);
                    if (board.pieces[pos]) {
                        if (board.pieces[pos].color !== this.color) moves.push(pos);
                        break;
                    }
                    moves.push(pos);
                } else break;
            }
        }
        return moves;
    }
}

export class Knight extends Piece {
    constructor(color, position) {
        super(color, position, 'knight');
    }

    getMoves(board) {
        const moves = [];
        const [x, y] = board.posToCoord(this.position);
        const jumps = [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
        for (const [dx, dy] of jumps) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
                const pos = board.coordToPos([nx, ny]);
                if (!board.pieces[pos] || board.pieces[pos].color !== this.color) {
                    moves.push(pos);
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

    getMoves(board) {
        const moves = [];
        const [x, y] = board.posToCoord(this.position);
        const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dx, dy] of dirs) {
            for (let i = 1; i < 8; i++) {
                const nx = x + dx * i;
                const ny = y + dy * i;
                if (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
                    const pos = board.coordToPos([nx, ny]);
                    if (board.pieces[pos]) {
                        if (board.pieces[pos].color !== this.color) moves.push(pos);
                        break;
                    }
                    moves.push(pos);
                } else break;
            }
        }
        return moves;
    }
}

export class Queen extends Piece {
    constructor(color, position) {
        super(color, position, 'queen');
    }

    getMoves(board) {
        const moves = [];
        const [x, y] = board.posToCoord(this.position);
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dx, dy] of dirs) {
            for (let i = 1; i < 8; i++) {
                const nx = x + dx * i;
                const ny = y + dy * i;
                if (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
                    const pos = board.coordToPos([nx, ny]);
                    if (board.pieces[pos]) {
                        if (board.pieces[pos].color !== this.color) moves.push(pos);
                        break;
                    }
                    moves.push(pos);
                } else break;
            }
        }
        return moves;
    }
}

export class King extends Piece {
    constructor(color, position) {
        super(color, position, 'king');
    }

    getMoves(board) {
        const moves = [];
        const [x, y] = board.posToCoord(this.position);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
                    const pos = board.coordToPos([nx, ny]);
                    if (!board.pieces[pos] || board.pieces[pos].color !== this.color) {
                        moves.push(pos);
                    }
                }
            }
        }
        return moves;
    }
}

export class Board {
    constructor() {
        this.pieces = {};
        this.turn = 'white';
        this.history = [];
        this.reset();
    }

    clonePieces() {
        const cloned = {};
        for (const [pos, piece] of Object.entries(this.pieces)) {
            cloned[pos] = Object.assign(Object.create(Object.getPrototypeOf(piece)), piece);
        }
        return cloned;
    }

    static posToCoord(pos) {
        return [pos.charCodeAt(0) - 'a'.charCodeAt(0), parseInt(pos[1]) - 1];
    }

    static coordToPos([x, y]) {
        return String.fromCharCode(x + 'a'.charCodeAt(0)) + (y + 1);
    }

    posToCoord(pos) { return Board.posToCoord(pos); }
    coordToPos(coord) { return Board.coordToPos(coord); }

    placePiece(piece, position) {
        this.pieces[position] = piece;
        piece.position = position;
    }

    movePiece(startPos, endPos) {
        const piece = this.pieces[startPos];
        if (!piece || piece.color !== this.turn) return false;

        // Simple verification
        const moves = piece.getMoves(this);
        if (!moves.includes(endPos)) return false;

        delete this.pieces[startPos];
        this.placePiece(piece, endPos);
        this.turn = this.turn === 'white' ? 'black' : 'white';

        let moveText = piece.type === 'knight' ? 'N' : (piece.type === 'pawn' ? '' : piece.type.charAt(0).toUpperCase());
        moveText += `${startPos}-${endPos}`;

        this.history.push({
            move: moveText,
            pieces: this.clonePieces()
        });

        return true;
    }

    reset() {
        this.pieces = {};
        this.turn = 'white';
        this.history = [];
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

        this.history.push({
            move: 'Start',
            pieces: this.clonePieces()
        });
    }
}
