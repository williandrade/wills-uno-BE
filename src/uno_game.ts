import winston from "winston";
import crypto from 'crypto';
import {Color, matchCard, Type, UnoCard, Value} from "./dto/card";
import {UnoRoom} from "./dto/room";
import {Socket} from "socket.io/dist/socket";
import _ from "lodash";
import {Server} from "socket.io";

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
            winston.format.prettyPrint(),
        )
    }));
}

class UnoGame {
    private static instance: UnoGame;

    // private _rooms: UnoRoom[] = [];
    private _room: UnoRoom = UnoGame._getRoom(undefined);

    private constructor() {
    }

    public static getInstance(): UnoGame {
        if (!UnoGame.instance) {
            UnoGame.instance = new UnoGame();
        }
        return UnoGame.instance;
    }

    debugIt = (message: any, socket: Socket, server: Server, data: any) => {
        logger.debug("", this._room);
    }

    joinRoom = (message: any, socket: Socket, server: Server, data: any) => {
        let player = this._room.players.find(p => p.name === message.name);

        if (player) {
            try {
                server.sockets.sockets.get(player.id)?.disconnect(true);
            } catch (e) {
            }

            if (this._room.gameState.currentPlayerId === player.id) {
                this._room.gameState.currentPlayerId = socket.id;
            }

            this._room.players = this._room.players.map(player => {
                if (player.name === message.name) {
                    player.id = socket.id;
                }
                return player;
            });

            socket.emit('cardsOn', player.hand);
        } else {
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

            player = {
                id: socket.id,
                name: message.name,
                hand: [],
                isHost: this._room.players.length === 0,
                isReady: false,
                isTurn: false,
                isUno: false,
                isSpectator: false,
                needsToBuy: 0
            };

            this._room.players.push(player);
            server.to(this._room.roomId).emit('playerJoined', player);
        }

        socket.join(this._room.roomId);
        socket.emit('roomJoined', {
            ...this._room, players: this._room.players.map(p => {
                return {
                    id: p.id,
                    name: p.name,
                    hand: p.hand.length,
                    isHost: p.isHost,
                    isReady: p.isReady,
                    isTurn: p.isTurn,
                    isUno: p.isUno,
                    isSpectator: p.isSpectator,
                    needsToBuy: p.needsToBuy
                };
            })
        });
        logger.info(`${player.name} joined the room`);
    }

