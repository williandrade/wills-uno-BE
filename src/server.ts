import express from 'express';
import {createServer} from 'http';
import {Server} from 'socket.io';
import {UnoGame} from "./uno_game";
import winston from "winston";

const cors = require('cors');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:3002",
        methods: ["GET", "POST"]
    }
});
const unoGame = UnoGame.getInstance();

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
        winston.format.errors({stack: true}),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: {service: 'uno-server'},
    transports: [
        new winston.transports.File({filename: 'server_error.log', level: 'error'}),
        new winston.transports.File({filename: 'server.log'})
    ]
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

const events = [
    {
        name: 'joinRoom',
        description: 'Join a room to play a game of UNO.',
        run: [unoGame.joinRoom]
    },
    {
        name: 'leaveRoom',
        description: 'Leave a room to stop playing a game of UNO.',
        run: [unoGame.leaveRoom]
    },
    {
        name: 'playCard',
        description: 'Play a card from your hand.',
        run: [unoGame.playCard]
    },
    {
        name: 'drawCard',
        description: 'Draw a card from the deck.',
        run: [unoGame.drawCard]
    },
    {
        name: 'callUno',
        description: 'Call UNO when you have one card left.',
        run: [unoGame.callUno]
    },
    {
        name: 'startGame',
        description: 'Start the game when all players are ready.',
        run: [unoGame.startGame]
    },
    {
        name: 'endGame',
        description: 'End the game and leave the room.',
        run: [unoGame.endGame]
    },
    {
        name: 'shuffleDeck',
        description: 'Shuffle the deck',
        run: [unoGame.shuffleDeck]
    },
    {
        name: 'debugIt',
        description: 'Just for debugging purposes.',
        run: [unoGame.debugIt]
    },
    {
        name: 'fakeGame',
        description: 'Just for debugging purposes.',
        run: [unoGame.fakeGame]
    },
];

io.on('connection', async (socket) => {
    logger.info('User connected to the server');

    events.forEach((event) => {
        socket.on(event.name, async (msg) => {
            logger.verbose(`Received event: ${event.name}`);
            logger.verbose('Message: ', {msg});

            const data = {};
            for (const fn of event.run) {
                try{
                    await fn(msg, socket, io, data);
                } catch (e){
                    logger.error(e);
                }
            }
        });
    });
});

httpServer.listen(3000, () => {
    console.log('Server listening on port 3000');
});
