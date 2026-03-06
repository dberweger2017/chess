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
      analysis TEXT,
      ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
            // Attempt to add column to existing DB, ignore error if it already exists
            db.run(`ALTER TABLE games ADD COLUMN analysis TEXT`, (err) => { });
        });
    }
});

function saveGame(roomCode, history, callback) {
    if (!history || history.length <= 1) {
        if (callback) callback(null);
        return;
    }

    const movesJson = JSON.stringify(history);
    db.run(`INSERT INTO games (room_code, moves) VALUES (?, ?)`, [roomCode, movesJson], function (err) {
        if (err) {
            console.error('Error saving game:', err);
            if (callback) callback(null);
        } else {
            console.log(`Game ${roomCode} saved to DB with ID ${this.lastID}`);
            if (callback) callback(this.lastID);
        }
    });
}

function saveAnalysis(gameId, analysisJson, callback) {
    db.run(`UPDATE games SET analysis = ? WHERE id = ?`, [JSON.stringify(analysisJson), gameId], function (err) {
        if (err) console.error('Error saving analysis:', err);
        if (callback) callback();
    });
}

function getPastGames(callback) {
    db.all(`SELECT id, room_code, ended_at, moves, analysis FROM games ORDER BY ended_at DESC LIMIT 20`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching past games:', err);
            callback([]);
        } else {
            callback(rows);
        }
    });
}

module.exports = { saveGame, saveAnalysis, getPastGames };
