const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Game State
const rooms = {};

// Helper to generate 6-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[code]);
    return code;
}

// Helper to calculate feedback
function calculateFeedback(guess, target) {
    let correct = 0;
    for (let i = 0; i < 5; i++) {
        if (guess[i] === target[i]) {
            correct++;
        }
    }
    return correct;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Create Room
    socket.on('createRoom', ({ nickname, userId, maxPlayers = 2 }) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            id: roomCode,
            players: {}, // userId -> { socketId, nickname, target, role, ready, online }
            playerIds: [], // List of userIds
            turnIndex: 0,
            history: [],
            status: 'waiting',
            inviteCode: roomCode,
            maxPlayers: parseInt(maxPlayers) || 2
        };

        joinRoom(socket, roomCode, nickname, userId);
    });

    // Join Room
    socket.on('joinRoom', ({ roomCode, nickname, userId }) => {
        if (!rooms[roomCode]) {
            socket.emit('error', '房间号错误或房间不存在');
            return;
        }
        
        // Check if user is reconnecting
        const room = rooms[roomCode];
        if (room.playerIds.includes(userId)) {
             // Reconnect logic
             reconnectUser(socket, room, userId);
             return;
        }

        if (room.playerIds.length >= room.maxPlayers) {
            socket.emit('error', '房间已满');
            return;
        }
        joinRoom(socket, roomCode, nickname, userId);
    });

    function joinRoom(socket, roomCode, nickname, userId) {
        const room = rooms[roomCode];
        socket.join(roomCode);
        
        // Determine role (A, B, C)
        const roles = ['A', 'B', 'C'];
        const role = roles[room.playerIds.length];
        
        room.players[userId] = {
            userId: userId,
            socketId: socket.id,
            nickname: nickname || `玩家${role}`,
            role: role,
            target: null,
            ready: false,
            online: true
        };
        room.playerIds.push(userId);

        // Notify player of their role and room info
        socket.emit('roomJoined', {
            roomCode: roomCode,
            role: role,
            inviteCode: roomCode,
            userId: userId,
            maxPlayers: room.maxPlayers
        });

        notifyRoomUpdate(roomCode);

        // Check if full
        if (room.playerIds.length === room.maxPlayers && room.status === 'waiting') {
            room.status = 'setup';
            io.to(roomCode).emit('gamePhase', 'setup');
        }
    }

    function reconnectUser(socket, room, userId) {
        const player = room.players[userId];
        player.socketId = socket.id;
        player.online = true;
        socket.join(room.id);

        // Send current state
        socket.emit('roomJoined', {
            roomCode: room.id,
            role: player.role,
            inviteCode: room.id,
            userId: userId
        });
        
        // Restore game state for user
        if (player.target) {
            socket.emit('targetSet', player.target);
        }
        
        // Send history
        room.history.forEach(item => {
            socket.emit('guessResult', item);
        });

        // Notify others
        notifyRoomUpdate(room.id);
        
        // If game is running, send phase and turn info
        if (room.status !== 'waiting') {
            socket.emit('gamePhase', room.status);
            if (room.status === 'playing') {
                 const currentPlayerId = room.playerIds[room.turnIndex];
                 const currentPlayer = room.players[currentPlayerId];
                 socket.emit('turnChange', {
                    turnRole: currentPlayer.role,
                    turnNickname: currentPlayer.nickname
                });
            }
        }
    }

    function notifyRoomUpdate(roomCode) {
        const room = rooms[roomCode];
        io.to(roomCode).emit('playerUpdate', {
            count: room.playerIds.length,
            players: Object.values(room.players).map(p => ({ 
                nickname: p.nickname, 
                role: p.role, 
                ready: p.ready,
                online: p.online 
            }))
        });
    }

    // Set Target Number
    socket.on('setTarget', ({ roomCode, target }) => {
        const room = rooms[roomCode];
        // Need to find player by socket.id or pass userId? 
        // Better to lookup by socket.id to ensure security
        const userId = findUserBySocket(room, socket.id);
        if (!room || room.status !== 'setup') return;
        
        const player = room.players[userId];
        if (!player) return;

        // Validation
        if (!/^\d{5}$/.test(target)) {
            socket.emit('error', '请输入5位纯数字');
            return;
        }

        player.target = target;
        player.ready = true;

        // Notify self
        socket.emit('targetSet', target);
        
        // Notify opponent
        socket.to(roomCode).emit('opponentStatus', '对方已提交目标数字');

        // Check if both ready
        const allReady = room.playerIds.every(id => room.players[id].ready);
        if (allReady) {
            startGame(room);
        }
    });

    function findUserBySocket(room, socketId) {
        return Object.keys(room.players).find(key => room.players[key].socketId === socketId);
    }

    function startGame(room) {
        room.status = 'playing';
        // Randomize start turn
        room.turnIndex = Math.floor(Math.random() * room.maxPlayers);
        const firstPlayerId = room.playerIds[room.turnIndex];
        
        io.to(room.id).emit('gamePhase', 'playing');
        io.to(room.id).emit('turnChange', {
            turnRole: room.players[firstPlayerId].role,
            turnNickname: room.players[firstPlayerId].nickname
        });
    }

    // Submit Guess
    socket.on('submitGuess', ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || room.status !== 'playing') return;

        const userId = findUserBySocket(room, socket.id);
        // Check turn
        const currentPlayerId = room.playerIds[room.turnIndex];
        if (userId !== currentPlayerId) {
            socket.emit('error', '不是你的回合');
            return;
        }

        // Validation
        if (!/^\d{5}$/.test(guess)) {
            socket.emit('error', '请输入5位纯数字');
            return;
        }

        // Target Logic: Current Turn Index + 1 (Cyclic)
        // 2-Player: 0->1, 1->0
        // 3-Player: 0->1, 1->2, 2->0
        const opponentIndex = (room.turnIndex + 1) % room.maxPlayers;
        const opponentId = room.playerIds[opponentIndex];
        const opponent = room.players[opponentId];
        const player = room.players[userId];

        const feedback = calculateFeedback(guess, opponent.target);
        
        const historyItem = {
            role: player.role,
            nickname: player.nickname,
            guess: guess,
            feedback: feedback,
            targetRole: opponent.role // Add info about who was guessed
        };
        room.history.push(historyItem);

        io.to(roomCode).emit('guessResult', historyItem);

        // Check Win
        if (feedback === 5) {
            room.status = 'finished';
            
            // Collect all targets for reveal
            const allTargets = {};
            room.playerIds.forEach(pid => {
                const p = room.players[pid];
                allTargets[p.role] = p.target;
            });

            io.to(roomCode).emit('gameOver', {
                winner: player.role,
                winnerNickname: player.nickname,
                targets: allTargets
            });
        } else {
            // Switch Turn
            room.turnIndex = (room.turnIndex + 1) % room.maxPlayers;
            const nextPlayerId = room.playerIds[room.turnIndex];
            io.to(roomCode).emit('turnChange', {
                turnRole: room.players[nextPlayerId].role,
                turnNickname: room.players[nextPlayerId].nickname
            });
        }
    });

    // Restart Game
    socket.on('restartGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;

        // Reset state
        room.status = 'setup';
        room.history = [];
        room.turnIndex = 0;
        
        // Reset players
        room.playerIds.forEach(id => {
            room.players[id].target = null;
            room.players[id].ready = false;
        });

        io.to(roomCode).emit('gameReset');
        io.to(roomCode).emit('gamePhase', 'setup');
        
        notifyRoomUpdate(roomCode);
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find room
        for (const code in rooms) {
            const room = rooms[code];
            const userId = findUserBySocket(room, socket.id);
            if (userId) {
                room.players[userId].online = false;
                // Notify other player
                io.to(code).emit('playerDisconnected', { nickname: room.players[userId].nickname });
                notifyRoomUpdate(code);
                
                // Set timeout to destroy room if both disconnected?
                // For now, keep it simple.
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
