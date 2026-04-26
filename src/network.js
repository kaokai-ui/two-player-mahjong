import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  get,
  getDatabase,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";
import {
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  initializeAppCheck,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app-check.js";
import {
  DEFAULT_DRAW_REVEAL_SECONDS,
  applyGameCommand,
  createStartedGame,
  createWaitingGame,
  normalizeGameState,
} from "./game.js?v=20260426c";
import { DEFAULT_RULESET } from "./rules.js?v=20260425i";
import {
  firebaseAppCheckConfig,
  firebaseConfig,
  isAppCheckConfigured,
  isFirebaseConfigured,
} from "./firebase-config.js?v=20260426a";

const BROWSER_ID_KEY = "mahjong-browser-id";
const PLAYER_NAME_KEY = "mahjong-player-name";
const ROOM_EXPIRATION_MS = 8 * 24 * 60 * 60 * 1000;
const COMMAND_TYPES = new Set([
  "startGame",
  "restartGame",
  "drawTile",
  "discardTile",
  "passClaim",
  "claimChow",
  "claimPung",
  "claimDiscardKong",
  "declareSelfDraw",
  "claimWin",
  "concealedKong",
  "addedKong",
]);
const storageFallback = new Map();

const firebaseSetupState = {
  configured: isFirebaseConfigured(),
  appCheckConfigured: isAppCheckConfigured(),
  initializing: false,
  ready: false,
  authReady: false,
  uid: "",
  appCheckEnabled: false,
  appCheckReady: false,
  appCheckProvider: "",
  appCheckDebug: false,
  appCheckMessage: "尚未設定",
  error: "",
};

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDatabase = null;
let firebaseAppCheck = null;
let firebaseInitPromise = null;
let authObserverStarted = false;
let anonymousSignInInFlight = null;
let authReadyPromise = null;
let resolveAuthReady = null;
let rejectAuthReady = null;

export class NetworkController {
  constructor({ onRoomChange, onInfo, onError, onStatusChange }) {
    this.onRoomChange = onRoomChange;
    this.onInfo = onInfo;
    this.onError = onError;
    this.onStatusChange = typeof onStatusChange === "function" ? onStatusChange : () => {};
    this.roomId = "";
    this.room = null;
    this.roomSnapshot = "";
    this.roomData = null;
    this.roomMeta = null;
    this.commandChain = Promise.resolve();
    this.processingCommand = false;
    this.roomUnsubscribe = null;
    this.roomMetaUnsubscribe = null;
  }

  async init() {
    if (!isFirebaseConfigured()) {
      setSetupState({
        configured: false,
        ready: false,
        initializing: false,
        authReady: false,
        uid: "",
        error: "",
        appCheckConfigured: isAppCheckConfigured(),
        appCheckEnabled: false,
        appCheckReady: false,
        appCheckProvider: "",
        appCheckMessage: "請先填寫 Firebase 設定",
      });
      this.emitStatus();
      this.onInfo("請先檢查 src/firebase-config.js 內的 Firebase 正式設定；本機 override 請放在 local-admin/firebase-config.local.js。");
      return false;
    }

    await ensureFirebaseReady((message) => {
      this.onError(message);
    });
    this.emitStatus();
    return true;
  }

  getIdentity() {
    return {
      playerId: firebaseSetupState.uid || "",
      browserId: getOrCreateBrowserId(),
      playerName: readStorage(PLAYER_NAME_KEY) || "",
    };
  }

  getSetupState() {
    return getFirebaseSetupState();
  }

  setPlayerName(playerName) {
    const trimmed = String(playerName || "").trim();
    if (!trimmed) {
      throw new Error("請先輸入玩家名稱。");
    }

    writeStorage(PLAYER_NAME_KEY, trimmed);
    return trimmed;
  }

  async createRoom({
    roomId,
    playerName,
    rulesetId = DEFAULT_RULESET,
    drawRevealSeconds = DEFAULT_DRAW_REVEAL_SECONDS,
  }) {
    try {
      await this.ensureReady();

      const trimmedName = this.setPlayerName(playerName);
      const normalizedRoomId = normalizeRoomId(roomId);
      if (!normalizedRoomId) {
        throw new Error("請輸入房號。");
      }

      const identity = this.getIdentity();
      if (!identity.playerId || !identity.browserId) {
        throw new Error("匿名登入尚未完成，請稍候再試。");
      }

      const existingMeta = normalizeRoomMeta((await get(dbRef(`roomMeta/${normalizedRoomId}`))).val());
      if (existingMeta && !isRoomExpired(existingMeta)) {
        throw new Error("這個房號已存在，請換一個房號。");
      }

      const now = Date.now();
      const createdMeta = {
        roomId: normalizedRoomId,
        hostPlayerId: identity.playerId,
        hostBrowserId: identity.browserId,
        rulesetId,
        createdAt: now,
        updatedAt: now,
        playerCount: 1,
        open: true,
        participants: {
          [identity.playerId]: true,
        },
        seats: {
          0: identity.playerId,
        },
        seatBrowserIds: {
          0: identity.browserId,
        },
      };

      await setWithContext(`roomMeta/${normalizedRoomId}`, createdMeta); /*
        metaRef,
        (current) => {
          if (current) {
            createError = "這個房號已存在，請換一個房號。";
            return;
          }

          return createdMeta;
        },
        { applyLocally: false },
      ); */

      /* if (!createResult.committed) {
        throw new Error(createError || "建立房間失敗，請稍後再試。");
      }

      await setWithContext(`roomMeta/${normalizedRoomId}`, normalizeRoomMeta(createResult.snapshot.val()) || createdMeta); */

      const roomData = {
        roomId: normalizedRoomId,
        hostPlayerId: identity.playerId,
        rulesetId,
        createdAt: now,
        updatedAt: now,
        lastError: null,
        players: {
          [identity.playerId]: {
            id: identity.playerId,
            name: trimmedName,
            seat: 0,
            joinedAt: now,
          },
        },
        game: createWaitingGame(rulesetId, { drawRevealSeconds }),
        commands: {},
      };

      await writeInitialRoomRecord(normalizedRoomId, roomData);
      this.subscribeToRoom(normalizedRoomId);
    } catch (error) {
      throw new Error(formatFirebaseClientError(error));
    }
  }

  async joinRoom({ roomId, playerName }) {
    try {
      await this.ensureReady();

      const trimmedName = this.setPlayerName(playerName);
      const normalizedRoomId = normalizeRoomId(roomId);
      if (!normalizedRoomId) {
        throw new Error("請輸入房號。");
      }

      const identity = this.getIdentity();
      if (!identity.playerId || !identity.browserId) {
        throw new Error("匿名登入尚未完成，請稍候再試。");
      }

      let meta = normalizeRoomMeta((await get(dbRef(`roomMeta/${normalizedRoomId}`))).val());
      if (!meta) {
        throw new Error("找不到這個房間。");
      }

      if (isRoomExpired(meta)) {
        throw new Error("這個房間已超過 8 天沒有活動，請重新建立房間。");
      }

      const browserSeat = getSeatForBrowser(meta, identity.browserId);
      if (browserSeat != null) {
        await this.reclaimSeat(normalizedRoomId, meta, browserSeat, trimmedName, identity);
        return;
      }

      if (!isParticipant(meta, identity.playerId)) {
        if (!meta.open || seatExists(meta, 1)) {
          throw new Error("房間已滿。");
        }

        const now = Date.now();
        const joinedMeta = {
          ...meta,
          updatedAt: now,
          playerCount: 2,
          open: false,
          participants: {
            ...meta.participants,
            [identity.playerId]: true,
          },
          seats: {
            ...meta.seats,
            1: identity.playerId,
          },
          seatBrowserIds: {
            ...meta.seatBrowserIds,
            1: identity.browserId,
          },
        };
        meta = joinedMeta;
        await setWithContext(`roomMeta/${normalizedRoomId}`, meta);
        /* metaRef,
          (current) => {
            const currentMeta = normalizeRoomMeta(current);
            if (!currentMeta) {
              joinError = "找不到這個房間。";
              return;
            }

            if (isParticipant(currentMeta, identity.playerId)) {
              return currentMeta;
            }

            if (!currentMeta.open || currentMeta.seats[1]) {
              joinError = "房間已滿。";
              return;
            }

            return {
              ...joinedMeta,
              participants: {
                ...currentMeta.participants,
                [identity.playerId]: true,
              },
              seats: {
                ...currentMeta.seats,
                1: identity.playerId,
              },
            };
          },
          { applyLocally: false },
        ); */

        /* if (!joinResult.committed) {
          throw new Error(joinError || "加入房間失敗，請稍後再試。");
        }

        meta = normalizeRoomMeta(joinResult.snapshot.val()) || joinedMeta;
        await setWithContext(`roomMeta/${normalizedRoomId}`, meta); */
      }

      const seat = getSeatForPlayer(meta, identity.playerId);
      if (seat == null) {
        throw new Error("房間座位資料不完整，請重新建立房間。");
      }

      const roomSnapshot = await get(dbRef(`rooms/${normalizedRoomId}`));
      const roomData = normalizeRoom(roomSnapshot.val(), meta);
      if (!roomData) {
        throw new Error("房間資料尚未建立完成，請稍後再試。");
      }

      const existingPlayer = roomData.players ? roomData.players[identity.playerId] : null;
      const joinedAt =
        existingPlayer && typeof existingPlayer.joinedAt === "number" ? existingPlayer.joinedAt : Date.now();

      await setWithContext(`rooms/${normalizedRoomId}/players/${identity.playerId}`, {
        id: identity.playerId,
        name: trimmedName,
        seat,
        joinedAt,
      });
      await setWithContext(`rooms/${normalizedRoomId}/updatedAt`, Date.now());

      this.subscribeToRoom(normalizedRoomId);
    } catch (error) {
      throw new Error(formatFirebaseClientError(error));
    }
  }

  async reclaimSeat(roomId, meta, seat, playerName, identity) {
    const previousPlayerId = getSeatValue(meta, seat);
    const now = Date.now();
    const nextParticipants = {
      ...(meta.participants || {}),
      [identity.playerId]: true,
    };

    if (previousPlayerId && previousPlayerId !== identity.playerId) {
      delete nextParticipants[previousPlayerId];
    }

    const nextSeats = {
      ...(meta.seats || {}),
      [seat]: identity.playerId,
    };
    const occupiedSeatCount = countOccupiedSeats(nextSeats);
    const nextMeta = {
      ...meta,
      hostPlayerId: seat === 0 ? identity.playerId : meta.hostPlayerId,
      updatedAt: now,
      playerCount: occupiedSeatCount,
      open: occupiedSeatCount < 2,
      participants: nextParticipants,
      seats: nextSeats,
      seatBrowserIds: {
        ...(meta.seatBrowserIds || {}),
        [seat]: identity.browserId,
      },
    };

    await setWithContext(`roomMeta/${roomId}`, nextMeta);

    if (seat === 0) {
      await setWithContext(`rooms/${roomId}/hostPlayerId`, identity.playerId);
    }

    const roomSnapshot = await get(dbRef(`rooms/${roomId}`));
    const roomData = normalizeRoom(roomSnapshot.val(), nextMeta);
    if (!roomData) {
      throw new Error("房間資料尚未建立完成，請稍後再試。");
    }

    const previousPlayer =
      previousPlayerId && roomData.players ? roomData.players[previousPlayerId] : null;
    const joinedAt =
      previousPlayer && typeof previousPlayer.joinedAt === "number" ? previousPlayer.joinedAt : now;

    await setWithContext(`rooms/${roomId}/players/${identity.playerId}`, {
      id: identity.playerId,
      name: playerName,
      seat,
      joinedAt,
    });
    await setWithContext(`rooms/${roomId}/updatedAt`, now);
    this.subscribeToRoom(roomId);
  }

  async sendGameCommand(type, payload = {}) {
    try {
      await this.ensureReady();
      if (!this.roomId) {
        throw new Error("尚未加入房間。");
      }

      if (!COMMAND_TYPES.has(type)) {
        throw new Error("未知的操作。");
      }

      const identity = this.getIdentity();
      const sanitizedPayload = sanitizeCommandPayload(payload);
      const command = {
        type,
        fromPlayerId: identity.playerId,
        createdAt: Date.now(),
      };

      if (sanitizedPayload !== undefined) {
        command.payload = sanitizedPayload;
      }

      if (this.isHost()) {
        await this.processCommandEntry({
          key: null,
          command,
        });
        return;
      }

      await push(dbRef(`rooms/${this.roomId}/commands`), command);
    } catch (error) {
      throw new Error(formatFirebaseClientError(error));
    }
  }

  leaveRoom() {
    if (typeof this.roomUnsubscribe === "function") {
      this.roomUnsubscribe();
      this.roomUnsubscribe = null;
    }
    if (typeof this.roomMetaUnsubscribe === "function") {
      this.roomMetaUnsubscribe();
      this.roomMetaUnsubscribe = null;
    }

    this.roomId = "";
    this.room = null;
    this.roomSnapshot = "";
    this.roomData = null;
    this.roomMeta = null;
    this.processingCommand = false;
    this.onRoomChange(null);
  }

  isHost() {
    const identity = this.getIdentity();
    return Boolean(this.room && this.room.hostPlayerId === identity.playerId);
  }

  subscribeToRoom(roomId) {
    this.leaveRoom();
    this.roomId = roomId;

    this.roomMetaUnsubscribe = onValue(
      dbRef(`roomMeta/${roomId}`),
      (snapshot) => {
        this.roomMeta = normalizeRoomMeta(snapshot.val());
        this.emitCombinedRoom();
      },
      (error) => {
        this.onError(formatFirebaseClientError(error));
      },
    );

    this.roomUnsubscribe = onValue(
      dbRef(`rooms/${roomId}`),
      (snapshot) => {
        this.roomData = snapshot.val();
        this.emitCombinedRoom();
        this.queuePendingCommand();
      },
      (error) => {
        this.onError(formatFirebaseClientError(error));
      },
    );
  }

  emitCombinedRoom() {
    const nextRoom = normalizeRoom(this.roomData, this.roomMeta);
    const nextSnapshot = JSON.stringify(nextRoom);
    const changed = nextSnapshot !== this.roomSnapshot;

    this.room = nextRoom;
    this.roomSnapshot = nextSnapshot;

    if (changed) {
      this.onRoomChange(this.room);
    }
  }

  queuePendingCommand() {
    if (!this.roomId || !this.isHost() || this.processingCommand) {
      return;
    }

    const pendingCommands = this.getPendingCommands();
    if (!pendingCommands.length) {
      return;
    }

    this.processingCommand = true;
    this.commandChain = this.commandChain
      .then(() => this.processCommandEntry(pendingCommands[0]))
      .catch((error) => {
        this.onError(error.message);
      })
      .then(() => {
        this.processingCommand = false;
        this.queuePendingCommand();
      });
  }

  getPendingCommands() {
    const commands = (this.room && this.room.commands) || {};
    return Object.keys(commands)
      .map((key) => ({ key, command: commands[key] }))
      .sort((left, right) => getCommandTimestamp(left.command) - getCommandTimestamp(right.command));
  }

  async processCommandEntry({ key, command }) {
    if (!this.roomId) {
      return;
    }

    if (!this.room) {
      return;
    }

    if (!command) {
      if (key) {
        await remove(dbRef(`rooms/${this.roomId}/commands/${key}`));
      }
      return;
    }

    const players = getActivePlayers(this.room);
    const player = players.find((item) => item && item.id === command.fromPlayerId);
    if (!player) {
      if (key) {
        await remove(dbRef(`rooms/${this.roomId}/commands/${key}`));
      }
      return;
    }

    let nextGame = null;
    let errorMessage = "";

    try {
      if (command.type === "startGame") {
        if (players.length < 2) {
          errorMessage = "兩位玩家都加入房間後才能開始對局。";
        } else if (this.room.game && this.room.game.status === "playing") {
          return;
        } else {
          nextGame = createStartedGame(
            getCommandRulesetId(command, this.room.rulesetId || DEFAULT_RULESET),
            this.room.game,
          );
        }
      } else {
        const result = applyGameCommand(this.room.game, {
          playerSeat: player.seat,
          type: command.type,
          payload: command.payload || {},
        });

        if (!result.ok) {
          errorMessage = result.message;
        } else {
          nextGame = result.game;
        }
      }

      if (nextGame) {
        await writeHostGameState(this.roomId, {
          game: nextGame,
          rulesetId: nextGame.rulesetId,
          updatedAt: Date.now(),
          lastError: null,
        });
      } else if (errorMessage) {
        await writeHostGameState(this.roomId, {
          updatedAt: Date.now(),
          lastError: {
            playerId: command.fromPlayerId,
            message: errorMessage,
            at: Date.now(),
          },
        });
      }
    } catch (error) {
      await writeHostGameState(this.roomId, {
        updatedAt: Date.now(),
        lastError: {
          playerId: command.fromPlayerId,
          message: error.message || "處理指令時發生錯誤。",
          at: Date.now(),
        },
      });
      throw error;
    } finally {
      if (key) {
        await remove(dbRef(`rooms/${this.roomId}/commands/${key}`));
      }
    }
  }

  async ensureReady() {
    await this.init();
    if (!firebaseSetupState.ready || !firebaseSetupState.authReady || !firebaseSetupState.uid) {
      throw new Error("Firebase 尚未完成匿名登入，請稍候再試。");
    }
  }

  emitStatus() {
    this.onStatusChange(this.getSetupState());
  }
}

export function normalizeRoomId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export function createRandomRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function getFirebaseSetupState() {
  return {
    ...firebaseSetupState,
  };
}

function setSetupState(patch) {
  Object.assign(firebaseSetupState, patch);
}

async function ensureFirebaseReady(reportError) {
  if (firebaseInitPromise) {
    return firebaseInitPromise;
  }

  firebaseInitPromise = (async () => {
    if (!isFirebaseConfigured()) {
      return false;
    }

    setSetupState({
      configured: true,
      appCheckConfigured: isAppCheckConfigured(),
      initializing: true,
      ready: false,
      error: "",
    });

    firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    initializeAppCheckIfNeeded(reportError);
    firebaseAuth = getAuth(firebaseApp);
    firebaseDatabase = getDatabase(firebaseApp);

    await waitForAnonymousAuth(reportError);

    setSetupState({
      initializing: false,
      ready: true,
      error: "",
    });

    return true;
  })().catch((error) => {
    setSetupState({
      initializing: false,
      ready: false,
      error: formatFirebaseClientError(error),
    });
    firebaseInitPromise = null;
    throw error;
  });

  return firebaseInitPromise;
}

function initializeAppCheckIfNeeded(reportError) {
  const config = normalizeAppCheckConfig(firebaseAppCheckConfig);
  const providerLabel = config.provider === "recaptcha-v3" ? "reCAPTCHA v3" : "reCAPTCHA Enterprise";
  const usingDebugToken = Boolean(config.debugToken);

  setSetupState({
    appCheckConfigured: Boolean(config.siteKey),
    appCheckEnabled: false,
    appCheckReady: false,
    appCheckProvider: providerLabel,
    appCheckDebug: usingDebugToken,
    appCheckMessage: config.enabled === false ? "已停用" : config.siteKey ? "準備初始化" : "尚未填寫 site key",
  });

  if (config.enabled === false || !config.siteKey) {
    return;
  }

  if (!isSecureAppCheckOrigin() && !usingDebugToken) {
    setSetupState({
      appCheckEnabled: false,
      appCheckReady: false,
      appCheckMessage: "目前網址不是 HTTPS/localhost，已先略過",
    });
    return;
  }

  if (usingDebugToken && typeof self !== "undefined") {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = config.debugToken === true ? true : config.debugToken;
  }

  try {
    const provider =
      config.provider === "recaptcha-v3"
        ? new ReCaptchaV3Provider(config.siteKey)
        : new ReCaptchaEnterpriseProvider(config.siteKey);
    firebaseAppCheck = initializeAppCheck(firebaseApp, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
    setSetupState({
      appCheckEnabled: true,
      appCheckReady: true,
      appCheckMessage: usingDebugToken ? "已啟用 Debug Token" : "已啟用",
    });
  } catch (error) {
    const message = formatFirebaseClientError(error);
    setSetupState({
      appCheckEnabled: false,
      appCheckReady: false,
      appCheckMessage: `初始化失敗：${message}`,
      error: message,
    });
    if (typeof reportError === "function") {
      reportError(message);
    }
  }
}

function normalizeAppCheckConfig(config) {
  const rawProvider = String((config && config.provider) || "recaptcha-enterprise").trim().toLowerCase();
  const rawDebugToken = config ? config.debugToken : "";
  const normalizedDebugToken =
    rawDebugToken === true || String(rawDebugToken || "").trim().toLowerCase() === "true"
      ? true
      : String(rawDebugToken || "").trim().toLowerCase() === "false"
        ? ""
        : rawDebugToken
          ? String(rawDebugToken).trim()
          : "";
  return {
    enabled: !config || config.enabled !== false,
    provider: rawProvider === "recaptcha-v3" ? "recaptcha-v3" : "recaptcha-enterprise",
    siteKey: String((config && config.siteKey) || "").trim(),
    debugToken: normalizedDebugToken,
  };
}

function isSecureAppCheckOrigin() {
  if (typeof window === "undefined") {
    return false;
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
}

async function waitForAnonymousAuth(reportError) {
  if (firebaseSetupState.authReady && firebaseSetupState.uid) {
    return firebaseSetupState.uid;
  }

  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve, reject) => {
      resolveAuthReady = resolve;
      rejectAuthReady = reject;
    });
  }

  if (!authObserverStarted) {
    authObserverStarted = true;
    onAuthStateChanged(
      firebaseAuth,
      async (user) => {
        if (user) {
          setSetupState({
            authReady: true,
            uid: user.uid,
            error: "",
          });
          if (resolveAuthReady) {
            resolveAuthReady(user.uid);
            resolveAuthReady = null;
            rejectAuthReady = null;
          }
          return;
        }

        setSetupState({
          authReady: false,
          uid: "",
        });

        try {
          await ensureAnonymousSignIn();
        } catch (error) {
          const message = formatFirebaseClientError(error);
          setSetupState({
            ready: false,
            error: message,
          });
          if (rejectAuthReady) {
            rejectAuthReady(error);
            resolveAuthReady = null;
            rejectAuthReady = null;
          }
          if (typeof reportError === "function") {
            reportError(message);
          }
        }
      },
      (error) => {
        const message = formatFirebaseClientError(error);
        setSetupState({
          ready: false,
          error: message,
        });
        if (rejectAuthReady) {
          rejectAuthReady(error);
          resolveAuthReady = null;
          rejectAuthReady = null;
        }
        if (typeof reportError === "function") {
          reportError(message);
        }
      },
    );
  }

  return authReadyPromise;
}

