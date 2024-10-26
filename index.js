const WebSocket = require('ws');
const http = require('http');
const dotenv = require('dotenv');
const logger = require('./logger');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 8080;
const MAX_MESSAGES_PER_MINUTE = process.env.MAX_MESSAGES_PER_MINUTE || 60;

const server = http.createServer();
const wss = new WebSocket.Server({ server });

let rooms = {};
let buzzers = {};

logger.info('WebSocket server is starting...');

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logger.info(`New client connected from ${ip}`);

  ws.isAlive = true;
  ws.messageCount = 0;

  const pingInterval = setInterval(() => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  }, 30000);

  const rateLimitInterval = setInterval(() => {
    ws.messageCount = 0;
  }, 60000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    if (++ws.messageCount > MAX_MESSAGES_PER_MINUTE) {
      logger.warn(`Rate limit exceeded for client ${ip}`);
      return;
    }

    logger.info('Received message:', message.toString());
    try {
      const { type, roomCode, participant } = JSON.parse(message);

      logger.info(`Processing message type: ${type}, roomCode: ${roomCode}, participant: ${participant}`);

      switch (type) {
        case 'join':
          handleJoin(ws, roomCode, participant);
          break;
        case 'buzz':
          handleBuzz(roomCode, participant);
          break;
        case 'startQuestion':
          handleStartQuestion(roomCode);
          break;
        case 'gameStart':
          handleGameStart(roomCode);
          break;
        default:
          logger.info(`Unknown message type: ${type}`);
      }
    } catch (error) {
      logger.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(rateLimitInterval);
    handleDisconnect(ws);
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });
});

function handleJoin(ws, roomCode, participant) {
  logger.info(`Handling join for roomCode: ${roomCode}, participant: ${participant}`);
  
  if (!rooms[roomCode]) {
    rooms[roomCode] = new Set();
  }

  // Remove any existing connection for this participant
  wss.clients.forEach((client) => {
    if (client.roomCode === roomCode && client.participant === participant) {
      client.close();
    }
  });

  rooms[roomCode].add(participant);
  ws.roomCode = roomCode;
  ws.participant = participant;

  logger.info(`Current participants in room ${roomCode}:`, Array.from(rooms[roomCode]));

  broadcastToRoom(roomCode, {
    type: 'update',
    roomCode,
    participants: Array.from(rooms[roomCode])
  });
}

function handleBuzz(roomCode, participant) {
  logger.info(`Handling buzz for roomCode: ${roomCode}, participant: ${participant}`);
  logger.info("Current buzzers state:", buzzers);
  
  if (!buzzers[roomCode]) {
    buzzers[roomCode] = participant;
    logger.info(`First buzz in room ${roomCode} by ${participant}`);
    
    broadcastToRoom(roomCode, {
      type: 'buzzed',
      roomCode,
      participant
    });
  } else {
    logger.info(`Buzz ignored: ${participant} was not first in room ${roomCode}`);
  }
}

function handleStartQuestion(roomCode) {
  logger.info(`Starting new question for roomCode: ${roomCode}`);
  delete buzzers[roomCode];
  
  broadcastToRoom(roomCode, {
    type: 'questionStart',
    roomCode
  });
}

function handleGameStart(roomCode) {
  logger.info(`Game starting for roomCode: ${roomCode}`);
  broadcastToRoom(roomCode, {
    type: 'gameStart',
    roomCode
  });
}

function handleDisconnect(ws) {
  if (ws.roomCode && ws.participant) {
    const roomCode = ws.roomCode;
    logger.info(`Handling disconnect for roomCode: ${roomCode}, participant: ${ws.participant}`);
    
    if (rooms[roomCode]) {
      rooms[roomCode].delete(ws.participant);
      
      logger.info(`Updated participants in room ${roomCode}:`, Array.from(rooms[roomCode]));

      broadcastToRoom(roomCode, {
        type: 'update',
        roomCode,
        participants: Array.from(rooms[roomCode])
      });
    }
  } else {
    logger.info('Disconnected client was not associated with a room');
  }
}

function broadcastToRoom(roomCode, message) {
  logger.info(`Broadcasting to room ${roomCode}:`, message);
  let clientCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === roomCode) {
      client.send(JSON.stringify(message));
      clientCount++;
    }
  });
  logger.info(`Message broadcast to ${clientCount} clients in room ${roomCode}`);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

server.listen(PORT, () => {
  logger.info(`WebSocket server is running on ws://localhost:${PORT}`);
});
