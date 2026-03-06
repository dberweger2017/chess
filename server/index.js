const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { saveGame, saveAnalysis, getPastGames } = require('./db');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = new Map();
let waitingPlayer = null;

function getProfileName(profile, fallback) {
    const name = profile?.name?.trim();
    return name || fallback;
}

function getSocketColor(room, socketId) {
    return room?.players?.[socketId] || null;
}

function getOpponentSocketId(room, socketId) {
    return Object.keys(room?.players || {}).find((id) => id !== socketId && id !== 'cpu') || null;
}

function inferResultFromHistory(history) {
    const lastSnapshot = history?.[history.length - 1];
    const lastStatus = lastSnapshot?.gameStatus;

    if (lastStatus === 'checkmate') {
        const winnerColor = lastSnapshot?.turn === 'white' ? 'black' : 'white';
        return {
            result: winnerColor === 'white' ? 'white_win' : 'black_win',
            winnerColor,
            termination: 'checkmate'
        };
    }

    if (lastStatus === 'stalemate' || lastStatus === 'draw') {
        return {
            result: 'draw',
            winnerColor: null,
            termination: lastStatus === 'draw' ? 'draw_agreement' : 'stalemate'
        };
    }

    return {
        result: null,
        winnerColor: null,
        termination: null
    };
}

function buildGameMetadata(room, roomCode, history, overrides = {}) {
    const inferred = inferResultFromHistory(history);
    return {
        gameName: overrides.gameName || (roomCode === 'CPU' ? 'CPU Match' : `Game ${roomCode}`),
        whiteName: overrides.whiteName || getProfileName(room?.profiles?.white, 'White'),
        blackName: overrides.blackName || getProfileName(room?.profiles?.black, room?.isCPU ? 'Stockfish' : 'Black'),
        result: overrides.result ?? inferred.result,
        winnerColor: overrides.winnerColor ?? inferred.winnerColor,
        termination: overrides.termination ?? inferred.termination
    };
}

function broadcastWaitingCount() {
    io.emit('waiting_count', waitingPlayer ? 1 : 0);
}

function broadcastLiveGames() {
    const liveGames = [];
    rooms.forEach((roomData, code) => {
        if (roomData.full && !roomData.finished) {
            const whiteHandle = getProfileName(roomData.profiles?.white, 'White');
            const blackHandle = getProfileName(roomData.profiles?.black, roomData.isCPU ? 'Stockfish' : 'Black');
            liveGames.push({
                code,
                moves: roomData.history?.length || 0,
                players: `${whiteHandle} vs ${blackHandle}`
            });
        }
    });
    io.emit('live_games_list', liveGames);
}

setInterval(broadcastLiveGames, 5000);

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 3; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createRoomState(base) {
    return {
        history: [],
        full: false,
        finished: false,
        saved: false,
        drawOffer: null,
        ...base
    };
}

