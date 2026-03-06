# Chess App

A modern, fast, real-time multiplayer Chess application built with React, Node.js, and Socket.io. Features a custom procedural chess engine written in vanilla JavaScript and premium SVG piece graphics.

## Features

- **Local & Online Multiplayer**: Play matches via simple 3-character room codes.
- **Matchmaking**: Click "Find Random Match" to jump right into a game with anyone in the queue.
- **Move History**: Complete board state is tracked after every move. Hover over past moves to analyze the state of the game historically.
- **Spectator Mode (Live Games)**: Jump into an ongoing game to watch players compete in real time.
- **Past Games**: A persistent SQLite database automatically records completed games, giving you access to historical play data.
- **Legal Move Assistance**: Highlights all valid spaces a selected piece can move to.
- **Premium UI**: Crafted with a beautiful glassmorphism aesthetic and customized high-res vector graphics for all pieces.

## Architecture

1.  **`/web` (Frontend)**: A Vite + React application handling the UI, engine logic (`ChessEngine.js`), and socket listeners.
2.  **`/server` (Backend)**: An Express + Socket.io Node server acting as the communication relay point. Records game histories into a local SQLite database (`games.db`).

## Setup & Run

You need two terminals to run the application (one for the frontend, one for the backend).

### 1. Start the Backend Server
```bash
cd server
npm install
node index.js
```

### 2. Start the Frontend Application
In a separate terminal:
```bash
cd web
npm install
npm run dev
```

Open your browser to the local URL provided by Vite (usually `http://localhost:5173`).

---
Built as a personal passion project.