async function ensureAnonymousSignIn() {
  if (anonymousSignInInFlight) {
    return anonymousSignInInFlight;
  }

  anonymousSignInInFlight = signInAnonymously(firebaseAuth).finally(() => {
    anonymousSignInInFlight = null;
  });
  return anonymousSignInInFlight;
}

function dbRef(path) {
  return ref(firebaseDatabase, String(path || "").replace(/^\/+/, ""));
}

async function writeInitialRoomRecord(roomId, roomData) {
  await setWithContext(`rooms/${roomId}`, roomData);
}

async function writeHostGameState(roomId, { game, rulesetId, updatedAt, lastError }) {
  if (game !== undefined) {
    await setWithContext(`rooms/${roomId}/game`, game);
  }
  if (rulesetId !== undefined) {
    await setWithContext(`rooms/${roomId}/rulesetId`, rulesetId);
  }
  if (updatedAt !== undefined) {
    await setWithContext(`rooms/${roomId}/updatedAt`, updatedAt);
  }
  await setWithContext(`rooms/${roomId}/lastError`, lastError === undefined ? null : lastError);
}

async function setWithContext(path, value) {
  try {
    await set(dbRef(path), value);
  } catch (error) {
    throw new Error(`${path}：${formatFirebaseClientError(error)}`);
  }
}

