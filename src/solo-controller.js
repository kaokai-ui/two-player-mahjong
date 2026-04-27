import {
  DEFAULT_DRAW_REVEAL_SECONDS,
  applyGameCommand,
  createStartedGame,
  createWaitingGame,
  normalizeDrawRevealSeconds,
  normalizeGameState,
} from "./game.js?v=20260427g";
import { DEFAULT_RULESET } from "./rules.js?v=20260425i";
import {
  DEFAULT_SOLO_DIFFICULTY,
  SOLO_DIFFICULTY_LABELS,
  decideBotAction,
  normalizeSoloDifficulty,
} from "./bot-ai.js?v=20260427j";

const PLAYER_NAME_KEY = "mahjong-player-name";
const SOLO_DIFFICULTY_STORAGE_KEY = "mahjong-solo-difficulty";
const HUMAN_PLAYER_ID = "solo-human";
const BOT_PLAYER_ID = "solo-bot";
const HUMAN_BROWSER_ID = "solo-human-browser";
const BOT_BROWSER_ID = "solo-bot-browser";
const SOLO_ROOM_ID = "SOLO";
const BOT_NAME = "電腦玩家";

export { DEFAULT_SOLO_DIFFICULTY, SOLO_DIFFICULTY_LABELS, normalizeSoloDifficulty };

export class SoloController {
  constructor({ onRoomChange, onInfo, onError, onStatusChange }) {
    this.onRoomChange = onRoomChange;
    this.onInfo = onInfo;
    this.onError = onError;
    this.onStatusChange = typeof onStatusChange === "function" ? onStatusChange : () => {};
    this.room = null;
    this.botTimer = 0;
    this.setupState = {
      configured: true,
      appCheckConfigured: false,
      initializing: false,
      ready: true,
      authReady: true,
      uid: HUMAN_PLAYER_ID,
      appCheckEnabled: false,
      appCheckReady: false,
      appCheckProvider: "",
      appCheckDebug: false,
      appCheckMessage: "單人模式不需要 Firebase。",
      error: "",
    };
  }

  async init() {
    this.emitStatus();
    return true;
  }

  getIdentity() {
    return {
      playerId: HUMAN_PLAYER_ID,
      browserId: HUMAN_BROWSER_ID,
      playerName: readStorage(PLAYER_NAME_KEY) || "",
    };
  }

  getSetupState() {
    return { ...this.setupState };
  }

  setPlayerName(playerName) {
    const trimmed = String(playerName || "").trim();
    if (!trimmed) {
      throw new Error("請先輸入玩家名稱。");
    }

    writeStorage(PLAYER_NAME_KEY, trimmed);
    return trimmed;
  }

  async createSoloGame({
    playerName,
    rulesetId = DEFAULT_RULESET,
    drawRevealSeconds = DEFAULT_DRAW_REVEAL_SECONDS,
    difficulty = DEFAULT_SOLO_DIFFICULTY,
  }) {
    this.clearBotTimer();

    const trimmedName = this.setPlayerName(playerName);
    const normalizedDifficulty = normalizeSoloDifficulty(difficulty);
    const normalizedDrawRevealSeconds = normalizeDrawRevealSeconds(drawRevealSeconds);
    writeStorage(SOLO_DIFFICULTY_STORAGE_KEY, normalizedDifficulty);

    const now = Date.now();
    const waitingGame = createWaitingGame(rulesetId, { drawRevealSeconds: normalizedDrawRevealSeconds });
    const startedGame = createStartedGame(rulesetId, waitingGame, { drawRevealSeconds: normalizedDrawRevealSeconds });

    this.room = createSoloRoom({
      humanName: trimmedName,
      createdAt: now,
      updatedAt: now,
      rulesetId,
      difficulty: normalizedDifficulty,
      game: startedGame,
      botThinking: false,
    });
    this.emitRoom();
    this.queueBotTurnIfNeeded();
  }

