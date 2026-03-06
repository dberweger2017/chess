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
        origin: "*", // Allow Vite local dev
        methods: ["GET", "POST"]
    }
});

// Store active rooms
const rooms = new Map();

// Matchmaking waiting queue (stores socket.id)
let waitingPlayer = null;

function broadcastWaitingCount() {
    io.emit('waiting_count', waitingPlayer ? 1 : 0);
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 3; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create_game', () => {
        let code = generateRoomCode();
        while (rooms.has(code)) {
            code = generateRoomCode();
        }

        // Store room with the creator as white
        rooms.set(code, {
            players: { [socket.id]: 'white' },
            full: false
        });

        socket.join(code);
        socket.emit('game_created', { code, color: 'white' });
        console.log(`Room ${code} created by ${socket.id} (white)`);
    });

    socket.on('create_cpu_game', () => {
        let code = generateRoomCode();
        while (rooms.has(code)) {
            code = generateRoomCode();
        }

        rooms.set(code, {
            players: { [socket.id]: 'white', 'cpu': 'black' },
            full: true, // Show in live games immediately
            history: [],
            isCPU: true
        });

        socket.join(code);
        socket.emit('cpu_game_created', code);
        console.log(`User ${socket.id} started CPU game (Room ${code})`);
    });

    socket.on('join_game', (code) => {
        code = code.toUpperCase();
        const room = rooms.get(code);

        if (!room) {
            socket.emit('join_error', 'Invalid room code.');
            return;
        }

        if (room.full) {
            socket.emit('join_error', 'Room is already full.');
            return;
        }

        // Assign black to the second player
        room.players[socket.id] = 'black';
        room.full = true;
        rooms.set(code, room);

        socket.join(code);
        socket.emit('game_joined', { code, color: 'black' });
        console.log(`User ${socket.id} joined room ${code} (black)`);

        // Notify the room that game can start
        io.to(code).emit('game_start', { message: 'Opponent joined. White to move.' });
    });

    socket.on('find_game', () => {
        // If there is no one waiting, or if the current socket is the one waiting (prevent double-click bug)
        if (!waitingPlayer || waitingPlayer.id === socket.id) {
            let code = generateRoomCode();
            while (rooms.has(code)) {
                code = generateRoomCode();
            }

            rooms.set(code, {
                players: { [socket.id]: 'white' },
                full: false,
                history: [] // Start tracking move history for the DB
            });

            waitingPlayer = { id: socket.id, code: code };
            broadcastWaitingCount();
            socket.join(code);
            socket.emit('game_created', { code, color: 'white' });
            socket.emit('waiting_for_match'); // Custom event for the new UI state
            console.log(`User ${socket.id} is waiting for a match (Room ${code})`);
        } else {
            // Someone is waiting! Join their room
            const code = waitingPlayer.code;
            const room = rooms.get(code);

            if (room) {
                room.players[socket.id] = 'black';
                room.full = true;
                rooms.set(code, room);

                socket.join(code);
                socket.emit('game_joined', { code, color: 'black' });
                console.log(`User ${socket.id} joined waiting player in room ${code} (black)`);

                // Notify both players the match found!
                io.to(code).emit('game_start', { message: 'Match found! White to move.' });
            }
            // Reset waiting queue
            waitingPlayer = null;
            broadcastWaitingCount();
        }
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
        // Broadcast the move to the OTHER player in the room (and spectators)
        socket.to(code).emit('opponent_move', { startPos, endPos });

        // Save to server room state
        const room = rooms.get(code);
        if (room && newHistoryItem) {
            room.history.push(newHistoryItem);
        }
    });

    socket.on('get_live_games', () => {
        const liveGames = [];
        rooms.forEach((roomData, code) => {
            if (roomData.full) {
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
            // Send the current history to the spectator so they can build the board
            socket.emit('spectator_joined', { code, history: room.history });
        } else {
            socket.emit('join_error', 'Game no longer exists.');
        }
    });

    socket.on('save_cpu_game', ({ history }) => {
        saveGame('CPU', history, (id) => {
            if (id) socket.emit('game_saved', id);
        });
    });

    socket.on('save_multiplayer_game', ({ code, history }) => {
        const room = rooms.get(code);
        if (room && !room.saved) {
            room.saved = true; // Prevent double save
            saveGame(code, history, (id) => {
                if (id) {
                    io.to(code).emit('game_saved', id);
                }
            });
        }
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

        // Remove from waiting queue if they disconnect
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            rooms.delete(waitingPlayer.code);
            waitingPlayer = null;
            broadcastWaitingCount();
        }

        // Notify rooms the user was in and close them down
        rooms.forEach((roomData, code) => {
            if (roomData.players[socket.id]) {
                io.to(code).emit('opponent_disconnected');

                // Save to DB before destroying if not already saved
                if (!roomData.saved && roomData.history.length > 2) {
                    roomData.saved = true;
                    saveGame(code, roomData.history);
                }

                rooms.delete(code);
            }
        });
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
