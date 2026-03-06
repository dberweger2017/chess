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
      game_name TEXT,
      white_name TEXT,
      black_name TEXT,
      result TEXT,
      winner_color TEXT,
      termination TEXT,
      moves TEXT,
      analysis TEXT,
      ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
            const migrations = [
                `ALTER TABLE games ADD COLUMN analysis TEXT`,
                `ALTER TABLE games ADD COLUMN game_name TEXT`,
                `ALTER TABLE games ADD COLUMN white_name TEXT`,
                `ALTER TABLE games ADD COLUMN black_name TEXT`,
                `ALTER TABLE games ADD COLUMN result TEXT`,
                `ALTER TABLE games ADD COLUMN winner_color TEXT`,
                `ALTER TABLE games ADD COLUMN termination TEXT`
            ];

            migrations.forEach((sql) => {
                db.run(sql, () => { });
            });
        });
    }
});

function normalizeSaveParams(metadataOrCallback, maybeCallback) {
    if (typeof metadataOrCallback === 'function') {
        return { metadata: {}, callback: metadataOrCallback };
    }

    return {
        metadata: metadataOrCallback || {},
        callback: maybeCallback
    };
}

function saveGame(roomCode, history, metadataOrCallback, maybeCallback) {
    const { metadata, callback } = normalizeSaveParams(metadataOrCallback, maybeCallback);

    if (!history || history.length <= 1) {
        if (callback) callback(null);
        return;
    }

    const movesJson = JSON.stringify(history);
    const gameName = metadata.gameName || (roomCode === 'CPU' ? 'CPU Match' : `Game ${roomCode}`);
    const whiteName = metadata.whiteName || 'White';
    const blackName = metadata.blackName || 'Black';
    const result = metadata.result || null;
    const winnerColor = metadata.winnerColor || null;
    const termination = metadata.termination || null;

    db.run(
        `INSERT INTO games (room_code, game_name, white_name, black_name, result, winner_color, termination, moves)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [roomCode, gameName, whiteName, blackName, result, winnerColor, termination, movesJson],
        function (err) {
        if (err) {
            console.error('Error saving game:', err);
            if (callback) callback(null);
        } else {
            console.log(`Game ${roomCode} saved to DB with ID ${this.lastID}`);
            if (callback) callback(this.lastID);
        }
        }
    );
}

function saveAnalysis(gameId, analysisJson, callback) {
    db.run(`UPDATE games SET analysis = ? WHERE id = ?`, [JSON.stringify(analysisJson), gameId], function (err) {
        if (err) console.error('Error saving analysis:', err);
        if (callback) callback();
    });
}

function getPastGames(callback) {
    db.all(`SELECT id, room_code, game_name, white_name, black_name, result, winner_color, termination, ended_at, moves, analysis
            FROM games
            ORDER BY ended_at DESC
            LIMIT 20`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching past games:', err);
            callback([]);
        } else {
            callback(rows);
        }
    });
}

module.exports = { saveGame, saveAnalysis, getPastGames };
