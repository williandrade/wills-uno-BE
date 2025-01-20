import express from 'express';
import {createServer} from 'http';
import {Server} from 'socket.io';
import {UnoGame} from './uno_game';
import winston from 'winston';
import TinyDB from 'tinydb';
import cors from "cors";

let unoGame: UnoGame;
let io: Server;
const app = express();
app.use(cors());

app.get('/backdoor', (req, res) => {
    // @ts-ignore
    req.query.do && unoGame[`manual${req.query.do}`](io);
    res.send('Not cool');
});

const httpServer = createServer(app);
const mainDb = new TinyDB('main.db');

const getFromDb = async (key: string) => {
    return new Promise((resolve, reject) => {
        mainDb.getInfo(key, (err: any, k: any, v: any) => {
            if (err) {
                reject(err);
            } else {
                resolve(v);
            }
        });
    });
};

const setOnDb = async (key: string, value: any) => {
  return new Promise((resolve, reject) => {
        mainDb.setInfo(key, value, (err: any, k: any, v: any) => {
            if (err) {
                reject(err);
            } else {
                mainDb.flush(() => resolve(v));
            }
        });
  });
};

mainDb.onReady = async () => {
    console.log('Database is ready');

    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // let unoGame: UnoGame = await getFromDb('uno_instance') as UnoGame;

    // if(!unoGame) {
        unoGame = UnoGame.getInstance();
        // await setOnDb('uno_instance', unoGame);
    // }

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
            name: 'missedUno',
            description: 'Someone missed to call UNO.',
            run: [unoGame.missedUno]
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
                    try {
                        await fn(msg, socket, io, data);
                    } catch (e) {
                        logger.error(e);
                    }
                }
            });
        });
    });
};

httpServer.listen(3000, () => {
    console.log('Server listening on port 3000');
});