function normalizeRoom(room, meta = null) {
  if (!room) {
    return null;
  }

  const normalizedMeta = normalizeRoomMeta(meta);
  const normalizedPlayers = room.players || {};

  return {
    ...room,
    roomId: room.roomId || (normalizedMeta && normalizedMeta.roomId) || "",
    hostPlayerId: room.hostPlayerId || (normalizedMeta && normalizedMeta.hostPlayerId) || "",
    rulesetId: room.rulesetId || (normalizedMeta && normalizedMeta.rulesetId) || DEFAULT_RULESET,
    meta: normalizedMeta,
    players: normalizedPlayers,
    activePlayers: buildActivePlayers(normalizedPlayers, normalizedMeta),
    commands: room.commands || {},
    game: normalizeGameState(room.game),
  };
}

function normalizeRoomMeta(meta) {
  if (!meta) {
    return null;
  }

  return {
    roomId: meta.roomId || "",
    hostPlayerId: meta.hostPlayerId || "",
    hostBrowserId: meta.hostBrowserId || "",
    rulesetId: meta.rulesetId || DEFAULT_RULESET,
    createdAt: typeof meta.createdAt === "number" ? meta.createdAt : 0,
    updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : 0,
    playerCount: typeof meta.playerCount === "number" ? meta.playerCount : 0,
    open: Boolean(meta.open),
    participants: meta.participants || {},
    seats: meta.seats || {},
    seatBrowserIds: meta.seatBrowserIds || {},
  };
}