    leaveRoom = (message: any, socket: Socket, server: Server, data: any) => {
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

    playCard = (message: any, socket: Socket, server: Server, data: any) => {
        const card = message.card as UnoCard;

        if (!this._room.gameState.currentPlayerId) {
            logger.error(`[${socket.id}] No Current player`);
            socket.emit('error', 'No Current player');
            return;
        }

        let playerId = socket.id;

        if (!this._isCurrentPlayerPlaying(socket.id)) {
            logger.error(`[${socket.id}] Cortouuu`);
            this._room.gameState.currentPlayerId = socket.id;
        }

        const currentPlayer = this._room.players.find(p => p.id === playerId);

        logger.debug(`Current player is `, {currentPlayer});

        if (!currentPlayer) {
            logger.error(`[${socket.id}] No Current player`);
            socket.emit('error', 'No Current player');
            return;
        }

        if (currentPlayer!.hand.find(c => matchCard(c, card)) === undefined) {
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

        this._room.gameState.discardPile.push(card);

        const cardIndex = currentPlayer!.hand.findIndex(c => matchCard(c, card));
        if (cardIndex !== -1) {
            currentPlayer!.hand.splice(cardIndex, 1);
        }

        currentPlayer!.isTurn = false;
        logger.debug(`currentPlayer is [${JSON.stringify(currentPlayer)}]`);

        switch (card.value) {
            case Value.Reverse:
                this._room.gameState.direction.value *= -1;
                this._goToNextPlayer();
                break;
            case Value.Skip:
                this._goToNextPlayer(1);
                break;
            case Value.DrawTwo:
                this._goToNextPlayer();
                this._drawIntention(2);
                break;
            case Value.Wild:
                this._goToNextPlayer();
                break;
            case Value.WildDrawFour:
                this._goToNextPlayer();
                this._drawIntention(4);
                break;
            default:
                this._goToNextPlayer();
        }
        //END GAME LOGIC
        logger.debug(`this._room.players is [${JSON.stringify(this._room.players)}]`);

        server.to(this._room.roomId).emit('gameUpdate', {...this._room.gameState, deck: []});
        this._informPlayersCount(server);
    }

    nextTurn = (message: any, socket: Socket, server: Server, data: any) => {
        this._goToNextPlayer();
        server.to(this._room.roomId).emit('gameUpdate', {...this._room.gameState, deck: []});
        this._informPlayersCount(server);
    }

    drawCard = (message: any, socket: Socket, server: Server, data: any) => {
        let currentPlayer = this._room.players.find(p => p.id === socket.id);

        if (!currentPlayer) {
            logger.debug(`Player with id [${socket.id}] not found`);
            return;
        }

        const count = message.count || 1;

        logger.debug(`[${socket.id}] Drawing ${count} card(s)`);

        for (let i = 0; i < count; i++) {
            const card = this._room.gameState.deck.pop()!;
            currentPlayer.hand.push(card!);
        }

        if (currentPlayer.isUno) {
            currentPlayer.isUno = false;
            this._room.gameState.isUnoCall = false;
        }

        if (currentPlayer.needsToBuy > 0) {
            currentPlayer.needsToBuy = Math.max(0, currentPlayer.needsToBuy - count);
        }

        this._room.players = this._room.players.map(p => p.id === currentPlayer?.id ? currentPlayer : p);

        socket.emit('cardDrawn', currentPlayer.hand);
        server.to(this._room.roomId).emit('gameUpdate', {...this._room.gameState, deck: []});
        this._informPlayersCount(server);
    }

    callUno = (message: any, socket: Socket, server: Server, data: any) => {
        if (!this._isCurrentPlayerPlaying(socket.id)) {
            return;
        }

        this._room.players = this._room.players.map(p => p.id === this._room.gameState.currentPlayerId ? {
            ...p,
            isUno: true
        } : p);
        server.to(this._room.roomId).emit('gameUpdate', {...this._room.gameState, deck: []});
        this._informPlayersCount(server);
        // this._room.gameState.isUnoCall = true;
        // server.to(this._room.roomId).emit('unoCalled', {...this._room.gameState, deck: []});
    }

    missedUno = (message: any, socket: Socket, server: Server, data: any) => {
        const unoMissing = this._room.players.find(p => p.hand.length === 1 && p.isUno == false && p.isTurn == false);
        if (unoMissing) {
            const socket = server.sockets.sockets.get(unoMissing.id);
            if (socket) {
                this.drawCard({count: 2}, socket, server, data);
            }
        }
    }

    startGame = (message: any, socket: Socket, server: Server, data: any) => {
        let cards = this._shuffleDeck(this._createUnoDeck());

        this._room.players.forEach(p => {
            for (let i = 0; i < 7; i++) {
                p.hand.push(cards.pop()!);
            }
            server.to(p.id)!.emit('cardsOn', p.hand);
        });

        const firstTurnedCard = cards.find(c => c.color !== null && c.value !== Value.Wild && c.value !== Value.WildDrawFour)!;
        cards = cards.filter(c => !_.isEqual(c, firstTurnedCard));

        this._room.gameState = {
            deck: cards,
            discardPile: [firstTurnedCard],
            currentPlayerId: this._getRandomPlayer().id,
            direction: {value: 1},
            winnerId: null,
            isOver: false,
            isStarted: true,
            isPaused: false,
            isUnoCall: false
        };

        this._room.players = this._room.players.map(p => p.id === this._room.gameState.currentPlayerId ? {
            ...p,
            isTurn: true
        } : p);

        server.to(this._room.roomId).emit('gameStarted', {...this._room.gameState, deck: []});
        this._informPlayersCount(server);
    }

    endGame = (message: any, socket: Socket, server: Server, data: any) => {
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
        server.to(this._room.roomId).emit('gameEnded', {...this._room.gameState, deck: []});
        server.sockets.disconnectSockets(true);
    }

    shuffleDeck = (message: any, socket: Socket, server: Server, data: any) => {
        this._room.gameState.deck = this._shuffleDeck(this._createUnoDeck());
        server.to(this._room.roomId).emit('deckShuffled', this._room.gameState.deck);
    }

    fakeGame() {
        const names = ['Juju', 'Kaka', 'Bieber', 'Rudolf', 'Phineas'];

        for (let i = 0; i < 3; i++) {
            let randomName = names[Math.floor(Math.random() * names.length)];

            while (this._room.players.some(player => player.name === randomName)) {
                randomName = names[Math.floor(Math.random() * names.length)];
            }

            const player = {
                id: `fake_${i}`,
                name: randomName,
                hand: [],
                isHost: this._room.players.length === 0,
                isReady: false,
                isTurn: false,
                isUno: false,
                isSpectator: false,
                needsToBuy: 0
            };

            this._room.players.push(player);
        }
    }

    manualEndGame(server: Server) {
        // @ts-ignore
        this.endGame({}, {id: 'fake'}, server, {});
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

    private _goToNextPlayer = (step: number = 0) => {
        let currentPlayer = this._room.players.find(p => p.id === this._room.gameState.currentPlayerId!);
        let nextPlayerIndex = (this._room.players.indexOf(currentPlayer!) + this._room.gameState.direction.value + step + this._room.players.length) % this._room.players.length;
        let nextPlayer = this._room.players[nextPlayerIndex];
        nextPlayer.isTurn = true;
        this._room.players = this._room.players.map(p => p.id === nextPlayer.id ? nextPlayer : {...p, isTurn: false});

        this._room.gameState.currentPlayerId = nextPlayer.id;
        return nextPlayer;
    }

    private _informPlayersCount = (server: Server) => {
        server.to(this._room.roomId).emit('playersCountUpdate', this._room.players.map(p => {
            return {
                id: p.id,
                name: p.name,
                hand: p.hand.length,
                isHost: p.isHost,
                isReady: p.isReady,
                isTurn: p.isTurn,
                isUno: p.isUno,
                isSpectator: p.isSpectator,
                needsToBuy: p.needsToBuy
            };
        }));
    }

    private _isCurrentPlayerPlaying = (id: any) => {
        return this._room.gameState.currentPlayerId == id;
    }

    private static _getRoom = (roomId: string | undefined) => {
        // let room = this._rooms.find(r => r.roomId === roomId);
        let room = undefined;

        if (!room) {
            room = {
                roomId: crypto.randomBytes(8).toString('hex'),
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
                maxPlayers: 4
            };

            // this._rooms.push(room);
        }

        return room;
    }

    private _drawIntention = (drawNumber: number) => {
        let count = drawNumber;

        this._room.players.forEach(p => {
            count += p.needsToBuy;
        });

        // const discardPile = this._room.gameState.discardPile;

        // for (let i = discardPile.length - 1; i >= 0; i--) {
        //     if (discardPile[i].value.toLowerCase().indexOf('draw') === -1) {
        //         break;
        //     }
        //
        //     if (discardPile[i].value.toLowerCase().indexOf('four') > -1) {
        //         count += 4;
        //     } else if (discardPile[i].value.toLowerCase().indexOf('two') > -1) {
        //         count += 2;
        //     }
        // }

        this._room.players = this._room.players.map(p => {
            return {...p, needsToBuy: p.id === this._room.gameState.currentPlayerId ? count : 0};
        });
    }
}

export {UnoGame};