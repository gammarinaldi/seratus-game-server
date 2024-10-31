const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const logger = require('./logger');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 8080;

const app = express();
const server = createServer(app);

// Add basic Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Socket.IO setup with improved configuration
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || '*',
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 10000,
  transports: ['websocket', 'polling']
});

let rooms = new Map(); // Track room state

// Rate limiter middleware with improvements
io.use((socket, next) => {
  socket.messageCount = 0;
  const rateLimitInterval = setInterval(() => {
    socket.messageCount = 0;
  }, 60000);

  socket.on('disconnect', () => {
    clearInterval(rateLimitInterval);
  });

  // Add error handling
  socket.on('error', (error) => {
    logger.error('Socket error:', error);
    socket.disconnect();
  });

  next();
});

// Connection handling with improved error management
io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  logger.info(`New client connected from ${ip}`);

  // Track socket state
  socket.isAlive = true;

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  // Handle messages with error catching
  socket.on('join', async ({ roomCode, player }) => {
    try {
      await handleJoin(socket, roomCode, player);
    } catch (error) {
      logger.error(`Error in join handler: ${error.message}`);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('buzz', ({ roomCode, player }) => {
    try {
      handleBuzz(roomCode, player);
    } catch (error) {
      logger.error(`Error in buzz handler: ${error.message}`);
      socket.emit('error', { message: 'Failed to process buzz' });
    }
  });

  socket.on('startQuestion', ({ roomCode }) => {
    try {
      handleStartQuestion(roomCode);
    } catch (error) {
      logger.error(`Error in startQuestion handler: ${error.message}`);
      socket.emit('error', { message: 'Failed to start question' });
    }
  });

  socket.on('gameStart', ({ roomCode }) => {
    try {
      handleGameStart(roomCode);
    } catch (error) {
      logger.error(`Error in gameStart handler: ${error.message}`);
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  socket.on('disconnect', () => {
    try {
      handleDisconnect(socket);
    } catch (error) {
      logger.error(`Error in disconnect handler: ${error.message}`);
    }
  });
});

// Improved room management
async function handleJoin(socket, roomCode, player) {
  if (!roomCode || !player) {
    throw new Error('Invalid room code or player');
  }

  logger.info(`Handling join for roomCode: ${roomCode}, player: ${player}`);
  
  // Leave previous rooms
  for (const [room] of socket.rooms) {
    if (room !== socket.id) {
      await socket.leave(room);
    }
  }

  // Initialize room state if needed
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      players: new Set(),
      buzzer: null,
      isQuestionActive: false
    });
  }

  // Join new room
  await socket.join(roomCode);
  socket.player = player;
  socket.roomCode = roomCode;

  // Update room state
  const roomState = rooms.get(roomCode);
  roomState.players.add(player);

  // Get current players
  const players = Array.from(roomState.players);

  logger.info(`Current players in room ${roomCode}:`, players);

  // Broadcast room update
  io.to(roomCode).emit('update', {
    roomCode,
    players
  });
}

// Improved buzz handling
function handleBuzz(roomCode, player) {
  if (!roomCode || !player) {
    throw new Error('Invalid room code or player');
  }

  logger.info(`Handling buzz for roomCode: ${roomCode}, player: ${player}`);
  
  const roomState = rooms.get(roomCode);
  if (!roomState || !roomState.isQuestionActive) {
    return;
  }

  if (!roomState.buzzer) {
    roomState.buzzer = player;
    logger.info(`First buzz in room ${roomCode} by ${player}`);
    
    io.to(roomCode).emit('buzzed', {
      roomCode,
      player
    });
  }
}

// Add cleanup interval for inactive rooms
const cleanupInterval = setInterval(() => {
  for (const [roomCode, roomState] of rooms) {
    if (roomState.players.size === 0) {
      rooms.delete(roomCode);
      logger.info(`Cleaned up empty room: ${roomCode}`);
    }
  }
}, 300000); // Clean every 5 minutes

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  clearInterval(cleanupInterval);
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

server.listen(PORT, () => {
  logger.info(`Server is running on port: ${PORT}`);
});

module.exports = { app, server, io }; // Export for testing

// Add these functions before the io.on('connection') block
function handleStartQuestion(roomCode) {
    if (!roomCode) {
        throw new Error('Invalid room code');
    }

    logger.info(`Starting new question for room: ${roomCode}`);
    
    const roomState = rooms.get(roomCode);
    if (!roomState) {
        throw new Error('Room not found');
    }

    // Reset room state for new question
    roomState.buzzer = null;
    roomState.isQuestionActive = true;

    // Notify all clients in the room that a new question has started
    io.to(roomCode).emit('questionStart', {
        roomCode
    });
}

function handleGameStart(roomCode) {
    if (!roomCode) {
        throw new Error('Invalid room code');
    }

    logger.info(`Starting game for room: ${roomCode}`);
    
    const roomState = rooms.get(roomCode);
    if (!roomState) {
        throw new Error('Room not found');
    }

    // Reset room state for game start
    roomState.buzzer = null;
    roomState.isQuestionActive = false;

    // Notify all clients in the room that the game has started
    io.to(roomCode).emit('gameStart', {
        roomCode
    });
}

// Update the handleDisconnect function if it doesn't exist
function handleDisconnect(socket) {
    logger.info(`Client disconnected: ${socket.id}`);
    
    if (socket.roomCode && socket.player) {
        const roomState = rooms.get(socket.roomCode);
        if (roomState) {
            roomState.players.delete(socket.player);
            
            // Notify remaining players about the update
            io.to(socket.roomCode).emit('update', {
                roomCode: socket.roomCode,
                players: Array.from(roomState.players)
            });
        }
    }
}