function buildActivePlayers(players, meta) {
  const normalizedPlayers = players || {};
  if (!meta || !meta.seats) {
    return Object.values(normalizedPlayers).sort((left, right) => left.seat - right.seat);
  }

  return [0, 1]
    .map((seat) => {
      const playerId = getSeatValue(meta, seat);
      if (!playerId) {
        return null;
      }

      const player = normalizedPlayers[playerId];
      if (player) {
        return {
          ...player,
          id: player.id || playerId,
          seat,
        };
      }

      return {
        id: playerId,
        name: "",
        seat,
        joinedAt: 0,
      };
    })
    .filter(Boolean);
}

function getActivePlayers(room) {
  if (!room) {
    return [];
  }

  if (Array.isArray(room.activePlayers) && room.activePlayers.length) {
    return room.activePlayers;
  }

  return buildActivePlayers(room.players || {}, room.meta || null);
}

function isParticipant(meta, playerId) {
  return Boolean(meta && meta.participants && meta.participants[playerId]);
}

function getSeatForPlayer(meta, playerId) {
  if (!meta || !meta.seats) {
    return null;
  }

  if (meta.seats[0] === playerId || meta.seats["0"] === playerId) {
    return 0;
  }
  if (meta.seats[1] === playerId || meta.seats["1"] === playerId) {
    return 1;
  }
  return null;
}