  async sendGameCommand(type, payload = {}) {
    if (!this.room || !this.room.game) {
      throw new Error("單人對局尚未開始。");
    }

    const result = applyGameCommand(this.room.game, {
      playerSeat: 0,
      type,
      payload,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    this.updateRoomGame(result.game);
    this.queueBotTurnIfNeeded();
  }

  leaveRoom() {
    this.clearBotTimer();
    this.room = null;
    this.onRoomChange(null);
  }

  isHost() {
    return true;
  }

  queueBotTurnIfNeeded() {
    this.clearBotTimer();

    const action = this.getPendingBotAction();
    if (!action) {
      this.setBotThinking(false);
      return;
    }

    this.setBotThinking(true);
    this.onInfo(action.infoMessage || "電腦思考中...");

    this.botTimer = window.setTimeout(() => {
      this.botTimer = 0;
      this.setBotThinking(false);
      this.runBotAction(action);
    }, action.delayMs || 900);
  }

  getPendingBotAction() {
    if (!this.room || !this.room.game || this.room.game.status !== "playing") {
      return null;
    }

    const game = normalizeGameState(this.room.game);
    const pendingClaim = game.pendingClaim || null;
    const botSeat = 1;

    if (
      (game.phase === "draw" || game.phase === "discard") &&
      game.turnSeat === botSeat
    ) {
      return decideBotAction(game, botSeat, this.room.meta.soloDifficulty);
    }

    if (
      ["response", "robKong"].includes(game.phase) &&
      pendingClaim &&
      pendingClaim.toSeat === botSeat
    ) {
      return decideBotAction(game, botSeat, this.room.meta.soloDifficulty);
    }

    return null;
  }

  runBotAction(action) {
    if (!this.room || !this.room.game) {
      return;
    }

    const result = applyGameCommand(this.room.game, {
      playerSeat: 1,
      type: action.type,
      payload: action.payload || {},
    });

    if (!result.ok) {
      this.onError(result.message);
      return;
    }

    this.updateRoomGame(result.game);
    if (action.resultMessage) {
      this.onInfo(action.resultMessage);
    }
    this.queueBotTurnIfNeeded();
  }

  updateRoomGame(game) {
    if (!this.room) {
      return;
    }

    const updatedAt = Date.now();
    this.room = createSoloRoom({
      humanName: getHumanPlayer(this.room).name,
      createdAt: this.room.createdAt,
      updatedAt,
      rulesetId: game.rulesetId || this.room.rulesetId,
      difficulty: this.room.meta.soloDifficulty,
      game,
      botThinking: false,
    });
    this.emitRoom();
  }

  setBotThinking(botThinking) {
    if (!this.room || Boolean(this.room.meta.botThinking) === Boolean(botThinking)) {
      return;
    }

    this.room = {
      ...this.room,
      meta: {
        ...this.room.meta,
        botThinking: Boolean(botThinking),
      },
    };
    this.emitRoom();
  }

  emitRoom() {
    this.onRoomChange(this.room);
  }

  emitStatus() {
    this.onStatusChange(this.getSetupState());
  }

  clearBotTimer() {
    if (this.botTimer) {
      window.clearTimeout(this.botTimer);
      this.botTimer = 0;
    }
  }
}

function createSoloRoom({
  humanName,
  createdAt,
  updatedAt,
  rulesetId,
  difficulty,
  game,
  botThinking,
}) {
  const normalizedGame = normalizeGameState(game);
  const players = {
    [HUMAN_PLAYER_ID]: {
      id: HUMAN_PLAYER_ID,
      name: humanName,
      seat: 0,
      joinedAt: createdAt,
      type: "human",
    },
    [BOT_PLAYER_ID]: {
      id: BOT_PLAYER_ID,
      name: BOT_NAME,
      seat: 1,
      joinedAt: createdAt,
      type: "bot",
    },
  };

  return {
    roomId: SOLO_ROOM_ID,
    hostPlayerId: HUMAN_PLAYER_ID,
    rulesetId,
    createdAt,
    updatedAt,
    lastError: null,
    players,
    activePlayers: [
      players[HUMAN_PLAYER_ID],
      players[BOT_PLAYER_ID],
    ],
    commands: {},
    gameMode: "solo-bot",
    game: normalizedGame,
    meta: {
      roomId: SOLO_ROOM_ID,
      hostPlayerId: HUMAN_PLAYER_ID,
      hostBrowserId: HUMAN_BROWSER_ID,
      godViewEnabled: false,
      rulesetId,
      createdAt,
      updatedAt,
      playerCount: 2,
      open: false,
      participants: {
        [HUMAN_PLAYER_ID]: true,
        [BOT_PLAYER_ID]: true,
      },
      seats: {
        0: HUMAN_PLAYER_ID,
        1: BOT_PLAYER_ID,
      },
      seatBrowserIds: {
        0: HUMAN_BROWSER_ID,
        1: BOT_BROWSER_ID,
      },
      gameMode: "solo-bot",
      soloDifficulty: normalizeSoloDifficulty(difficulty),
      botThinking: Boolean(botThinking),
    },
  };
}

function getHumanPlayer(room) {
  return room && room.players && room.players[HUMAN_PLAYER_ID]
    ? room.players[HUMAN_PLAYER_ID]
    : { name: "你" };
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Ignore Safari private mode write failures.
  }
}
