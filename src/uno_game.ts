import winston from "winston";
import {Color, Type, UnoCard, Value} from "./dto/card";
import {UnoRoom} from "./dto/room";
import {Socket} from "socket.io/dist/socket";

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
        winston.format.errors({stack: true}),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: {service: 'uno_game'},
    transports: [
        new winston.transports.File({filename: 'uno_error.log', level: 'error'}),
        new winston.transports.File({filename: 'uno.log'})
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

class UnoGame {
    private static instance: UnoGame;

    private _room: UnoRoom = {
        roomId: 'SINGLE ROOM',
        players: [],
        gameState: {
            deck: [],
            discardPile: [],
            currentPlayerId: null,
            direction: {value: 1},
            winnerId: null,
            isOver: false,
            isStarted: false,
            isPaused: false,
            isUnoCall: false
        },
        maxPlayers: 10
    };

    private constructor() {
    }

    public static getInstance(): UnoGame {
        if (!UnoGame.instance) {
            UnoGame.instance = new UnoGame();
        }
        return UnoGame.instance;
    }

    debugIt = (message: any, socket: Socket, server: any, data: any) => {
        logger.debug("", this._room);
    }

    joinRoom = (message: any, socket: Socket, server: any, data: any) => {
        if (this._room.gameState.isStarted) {
            logger.info(`[${socket.id}] Game has started. Please start a new game.`);
            socket.emit('error', 'Game has started. Please start a new game.');
            return;
        }
        if (this._room.players.length >= this._room.maxPlayers) {
            logger.info(`[${socket.id}] Room is full. Please join another room.`);
            socket.emit('error', 'Room is full. Please join another room.');
            return;
        }

        const player = {
            id: socket.id,
            name: message.name,
            hand: [],
            isHost: this._room.players.length === 0,
            isReady: false,
            isTurn: false,
            isUno: false,
            isSpectator: false
        };

        this._room.players.push(player);
        socket.join(this._room.roomId);
        server.to(this._room.roomId).emit('playerJoined', player);
        socket.emit('roomJoined', this._room);
        logger.info(`${player.name} joined the room`);
    }

    leaveRoom = (message: any, socket: Socket, server: any, data: any) => {
        const player = this._room.players.find(p => p.id === socket.id);
        if (!player) {
            logger.info(`[${socket.id}] Player not found in room`);
            socket.emit('error', 'Player not found in room');
            return;
        }

        this._room.players = this._room.players.filter(p => p.id !== socket.id);
        server.to(this._room.roomId).emit('playerLeft', player);
        logger.info(`${player.name} left the room`);
    }

    playCard = (message: any, socket: Socket, server: any, data: any) => {
        if (!this._room.gameState.currentPlayerId) {
            logger.error(`[${socket.id}] No Current player`);
            socket.emit('error', 'No Current player');
        }

        this._room.gameState.discardPile.push(message.card);
        let currentPlayer = this._room.players.find(p => p.id = this._room.gameState.currentPlayerId!);
        logger.debug(`Current player is `, {currentPlayer});

        if (!currentPlayer) {
            logger.error(`[${socket.id}] No Current player`);
            socket.emit('error', 'No Current player');
        }

        if (currentPlayer!.hand.find(c => c === message.card) === undefined) {
            logger.error(`[${socket.id}] Trying to play a card that is not in the hand.`);
            socket.emit('error', 'This is not a valid card to the current user');
            return;
        }

        if (currentPlayer!.hand.length === 1 && currentPlayer!.isUno) {
            logger.info(`[${socket.id}] Won a game`);
            this.endGame({message: `${currentPlayer?.name} WON!!!`}, socket, server, data);
            return;
        }

        if (currentPlayer!.hand.length === 1 && !currentPlayer!.isUno) {
            logger.info(`[${socket.id}] Was not in UNO`);
            socket.emit('error', 'User is not in UNO');
            return;
        }

        currentPlayer!.hand = currentPlayer!.hand.filter(c => c !== message.card);
        currentPlayer!.isTurn = false;

        this._room.players = this._room.players.map(p => p.id == currentPlayer!.id ? currentPlayer! : p);

        //TODO: APPLY CARD EFFECTS

        this._room.gameState.currentPlayerId = this._room.players[(this._room.players.indexOf(currentPlayer!) + this._room.gameState.direction.value) % this._room.players.length].id;

        server.to(this._room.roomId).emit('cardPlayed', this._room.gameState);
        server.to(this._room.roomId).emit('playersCountUpdate', this._room.players.map(p => {
            return {
                id: p.id,
                name: p.name,
                hand: p.hand.length,
                isHost: p.isHost,
                isReady: p.isReady,
                isTurn: p.isTurn,
                isUno: p.isUno,
                isSpectator: p.isSpectator
            };
        }));
    }

    drawCard = (message: any, socket: Socket, server: any, data: any) => {
        const card = this._room.gameState.deck.pop();

        let currentPlayer = this._room.players.find(p => p.id = this._room.gameState.currentPlayerId!);

        currentPlayer!.hand.push(card!);
        if (currentPlayer!.isUno) {
            currentPlayer!.isUno = false;
            this._room.gameState.isUnoCall = false;
        }
        this._room.players = this._room.players.map(p => p.id == currentPlayer!.id ? currentPlayer! : p);
        server.to(this._room.roomId).emit('cardDrawn', this._room.gameState);
        socket.emit('cardDrawn', card);
    }

    callUno = (message: any, socket: Socket, server: any, data: any) => {
        this._room.players = this._room.players.map(p => p.id == this._room.gameState.currentPlayerId ? {
            ...p,
            isUno: true
        } : p);
        this._room.gameState.isUnoCall = true;
        server.to(this._room.roomId).emit('unoCalled', this._room.gameState);
    }

    startGame = (message: any, socket: Socket, server: any, data: any) => {
        const cards = this._shuffleDeck(this._createUnoDeck());

        this._room.players.forEach(p => {
            for (let i = 0; i < 7; i++) {
                p.hand.push(cards.pop()!);
            }
            server.to(p.id)!.emit('cardsOn', p.hand);
        });

        this._room.gameState = {
            deck: cards,
            discardPile: [],
            currentPlayerId: this._getRandomPlayer().id,
            direction: {value: 1},
            winnerId: null,
            isOver: false,
            isStarted: true,
            isPaused: false,
            isUnoCall: false
        };


        server.to(this._room.roomId).emit('gameStarted', this._room.gameState);
    }

    endGame = (message: any, socket: Socket, server: any, data: any) => {
        this._room.gameState = {
            deck: [],
            discardPile: [],
            currentPlayerId: null,
            direction: {value: 1},
            winnerId: null,
            isOver: false,
            isStarted: false,
            isPaused: false,
            isUnoCall: false
        };
        server.to(this._room.roomId).emit('gameEnded', this._room.gameState);
    }

    shuffleDeck = (message: any, socket: Socket, server: any, data: any) => {
        this._room.gameState.deck = this._shuffleDeck(this._createUnoDeck());
        server.to(this._room.roomId).emit('deckShuffled', this._room.gameState.deck);
    }

    private _createUnoDeck = (): UnoCard[] => {
        const deck: UnoCard[] = [];

        // Generate colored cards
        for (const color of Object.values(Color)) {
            for (const value of Object.values(Value).filter(v => v !== Value.Wild && v !== Value.WildDrawFour)) {
                let type = Type.Number; // Default type
                if (
                    value === Value.Skip ||
                    value === Value.Reverse ||
                    value === Value.DrawTwo
                ) {
                    type = Type.Action;
                }

                // Two of each numbered card (except zero)
                if (value !== Value.Zero) {
                    deck.push({color, value, type});
                    deck.push({color, value, type});
                } else {
                    // One '0' card of each color
                    deck.push({color, value, type});
                }
            }
        }

        // Wild cards
        for (let i = 0; i < 4; i++) {
            deck.push({color: null, value: Value.Wild, type: Type.Wild});
            deck.push({
                color: null,
                value: Value.WildDrawFour,
                type: Type.WildDrawFour,
            });
        }

        return deck;
    }

    private _shuffleDeck = (deck: UnoCard[]): UnoCard[] => {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]]; // Swap
        }
        return deck;
    }

    private _getRandomPlayer = () => {
        const index = Math.floor(Math.random() * this._room.players.length);
        return this._room.players[index];
    }
}

export {UnoGame};