function getSeatForBrowser(meta, browserId) {
  if (!meta || !meta.seatBrowserIds || !browserId) {
    return null;
  }

  if (meta.seatBrowserIds[0] === browserId || meta.seatBrowserIds["0"] === browserId) {
    return 0;
  }
  if (meta.seatBrowserIds[1] === browserId || meta.seatBrowserIds["1"] === browserId) {
    return 1;
  }
  return null;
}

function seatExists(meta, seat) {
  return Boolean(getSeatValue(meta, seat));
}

function getSeatValue(meta, seat) {
  if (!meta || !meta.seats) {
    return "";
  }

  return meta.seats[seat] || meta.seats[String(seat)] || "";
}

function countOccupiedSeats(seats) {
  return [0, 1].reduce((count, seat) => count + (seats && (seats[seat] || seats[String(seat)]) ? 1 : 0), 0);
}

function isRoomExpired(meta, now = Date.now()) {
  if (!meta || typeof meta.updatedAt !== "number" || meta.updatedAt <= 0) {
    return false;
  }

  return now - meta.updatedAt > ROOM_EXPIRATION_MS;
}

function getCommandRulesetId(command, fallbackRulesetId) {
  if (command && command.payload && command.payload.rulesetId) {
    return command.payload.rulesetId;
  }
  return fallbackRulesetId;
}