function saveFinishedRoomGame(code, room, history, overrides = {}) {
    if (!room || room.saved) return;

    room.saved = true;
    room.finished = true;
    room.drawOffer = null;

    const metadata = buildGameMetadata(room, code, history, overrides);
    saveGame(code, history, metadata, (id) => {
        if (id) {
            io.to(code).emit('game_saved', id);
        }
        broadcastLiveGames();
    });
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create_game', (data) => {
        let code = generateRoomCode();
        while (rooms.has(code)) {
            code = generateRoomCode();
        }

        rooms.set(code, createRoomState({
            players: { [socket.id]: 'white' },
            profiles: { white: data?.profile || { name: 'White' } }
        }));

        socket.join(code);
        socket.emit('game_created', { code, color: 'white' });
        console.log(`Room ${code} created by ${socket.id} (white)`);
    });

    socket.on('create_cpu_game', (data) => {
        let code = generateRoomCode();
        while (rooms.has(code)) {
            code = generateRoomCode();
        }

        rooms.set(code, createRoomState({
            players: { [socket.id]: 'white', 'cpu': 'black' },
            profiles: {
                white: data?.profile || { name: 'White' },
                black: { name: 'Stockfish' }
            },
            full: true,
            isCPU: true
        }));

        socket.join(code);
        socket.emit('cpu_game_created', code);
        broadcastLiveGames();
        console.log(`User ${socket.id} started CPU game (Room ${code})`);
    });

    socket.on('join_game', (data) => {
        const code = (typeof data === 'string' ? data : data.code).toUpperCase();
        const room = rooms.get(code);

        if (!room) {
            socket.emit('join_error', 'Invalid room code.');
            return;
        }

        if (room.full) {
            socket.emit('join_error', 'Room is already full.');
            return;
        }

        room.players[socket.id] = 'black';
        if (!room.profiles) room.profiles = {};
        room.profiles.black = (data && data.profile) || { name: 'Black' };
        room.full = true;
        rooms.set(code, room);

        socket.join(code);
        socket.emit('game_joined', { code, color: 'black' });
        broadcastLiveGames();
        console.log(`User ${socket.id} joined room ${code} (black)`);

        io.to(code).emit('game_start', { message: 'Opponent joined. White to move.' });
    });

    socket.on('find_game', (data) => {
        if (!waitingPlayer || waitingPlayer.id === socket.id) {
            let code = generateRoomCode();
            while (rooms.has(code)) {
                code = generateRoomCode();
            }

            rooms.set(code, createRoomState({
                players: { [socket.id]: 'white' },
                profiles: { white: data?.profile || { name: 'White' } }
            }));

            waitingPlayer = { id: socket.id, code };
            broadcastWaitingCount();
            socket.join(code);
            socket.emit('game_created', { code, color: 'white' });
            socket.emit('waiting_for_match');
            console.log(`User ${socket.id} is waiting for a match (Room ${code})`);
            return;
        }

        const code = waitingPlayer.code;
        const room = rooms.get(code);

        if (room) {
            room.players[socket.id] = 'black';
            if (!room.profiles) room.profiles = {};
            room.profiles.black = data?.profile || { name: 'Black' };
            room.full = true;
            rooms.set(code, room);

            socket.join(code);
            socket.emit('game_joined', { code, color: 'black' });
            console.log(`User ${socket.id} joined waiting player in room ${code} (black)`);

            io.to(code).emit('game_start', { message: 'Match found! White to move.' });
            broadcastLiveGames();
        }

        waitingPlayer = null;
        broadcastWaitingCount();
    });

    socket.on('cancel_find_game', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            rooms.delete(waitingPlayer.code);
            socket.leave(waitingPlayer.code);
            waitingPlayer = null;
            broadcastWaitingCount();
            console.log(`User ${socket.id} cancelled matchmaking.`);
        }
    });

    socket.on('make_move', ({ code, startPos, endPos, newHistoryItem }) => {
        const room = rooms.get(code);
        if (!room || room.finished) return;

        socket.to(code).emit('opponent_move', { startPos, endPos });

        if (newHistoryItem) {
            room.history.push(newHistoryItem);
            room.drawOffer = null;
            broadcastLiveGames();
        }
    });

    socket.on('get_live_games', () => {
        const liveGames = [];
        rooms.forEach((roomData, code) => {
            if (roomData.full && !roomData.finished) {
                liveGames.push({ code, moves: roomData.history.length });
            }
        });
        socket.emit('live_games_list', liveGames);
    });

    socket.on('get_waiting_count', () => {
        socket.emit('waiting_count', waitingPlayer ? 1 : 0);
    });

    socket.on('spectate_game', (code) => {
        const room = rooms.get(code);
        if (room) {
            socket.join(code);
            socket.emit('spectator_joined', { code, history: room.history });
        } else {
            socket.emit('join_error', 'Game no longer exists.');
        }
    });

    socket.on('save_cpu_game', ({ code, history }) => {
        const room = rooms.get(code);
        const metadata = buildGameMetadata(room, 'CPU', history);
        saveGame('CPU', history, metadata, (id) => {
            if (room) {
                room.saved = true;
                room.finished = true;
            }
            if (id) socket.emit('game_saved', id);
            broadcastLiveGames();
        });
    });

    socket.on('save_multiplayer_game', ({ code, history, result }) => {
        const room = rooms.get(code);
        if (room && !room.saved) {
            saveFinishedRoomGame(code, room, history, result || {});
        }
    });

    socket.on('resign_game', ({ code }) => {
        const room = rooms.get(code);
        const resigningColor = getSocketColor(room, socket.id);
        if (!room || room.finished || !resigningColor) return;

        const winnerColor = resigningColor === 'white' ? 'black' : 'white';
        io.to(code).emit('game_ended', {
            result: winnerColor === 'white' ? 'white_win' : 'black_win',
            winnerColor,
            termination: 'resignation',
            message: `${winnerColor === 'white' ? 'White' : 'Black'} wins by surrender.`
        });

        saveFinishedRoomGame(code, room, room.history, {
            result: winnerColor === 'white' ? 'white_win' : 'black_win',
            winnerColor,
            termination: 'resignation'
        });
    });

    socket.on('offer_draw', ({ code }) => {
        const room = rooms.get(code);
        const color = getSocketColor(room, socket.id);
        if (!room || room.finished || !color || room.drawOffer) return;

        const opponentSocketId = getOpponentSocketId(room, socket.id);
        if (!opponentSocketId) return;

        room.drawOffer = { fromSocketId: socket.id, color };
        io.to(socket.id).emit('draw_offer_sent', { code });
        io.to(opponentSocketId).emit('draw_offer_received', {
            code,
            fromColor: color,
            fromName: getProfileName(room.profiles?.[color], color === 'white' ? 'White' : 'Black')
        });
    });

    socket.on('respond_draw_offer', ({ code, accepted }) => {
        const room = rooms.get(code);
        if (!room || room.finished || !room.drawOffer) return;

        const offeringSocketId = room.drawOffer.fromSocketId;
        room.drawOffer = null;

        if (accepted) {
            io.to(code).emit('game_ended', {
                result: 'draw',
                winnerColor: null,
                termination: 'draw_agreement',
                message: 'Tablas agreed.'
            });
            saveFinishedRoomGame(code, room, room.history, {
                result: 'draw',
                winnerColor: null,
                termination: 'draw_agreement'
            });
            return;
        }

        io.to(offeringSocketId).emit('draw_offer_declined');
    });

    socket.on('save_game_analysis', ({ id, analysis }) => {
        saveAnalysis(id, analysis);
    });

    socket.on('get_past_games', () => {
        getPastGames((games) => {
            socket.emit('past_games_list', games);
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        if (waitingPlayer && waitingPlayer.id === socket.id) {
            rooms.delete(waitingPlayer.code);
            waitingPlayer = null;
            broadcastWaitingCount();
        }

        rooms.forEach((roomData, code) => {
            if (!roomData.players[socket.id]) return;

            io.to(code).emit('opponent_disconnected');

            if (!roomData.saved && roomData.history.length > 2) {
                const disconnectColor = roomData.players[socket.id];
                const winnerColor = roomData.full && disconnectColor
                    ? (disconnectColor === 'white' ? 'black' : 'white')
                    : null;

                saveFinishedRoomGame(code, roomData, roomData.history, {
                    result: winnerColor ? (winnerColor === 'white' ? 'white_win' : 'black_win') : 'abandoned',
                    winnerColor,
                    termination: 'disconnect'
                });
            }

            rooms.delete(code);
            broadcastLiveGames();
        });
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
