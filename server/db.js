const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'games.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT,
      moves TEXT,
      ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    }
});

function saveGame(roomCode, history) {
    if (!history || history.length <= 1) return; // Don't save games with 0 moves (Start state only)

    const movesJson = JSON.stringify(history);
    db.run(`INSERT INTO games (room_code, moves) VALUES (?, ?)`, [roomCode, movesJson], function (err) {
        if (err) {
            console.error('Error saving game:', err);
        } else {
            console.log(`Game ${roomCode} saved to DB with ID ${this.lastID}`);
        }
    });
}

function getPastGames(callback) {
    db.all(`SELECT id, room_code, ended_at, moves FROM games ORDER BY ended_at DESC LIMIT 20`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching past games:', err);
            callback([]);
        } else {
            callback(rows);
        }
    });
}

module.exports = { saveGame, getPastGames };