function getCommandTimestamp(command) {
  return command && typeof command.createdAt === "number" ? command.createdAt : 0;
}

function sanitizeCommandPayload(value) {
  const sanitized = stripUndefined(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return sanitized;
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((result, [key, item]) => {
      if (item !== undefined) {
        result[key] = stripUndefined(item);
      }
      return result;
    }, {});
  }

  return value;
}

function getOrCreateBrowserId() {
  const existing = readStorage(BROWSER_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated =
    typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  writeStorage(BROWSER_ID_KEY, generated);
  return generated;
}

function readStorage(key) {
  if (storageFallback.has(key)) {
    return storageFallback.get(key);
  }

  try {
    const value = localStorage.getItem(key);
    if (value !== null) {
      storageFallback.set(key, value);
    }
    return value;
  } catch (error) {
    return storageFallback.has(key) ? storageFallback.get(key) : null;
  }
}

function writeStorage(key, value) {
  storageFallback.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Safari private mode can reject writes.
  }
}

function formatFirebaseClientError(error) {
  const code = String((error && error.code) || "");
  const message = String((error && error.message) || "").trim();

  if (code.includes("permission-denied") || message.includes("PERMISSION_DENIED")) {
    return "Firebase 規則拒絕這個操作。請先重新貼上最新的 local-admin/firebase-rules.json 到 Realtime Database Rules 並按 Publish。";
  }

  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return "Firebase 尚未啟用 Anonymous Authentication。";
  }

  if (code.startsWith("appCheck/")) {
    return message || "App Check 驗證失敗。";
  }

  if (code.startsWith("auth/")) {
    return message || "Firebase Authentication 發生錯誤。";
  }

  if (message) {
    return message;
  }

  return "Firebase 發生錯誤。";
}
