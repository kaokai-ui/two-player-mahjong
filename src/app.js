import { DEFAULT_DRAW_REVEAL_SECONDS, getPlayerClientState } from "./game.js?v=20260428c";
import { createRandomRoomId, NetworkController, normalizeRoomId } from "./network.js?v=20260428c";
import { DEFAULT_RULESET, getRuleset, getTileType, sortTileIds } from "./rules.js?v=20260425i";
import { DEFAULT_SCORING_ENABLED, normalizeScoringEnabled } from "./scoring.js?v=20260428c";
import { DEFAULT_SOLO_DIFFICULTY, SOLO_DIFFICULTY_LABELS, SoloController, normalizeSoloDifficulty } from "./solo-controller.js?v=20260428c";
import { getTileSvgMarkup } from "./tile-art.js?v=20260425z";

const elements = {
  noticeBanner: document.querySelector("#notice-banner"),
  firebaseStatus: document.querySelector("#firebase-status"),
  createRoomForm: document.querySelector("#create-room-form"),
  joinRoomForm: document.querySelector("#join-room-form"),
  playerNameInput: document.querySelector("#player-name-input"),
  gameModeSelect: document.querySelector("#game-mode-select"),
  lobbyTitle: document.querySelector("#lobby-title"),
  lobbyDescription: document.querySelector("#lobby-description"),
  createRoomTitle: document.querySelector("#create-room-title"),
  createRoomCodeField: document.querySelector("#create-room-code-field"),
  createRoomCodeInput: document.querySelector("#create-room-code-input"),
  joinRoomCodeInput: document.querySelector("#join-room-code-input"),
  createRulesetSelect: document.querySelector("#create-ruleset-select"),
  createSoloDifficultyField: document.querySelector("#create-solo-difficulty-field"),
  createSoloDifficultySelect: document.querySelector("#create-solo-difficulty-select"),
  createDrawRevealSecondsSelect: document.querySelector("#create-draw-reveal-seconds-select"),
  createScoringEnabledSelect: document.querySelector("#create-scoring-enabled-select"),
  createRoomSubmitButton: document.querySelector("#create-room-submit-button"),
  createRoomButton: document.querySelector('[data-submit-action="create-room"]'),
  joinRoomButton: document.querySelector('[data-submit-action="join-room"]'),
  createRoomFeedback: document.querySelector("#create-room-feedback"),
  joinRoomFeedback: document.querySelector("#join-room-feedback"),
  roomPanel: document.querySelector("#room-panel"),
  gamePanel: document.querySelector("#game-panel"),
};

const GAME_MODE_STORAGE_KEY = "mahjong-game-mode";
const SOLO_DIFFICULTY_STORAGE_KEY = "mahjong-solo-difficulty";
const SCORING_ENABLED_STORAGE_KEY = "mahjong-scoring-enabled";
const DEFAULTS_VERSION_STORAGE_KEY = "mahjong-defaults-version";
const GAME_MODE_ONLINE = "online";
const GAME_MODE_SOLO = "solo-bot";
const DEFAULTS_VERSION = "20260428-solo-hard-scoring-on";
const DRAW_REVEAL_FINAL_STEP_MS = 100;
const DRAW_REVEAL_GRACE_MS = 350;

const appState = {
  room: null,
  message: "",
  error: "",
  lastLobbyAction: "",
  drawRevealKey: "",
  drawRevealCompletedKey: "",
  drawRevealEndsAt: 0,
  countdownTimer: 0,
  autoDrawKey: "",
  selectedMode: GAME_MODE_SOLO,
  selectedSoloDifficulty: DEFAULT_SOLO_DIFFICULTY,
  selectedScoringEnabled: DEFAULT_SCORING_ENABLED,
};

const TILE_NUMBER_LABELS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONOR_TILE_NAMES = {
  E: "東風",
  S: "南風",
  W: "西風",
  N: "北風",
  R: "紅中",
  G: "發財",
  B: "白板",
};
const TILE_GLYPHS = {
  E: String.fromCodePoint(0x1f000),
  S: String.fromCodePoint(0x1f001),
  W: String.fromCodePoint(0x1f002),
  N: String.fromCodePoint(0x1f003),
  R: String.fromCodePoint(0x1f004),
  G: String.fromCodePoint(0x1f005),
  B: String.fromCodePoint(0x1f006),
};

const queryRoom = new URL(window.location.href).searchParams.get("room");
applyDefaultSettingsMigration();

const storedMode = readLocalSetting(GAME_MODE_STORAGE_KEY) || GAME_MODE_SOLO;
appState.selectedMode = queryRoom ? GAME_MODE_ONLINE : normalizeGameMode(storedMode);
appState.selectedSoloDifficulty = normalizeSoloDifficulty(readLocalSetting(SOLO_DIFFICULTY_STORAGE_KEY));
appState.selectedScoringEnabled = normalizeScoringEnabled(readLocalSetting(SCORING_ENABLED_STORAGE_KEY));

let controller = null;
let controllerInitToken = 0;

if (queryRoom) {
  elements.joinRoomCodeInput.value = normalizeRoomId(queryRoom);
}

elements.gameModeSelect.value = appState.selectedMode;
elements.createSoloDifficultySelect.value = appState.selectedSoloDifficulty;
elements.createScoringEnabledSelect.value = String(appState.selectedScoringEnabled);
syncModeSpecificInputs();

document.addEventListener("fullscreenchange", render);
document.addEventListener("webkitfullscreenchange", render);

initializeController(appState.selectedMode);
syncPlayerNameFromController();

elements.createRoomCodeInput.value = createRandomRoomId();
moveCreateRevealFieldAboveButton();

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await handleCreateRoomSubmit();
});

elements.joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await handleJoinRoomSubmit();
});

elements.createRoomButton.addEventListener("click", async (event) => {
  event.preventDefault();
  await handleCreateRoomSubmit();
});

elements.joinRoomButton.addEventListener("click", async (event) => {
  event.preventDefault();
  await handleJoinRoomSubmit();
});

elements.gameModeSelect.addEventListener("change", async () => {
  const nextMode = normalizeGameMode(elements.gameModeSelect.value);
  if (nextMode === appState.selectedMode) {
    return;
  }

  switchMode(nextMode);
});

elements.createSoloDifficultySelect.addEventListener("change", () => {
  appState.selectedSoloDifficulty = normalizeSoloDifficulty(elements.createSoloDifficultySelect.value);
  writeLocalSetting(SOLO_DIFFICULTY_STORAGE_KEY, appState.selectedSoloDifficulty);
  render();
});

elements.createScoringEnabledSelect.addEventListener("change", () => {
  appState.selectedScoringEnabled = normalizeScoringEnabled(elements.createScoringEnabledSelect.value);
  writeLocalSetting(SCORING_ENABLED_STORAGE_KEY, String(appState.selectedScoringEnabled));
  render();
});

elements.createRoomForm.addEventListener("click", (event) => {
  const target = getClosestTarget(event, "[data-room-action]");
  if (!target) {
    return;
  }

  if (target.dataset.roomAction === "new-room-code") {
    elements.createRoomCodeInput.value = createRandomRoomId();
    appState.message = "已產生新房號。";
    render();
  }
});

elements.roomPanel.addEventListener("click", async (event) => {
  const target = getClosestTarget(event, "[data-room-action]");
  if (!target) {
    return;
  }

  appState.error = "";

  try {
    if (target.dataset.roomAction === "start-game") {
      const roomRulesetSelect = document.querySelector("#room-ruleset-select");
      const selectedRulesetId =
        roomRulesetSelect && roomRulesetSelect.value
          ? roomRulesetSelect.value
          : elements.createRulesetSelect.value || DEFAULT_RULESET;
      await controller.sendGameCommand("startGame", {
        rulesetId: selectedRulesetId,
      });
      appState.message = "已送出開局指令。";
    }

    if (target.dataset.roomAction === "copy-link") {
      await navigator.clipboard.writeText(buildShareUrl());
      appState.message = "已複製邀請連結。";
    }

    render();
  } catch (error) {
    appState.error = error.message;
    render();
  }
});

elements.gamePanel.addEventListener("click", async (event) => {
  const uiTarget = getClosestTarget(event, "[data-ui-action]");
  if (uiTarget) {
    event.preventDefault();
    await handleUiAction(uiTarget.dataset.uiAction);
    return;
  }

  const target = getClosestTarget(event, "[data-command]");
  if (!target) {
    return;
  }

  appState.error = "";

  try {
    await controller.sendGameCommand(target.dataset.command, readCommandPayload(target));
    appState.message = "已送出操作。";
    render();
  } catch (error) {
    appState.error = error.message;
    render();
  }
});

elements.createRoomCodeInput.addEventListener("input", () => {
  elements.createRoomCodeInput.value = normalizeRoomId(elements.createRoomCodeInput.value);
});

elements.joinRoomCodeInput.addEventListener("input", () => {
  elements.joinRoomCodeInput.value = normalizeRoomId(elements.joinRoomCodeInput.value);
});

render();
document.documentElement.dataset.appReady = "yes";
const bootWarning = document.querySelector("#boot-warning");
if (bootWarning) {
  bootWarning.hidden = true;
  bootWarning.remove();
}

function moveCreateRevealFieldAboveButton() {
  if (!elements.createRoomForm || !elements.createDrawRevealSecondsSelect || !elements.createRoomButton) {
    return;
  }

  const revealField = elements.createDrawRevealSecondsSelect.closest(".field");
  if (!revealField || revealField.nextElementSibling === elements.createRoomButton) {
    return;
  }

  elements.createRoomForm.insertBefore(revealField, elements.createRoomButton);
}

function buildController(mode) {
  const callbacks = {
    onRoomChange: (room) => {
      appState.room = room;
      render();
    },
    onInfo: (message) => {
      appState.message = message;
      render();
    },
    onError: (message) => {
      appState.error = message;
      render();
    },
    onStatusChange: () => {
      render();
    },
  };

  return mode === GAME_MODE_SOLO ? new SoloController(callbacks) : new NetworkController(callbacks);
}

async function initializeController(mode) {
  const token = ++controllerInitToken;

  if (controller) {
    controller.leaveRoom();
  }

  controller = buildController(mode);
  appState.room = null;
  appState.message = "";
  appState.error = "";
  appState.lastLobbyAction = "";
  clearDrawRevealState();
  appState.autoDrawKey = "";
  render();

  try {
    await controller.init();
    if (token !== controllerInitToken) {
      return;
    }
    syncPlayerNameFromController();
    render();
  } catch (error) {
    if (token !== controllerInitToken) {
      return;
    }
    appState.error = error.message;
    render();
  }
}

function syncPlayerNameFromController() {
  if (!controller || !elements.playerNameInput) {
    return;
  }

  const identity = controller.getIdentity();
  if (identity && identity.playerName) {
    elements.playerNameInput.value = identity.playerName;
  }
}

function switchMode(mode) {
  appState.selectedMode = mode;
  writeLocalSetting(GAME_MODE_STORAGE_KEY, mode);
  clearShareLink();
  elements.gameModeSelect.value = mode;
  syncModeSpecificInputs();
  initializeController(mode);
}

function syncModeSpecificInputs() {
  if (appState.selectedMode === GAME_MODE_SOLO) {
    if (elements.createRoomCodeInput) {
      elements.createRoomCodeInput.value = "";
    }
    if (elements.joinRoomCodeInput) {
      elements.joinRoomCodeInput.value = "";
    }
    return;
  }

  if (elements.createRoomCodeInput && !elements.createRoomCodeInput.value.trim()) {
    elements.createRoomCodeInput.value = createRandomRoomId();
  }
}

async function handleCreateRoomSubmit() {
  appState.error = "";
  appState.lastLobbyAction = "create";

  try {
    if (appState.selectedMode === GAME_MODE_SOLO) {
      await controller.createSoloGame({
        playerName: elements.playerNameInput.value,
        rulesetId: elements.createRulesetSelect.value || DEFAULT_RULESET,
        drawRevealSeconds: readCreateDrawRevealSeconds(),
        difficulty: appState.selectedSoloDifficulty,
        scoringEnabled: readCreateScoringEnabled(),
      });
      appState.message = "已開始單人對局。";
      appState.lastLobbyAction = "";
      clearShareLink();
      render();
      return;
    }

    await controller.createRoom({
      roomId: elements.createRoomCodeInput.value,
      playerName: elements.playerNameInput.value,
      rulesetId: elements.createRulesetSelect.value || DEFAULT_RULESET,
      drawRevealSeconds: readCreateDrawRevealSeconds(),
      scoringEnabled: readCreateScoringEnabled(),
    });
    appState.message = "已建立房間。";
    appState.lastLobbyAction = "";
    updateShareLink();
    render();
  } catch (error) {
    appState.error = error.message;
    render();
  }
}

async function handleJoinRoomSubmit() {
  appState.error = "";
  appState.lastLobbyAction = "join";

  try {
    if (appState.selectedMode !== GAME_MODE_ONLINE) {
      throw new Error("單人模式不需要加入房間。");
    }

    await controller.joinRoom({
      roomId: elements.joinRoomCodeInput.value,
      playerName: elements.playerNameInput.value,
    });
    appState.message = "已加入房間。";
    appState.lastLobbyAction = "";
    updateShareLink();
    render();
  } catch (error) {
    appState.error = error.message;
    render();
  }
}

function render() {
  updatePageMode();
  renderModeUi();
  renderBanner();
  renderFirebaseStatus();
  renderLobbyFeedback();
  renderRoomPanel();
  renderGamePanel();
}

function renderModeUi() {
  const isSoloMode = appState.selectedMode === GAME_MODE_SOLO;

  if (elements.gameModeSelect && elements.gameModeSelect.value !== appState.selectedMode) {
    elements.gameModeSelect.value = appState.selectedMode;
  }

  if (elements.createSoloDifficultySelect && elements.createSoloDifficultySelect.value !== appState.selectedSoloDifficulty) {
    elements.createSoloDifficultySelect.value = appState.selectedSoloDifficulty;
  }

  if (elements.lobbyTitle) {
    elements.lobbyTitle.textContent = isSoloMode ? "開始單人對局" : "建立或加入房間";
  }

  if (elements.lobbyDescription) {
    elements.lobbyDescription.textContent = isSoloMode
      ? "單人模式不需要 Firebase 房間，電腦玩家會直接在這台裝置上思考與出牌。"
      : "建立新房後，把房號分享給另一位玩家；雙方都加入後就可以開始對局。";
  }

  if (elements.createRoomTitle) {
    elements.createRoomTitle.textContent = isSoloMode ? "單人對電腦" : "建立房間";
  }

  if (elements.createRoomSubmitButton) {
    elements.createRoomSubmitButton.textContent = isSoloMode ? "開始單人遊戲" : "建立房間";
  }

  if (elements.createRoomCodeField) {
    elements.createRoomCodeField.hidden = isSoloMode;
    elements.createRoomCodeField.style.display = isSoloMode ? "none" : "";
  }

  if (elements.createRoomCodeInput) {
    elements.createRoomCodeInput.disabled = isSoloMode;
  }

  if (elements.createSoloDifficultyField) {
    elements.createSoloDifficultyField.hidden = !isSoloMode;
    elements.createSoloDifficultyField.style.display = isSoloMode ? "" : "none";
  }

  if (elements.joinRoomForm) {
    elements.joinRoomForm.hidden = isSoloMode;
    elements.joinRoomForm.style.display = isSoloMode ? "none" : "";
  }

  if (elements.joinRoomCodeInput) {
    elements.joinRoomCodeInput.disabled = isSoloMode;
  }
}

function renderBanner() {
  const currentPlayer = appState.room ? getCurrentPlayer(appState.room) : null;
  const roomScopedError =
    appState.room &&
    appState.room.lastError &&
    appState.room.lastError.playerId === (currentPlayer ? currentPlayer.id : "")
      ? appState.room.lastError.message
      : "";
  const hasResultOverlay = Boolean(appState.room && appState.room.game && appState.room.game.result);
  const messages = hasResultOverlay
    ? [appState.error, roomScopedError].filter(Boolean)
    : [appState.error, roomScopedError, appState.message].filter(Boolean);

  elements.noticeBanner.innerHTML = messages.length
    ? `<div class="banner ${appState.error ? "banner-error" : "banner-info"}">${escapeHtml(messages[0])}</div>`
    : "";
}

function renderLobbyFeedback() {
  if (!elements.createRoomFeedback || !elements.joinRoomFeedback) {
    return;
  }

  const createFeedback =
    !appState.room && appState.lastLobbyAction === "create"
      ? (appState.error || appState.message || "")
      : "";
  const joinFeedback =
    !appState.room && appState.lastLobbyAction === "join"
      ? (appState.error || appState.message || "")
      : "";

  elements.createRoomFeedback.innerHTML = createFeedback
    ? `<div class="form-feedback-box ${appState.error ? "form-feedback-error" : "form-feedback-info"}">${escapeHtml(createFeedback)}</div>`
    : "";
  elements.joinRoomFeedback.innerHTML = joinFeedback
    ? `<div class="form-feedback-box ${appState.error ? "form-feedback-error" : "form-feedback-info"}">${escapeHtml(joinFeedback)}</div>`
    : "";
}

function renderFirebaseStatus() {
  if (appState.selectedMode === GAME_MODE_SOLO) {
    elements.createRoomButton.disabled = false;
    elements.joinRoomButton.disabled = true;
    elements.firebaseStatus.innerHTML = `
      <div class="status-card status-ready">
        <span class="status-dot"></span>
        <div>
          <strong>單人本機模式</strong>
          <p>不需要 Firebase、房號或 App Check，電腦玩家會在這台裝置上運行。</p>
          <div class="pill-row">
            <span class="pill">模式：單人對電腦</span>
            <span class="pill">難度：${escapeHtml(SOLO_DIFFICULTY_LABELS[appState.selectedSoloDifficulty] || SOLO_DIFFICULTY_LABELS[DEFAULT_SOLO_DIFFICULTY])}</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const status = controller.getSetupState();
  const ready = Boolean(status.ready && status.authReady);
  const title = !status.configured
    ? "Firebase 尚未設定"
    : ready
      ? "Firebase 已連線"
      : "Firebase 連線中";
  const description = !status.configured
    ? "請先檢查 src/firebase-config.js；若要本機 Debug Token，請使用 local-admin/firebase-config.local.js。"
    : ready
      ? "已啟用匿名登入與房間即時同步。"
      : "正在建立匿名登入與資料庫連線。";
  const authLabel = status.authReady ? "匿名登入：已就緒" : "匿名登入：連線中";
  const appCheckLabel = getAppCheckStatusLabel(status);

  elements.createRoomButton.disabled = !ready;
  elements.joinRoomButton.disabled = !ready;
  elements.firebaseStatus.innerHTML = `
    <div class="status-card ${ready ? "status-ready" : "status-warn"}">
      <span class="status-dot"></span>
      <div>
        <strong>${title}</strong>
        <p>${description}</p>
        <div class="pill-row">
          <span class="pill">${authLabel}</span>
          <span class="pill">${appCheckLabel}</span>
        </div>
        ${
          status.configured
            ? `<p>${escapeHtml(status.appCheckMessage || "App Check 尚未設定。")}</p>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderRoomPanelLegacy() {
  const room = appState.room;
  if (!room) {
    elements.roomPanel.innerHTML = `
      <div class="panel-head">
        <h2>${appState.selectedMode === GAME_MODE_SOLO ? "單人模式" : "房間"}</h2>
        <p>${appState.selectedMode === GAME_MODE_SOLO ? "設定規則後即可開始單人對局。" : "建立或加入房間後即可開始。"}</p>
      </div>
      <div class="empty-state">
        <p>${appState.selectedMode === GAME_MODE_SOLO ? "尚未開始單人對局。" : "尚未加入房間。"}</p>
      </div>
    `;
    return;
  }

  const players = getPlayers(room);
  const currentPlayer = getCurrentPlayer(room);
  const isHost = controller.isHost();
  const game = room.game || null;
  const isSoloMode = isSoloRoom(room);
  const canStart = players.length === 2 && (!game || game.status !== "playing");
  const currentRuleset = getRuleset(room.rulesetId || (game && game.rulesetId) || DEFAULT_RULESET);
  const startLabel = game && game.status === "finished" ? "重新開局" : "開始對局";
  const currentPlayerId = currentPlayer ? currentPlayer.id : "";
  const currentPlayerSeat = currentPlayer ? currentPlayer.seat : 0;

  elements.roomPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${isSoloMode ? "單人對電腦" : `房間 ${escapeHtml(room.roomId)}`}</h2>
        <p>${escapeHtml(currentRuleset.description)}</p>
      </div>
      <div class="room-actions">
        ${isSoloMode ? "" : `<button class="ghost-button" data-room-action="copy-link">複製邀請連結</button>`}
        ${
          !isSoloMode && isHost
            ? `
              <label class="field room-inline-field">
                <span>規則</span>
                <select id="room-ruleset-select">
                  <option value="full136" ${currentRuleset.id === "full136" ? "selected" : ""}>雙人全牌 136 張</option>
                  <option value="classic64" ${currentRuleset.id === "classic64" ? "selected" : ""}>雙人經典 64 張</option>
                </select>
              </label>
              <button class="primary-button" data-room-action="start-game" ${canStart ? "" : "disabled"}>${startLabel}</button>
            `
            : ""
        }
      </div>
    </div>
    <div class="room-grid">
      <div class="room-card">
        <h3>玩家</h3>
        <div class="seat-list">
          ${[0, 1]
            .map((seat) =>
              renderSeatCard(players.find((player) => player.seat === seat), currentPlayerId, room.hostPlayerId, game),
            )
            .join("")}
        </div>
      </div>
      <div class="room-card">
        <h3>牌局狀態</h3>
        <p class="phase-copy">${escapeHtml(describeGamePhase(game, currentPlayerSeat, room))}</p>
        <div class="pill-row">
          ${isSoloMode ? `<span class="pill">模式：單人對電腦</span>` : ""}
          ${isSoloMode ? `<span class="pill">難度：${escapeHtml(SOLO_DIFFICULTY_LABELS[room.meta && room.meta.soloDifficulty] || SOLO_DIFFICULTY_LABELS[DEFAULT_SOLO_DIFFICULTY])}</span>` : ""}
          <span class="pill">規則：${escapeHtml(currentRuleset.name)}</span>
          <span class="pill">局數：${game && game.roundNumber != null ? game.roundNumber : 0}</span>
          <span class="pill">牌牆：${game && game.wall ? game.wall.length : 0}</span>
          <span class="pill">莊家：${renderSeatLabel(game, game ? game.dealerSeat : null)}</span>
          <span class="pill">輪到：${renderSeatLabel(game, game ? game.turnSeat : null)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderGamePanel() {
  const room = appState.room;
  if (!room) {
    elements.gamePanel.innerHTML = `
      <div class="panel-head">
        <h2>牌桌</h2>
        <p>${appState.selectedMode === GAME_MODE_SOLO ? "開始單人遊戲後會顯示牌桌。" : "加入房間後會顯示牌桌。"}</p>
      </div>
    `;
    return;
  }

  const players = getPlayers(room);
  const currentPlayer = getCurrentPlayer(room);
  if (!currentPlayer) {
    elements.gamePanel.innerHTML = `
      <div class="panel-head">
        <h2>牌桌</h2>
        <p>正在等待這台裝置加入房間。</p>
      </div>
    `;
    return;
  }

  const seat = currentPlayer.seat;
  const opponent = players.find((player) => player.seat !== seat);
  const game = room.game;
  const showOpponentHand = Boolean(room.meta && room.meta.godViewEnabled && room.hostPlayerId === currentPlayer.id);
  const opponentSeat = opponent ? opponent.seat : 0;
  const selfRoundState = game && game.players && game.players[seat] ? game.players[seat] : { hand: [], melds: [], discards: [] };
  const opponentRoundState =
    game && game.players && game.players[opponentSeat] ? game.players[opponentSeat] : { hand: [], melds: [], discards: [] };
  const clientState = getPlayerClientState(game, seat);
  triggerAutoDrawIfNeeded(game, seat, clientState);
  const drawReveal = getDrawRevealState(game, seat, selfRoundState);
  const resultOverlay = renderResultOverlay(game, players);
  const fullscreenLabel = isFullscreenActive() ? "離開全螢幕" : "全螢幕顯示";
  const focusStatus = canUseFullscreenApi() ? "牌桌已放大顯示" : "已啟用牌桌專注模式";

  elements.gamePanel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>牌桌</h2>
        <p>${escapeHtml(describeGamePhase(game, seat, room))}</p>
      </div>
        <div class="game-head-actions">
          <div class="pill-row">
            <span class="pill">你的位置：${renderSeatLabel(game, seat)}</span>
            <span class="pill">莊家：${renderSeatLabel(game, game ? game.dealerSeat : null)}</span>
            <span class="pill">${getTurnBadge(game, seat)}</span>
            ${isScoringEnabled(game) ? '<span class="pill">統計：胡牌數（分數）</span>' : ""}
          </div>
        <span class="focus-note">${focusStatus}</span>
        <button class="ghost-button focus-toggle" type="button" data-ui-action="toggle-fullscreen">${fullscreenLabel}</button>
      </div>
    </div>
    <div class="table-stage ${game && game.result ? "has-result" : ""}">
      <div class="table-shell">
        <section class="table-side table-opponent">
          <div class="side-head">
            <h3>${escapeHtml(opponent ? opponent.name : "等待中")}${renderScoreBadge(game, opponent ? opponent.seat : null)}</h3>
            <span>${opponent ? `手牌 ${opponentRoundState.hand.length} 張` : "尚未入座"}</span>
          </div>
          ${renderOpponentRack(opponentRoundState.hand.length, opponentRoundState.melds, {
            revealHand: showOpponentHand,
            handTiles: opponentRoundState.hand,
          })}
        </section>
        <section class="table-center">
          <div class="center-block center-block-latest">
            <span class="center-label">最新打出的牌</span>
            <div class="latest-discard">${renderSingleTile(game && game.latestDiscard ? game.latestDiscard.tileId : null, false) || "<span class=\"placeholder\">目前沒有</span>"}</div>
          </div>
          ${renderCenterDiscards({
            selfName: currentPlayer.name,
            opponentName: opponent ? opponent.name : "對家",
            selfDiscards: selfRoundState.discards,
            opponentDiscards: opponentRoundState.discards,
          })}
          <div class="center-block center-block-actions">
            <span class="center-label">可用操作</span>
            <div class="action-grid">
              ${renderActionButtons(clientState)}
            </div>
          </div>
        </section>
        <section class="table-side table-self">
        <div class="side-head side-head-self">
          <h3>${escapeHtml(currentPlayer.name)}${renderScoreBadge(game, currentPlayer.seat)}</h3>
          <div class="self-head-melds">
            ${renderMelds(selfRoundState.melds, { showEmpty: false, compact: true, singleLine: true })}
          </div>
          <span class="self-head-status">${getSelfStatusText(clientState, game, seat, room)}</span>
        </div>
          ${renderSelfHand(selfRoundState.hand, clientState, drawReveal)}
        </section>
      </div>
      ${resultOverlay}
    </div>
  `;
}

function renderSeatCard(player, currentPlayerId, hostPlayerId, game) {
  if (!player) {
    return `
      <div class="seat-card seat-empty">
        <strong>空位</strong>
        <span>等待玩家加入</span>
      </div>
    `;
  }

  const badges = [
    player.id === hostPlayerId ? "房主" : "",
    player.id === currentPlayerId ? "你" : "",
    player.type === "bot" ? "電腦" : "",
  ].filter(Boolean);

  return `
    <div class="seat-card">
      <strong>${escapeHtml(player.name)}${renderScoreBadge(game, player.seat)}</strong>
      <span>${formatSeat(player.seat)}</span>
      <div class="pill-row">
        ${badges.map((badge) => `<span class="pill">${badge}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderResultOverlayLegacy(game, players) {
  if (!game || !game.result) {
    return "";
  }

  const isDraw = game.result.winKind === "draw";
  const winKindLabel =
    game.result.winKind === "selfDraw"
      ? "自摸"
      : game.result.winKind === "robKong"
        ? "搶槓胡"
        : "胡牌";
  const winnerName = getPlayerDisplayName(players, game.result.winnerSeat);
  const detail = isDraw ? game.result.message || "本局流局。" : `牌型：${((game.result.patterns || []).join("、")) || "標準胡牌"}`;
  const winningTile = !isDraw && game.result.winningTileId ? renderSingleTile(game.result.winningTileId, false) : "";
  const fullHand = !isDraw ? renderResultHand(game) : "";

  return `
    <div class="result-overlay">
      <div class="result-overlay-backdrop"></div>
      <div class="result-card">
        <span class="result-eyebrow">${isDraw ? "本局結果" : "胡牌結果"}</span>
        ${
          isDraw
            ? `<h3 class="result-title">流局</h3>`
            : `
              <div class="result-kind">${winKindLabel}</div>
              <h3 class="result-title">${escapeHtml(winnerName)}</h3>
            `
        }
        ${
          winningTile
            ? `
              <div class="result-winning-tile">
                ${winningTile}
              </div>
            `
            : ""
        }
        ${fullHand}
        <p class="result-patterns">${escapeHtml(detail)}</p>
        <div class="result-actions result-actions-centered">
          <button class="primary-button result-action-button" type="button" data-command="restartGame">繼續遊戲</button>
          <button class="ghost-button result-action-button" type="button" data-ui-action="leave-room">離開遊戲</button>
        </div>
      </div>
    </div>
  `;
}

function renderResultHandLegacy(game) {
  const result = game && game.result ? game.result : null;
  if (!result || typeof result.winnerSeat !== "number") {
    return "";
  }

  const winnerState =
    game && Array.isArray(game.players)
      ? game.players.find((player) => player && player.seat === result.winnerSeat) || game.players[result.winnerSeat]
      : null;
  if (!winnerState) {
    return "";
  }

  const concealedTiles = Array.isArray(winnerState.hand) ? [...winnerState.hand] : [];
  if (result.winningTileId && !concealedTiles.includes(result.winningTileId)) {
    concealedTiles.push(result.winningTileId);
  }

  const sortedConcealedTiles = sortTileIds(concealedTiles);
  const melds = Array.isArray(winnerState.melds) ? winnerState.melds : [];

  return `
    <div class="result-hand-panel">
      <span class="result-hand-label">完整牌型</span>
      <div class="result-hand-groups">
        ${melds.map((meld) => renderResultHandGroup(getMeldLabel(meld.type), meld.tiles)).join("")}
        ${renderResultHandGroup(melds.length ? "手牌" : "完整牌型", sortedConcealedTiles)}
      </div>
    </div>
  `;
}

function renderResultHandGroup(label, tileIds = []) {
  if (!tileIds.length) {
    return "";
  }

  return `
    <div class="result-hand-group">
      <span class="result-hand-tag">${escapeHtml(label)}</span>
      <div class="result-hand-tiles">
        ${tileIds.map((tileId) => renderSingleTile(tileId, false)).join("")}
      </div>
    </div>
  `;
}

function renderOpponentRack(handCount, melds = [], options = {}) {
  const { revealHand = false, handTiles = [] } = options;
  return `
    <div class="opponent-rack">
      ${renderMelds(melds, { showEmpty: false, compact: true, singleLine: true })}
      ${revealHand ? renderVisibleHand(handTiles, "visible-hand-inline") : renderHiddenHand(handCount, "hidden-hand-inline")}
    </div>
  `;
}

function renderHiddenHand(count, extraClass = "") {
  const backs = Array.from({ length: count }, () => "<div class=\"tile tile-back\"></div>").join("");
  const className = ["hidden-hand", extraClass].filter(Boolean).join(" ");
  return `<div class="${className}">${backs}</div>`;
}

function renderVisibleHand(tileIds = [], extraClass = "") {
  const className = ["visible-hand", extraClass].filter(Boolean).join(" ");
  return `<div class="${className}">${tileIds.map((tileId) => renderSingleTile(tileId, false)).join("")}</div>`;
}

function renderMelds(melds = [], options = {}) {
  const { showEmpty = true, compact = false, singleLine = false } = options;
  if (!melds.length) {
    return showEmpty ? `<div class="meld-strip empty-strip">沒有吃、碰、槓</div>` : "";
  }

  return `
    <div class="meld-strip ${compact ? "meld-strip-compact" : ""} ${singleLine ? "meld-strip-inline" : ""}">
      ${melds
        .map(
          (meld) => `
            <div class="meld-group ${compact ? "meld-group-compact" : ""}">
              <span class="meld-tag">${getMeldLabel(meld.type)}</span>
              <div class="meld-tiles">${meld.tiles.map((tileId) => renderSingleTile(tileId, false)).join("")}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDiscards(discards = []) {
  return `
    <div class="discard-strip">
      ${discards
        .map(
          (discard) => `
            <div class="discard-item ${discard.claimed ? "discard-claimed" : ""}">
              ${renderSingleTile(discard.tileId, false)}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCenterDiscards({ selfName, opponentName, selfDiscards, opponentDiscards }) {
  return `
    <div class="center-block center-block-discards">
      <span class="center-label">打出的牌</span>
      <div class="center-discard-board">
        <div class="center-discard-viewport">
          <div class="center-discard-content">
            ${renderCenterDiscardRow(opponentName, opponentDiscards)}
            ${renderCenterDiscardRow(selfName, selfDiscards)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCenterDiscardRow(label, discards = []) {
  const discardMarkup = discards.length
    ? [...discards]
        .reverse()
        .map(
          (discard) => `
            <div class="discard-item ${discard.claimed ? "discard-claimed" : ""}">
              ${renderSingleTile(discard.tileId, false)}
            </div>
          `,
        )
        .join("")
    : `<span class="placeholder">尚未打牌</span>`;

  return `
    <div class="center-discard-row">
      <span class="discard-row-label">${escapeHtml(label)}</span>
      <div class="discard-line">
        ${discardMarkup}
      </div>
    </div>
  `;
}

function renderSelfHand(hand, clientState, drawReveal) {
  const revealTileId = drawReveal ? drawReveal.tileId : "";
  let skippedRevealTile = false;
  const visibleHand = [];

  for (const tileId of hand || []) {
    if (tileId === revealTileId && !skippedRevealTile) {
      skippedRevealTile = true;
      continue;
    }
    visibleHand.push(tileId);
  }

  return `
    <div class="self-hand-row ${drawReveal ? "has-drawn-tile" : ""}">
      <div class="hand-grid">
        ${visibleHand
          .map((tileId) => renderSingleTile(tileId, clientState.canDiscard, { command: "discardTile", tileId }))
          .join("")}
      </div>
      ${
        drawReveal
          ? `
            <div class="drawn-tile-slot ${drawReveal.isGracePeriod ? "is-grace-period" : ""}">
              ${renderSingleTile(drawReveal.tileId, clientState.canDiscard, {
                command: "discardTile",
                tileId: drawReveal.tileId,
              })}
              ${
                drawReveal.countdownLabel
                  ? `<span class="draw-countdown">${drawReveal.countdownLabel}</span>`
                  : ""
              }
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderActionButtons(clientState) {
  const buttons = [];

  if (clientState.canDraw) {
    buttons.push(`<button class="action-button" data-command="drawTile">摸牌</button>`);
  }

  if (clientState.canSelfDraw) {
    buttons.push(`<button class="action-button action-emphasis" data-command="declareSelfDraw">自摸</button>`);
  }

  for (const tileType of clientState.concealedKongs) {
    buttons.push(`
      <button class="action-button" data-command="concealedKong" data-tile-type="${tileType}">
        暗槓 ${escapeHtml(getTileDisplayName(tileType))}
      </button>
    `);
  }

  for (const option of clientState.addedKongs) {
    buttons.push(`
      <button class="action-button" data-command="addedKong" data-meld-id="${option.meldId}" data-tile-id="${option.tileId}">
        加槓 ${escapeHtml(getTileDisplayName(option.tileType))}
      </button>
    `);
  }

  for (const option of clientState.claimOptions) {
    buttons.push(`
      <button
        class="action-button ${option.type === "claimWin" ? "action-emphasis" : ""}"
        data-command="${option.type}"
        ${option.neededTypes ? `data-needed-types="${option.neededTypes.join("|")}"` : ""}
      >
        ${option.label}
      </button>
    `);
  }

  return buttons.length ? buttons.join("") : `<span class="placeholder">${getIdleActionText(clientState)}</span>`;
}

function renderSingleTile(tileId, clickable, payload = null) {
  if (!tileId) {
    return "";
  }

  const tileType = getTileType(tileId);
  const tileTheme = getTileThemeClass(tileType);
  const buttonAttrs =
    clickable && payload
      ? `type="button" data-command="${payload.command}" data-tile-id="${payload.tileId}" aria-label="打出 ${escapeHtml(getTileDisplayName(tileType))}"`
      : `type="button" disabled`;

  return `
    <button class="tile tile-faceup ${tileTheme} ${clickable ? "tile-clickable" : ""}" ${buttonAttrs}>
      <span class="tile-face">
        ${renderTileArt(tileType)}
      </span>
    </button>
  `;
}

function readCommandPayload(element) {
  return stripUndefined({
    tileId: element.dataset.tileId,
    tileType: element.dataset.tileType,
    meldId: element.dataset.meldId ? Number(element.dataset.meldId) : undefined,
    neededTypes: element.dataset.neededTypes ? element.dataset.neededTypes.split("|") : undefined,
  });
}

function getPlayers(room) {
  if (room && Array.isArray(room.activePlayers) && room.activePlayers.length) {
    return room.activePlayers;
  }
  return Object.values(room.players || {}).sort((left, right) => left.seat - right.seat);
}

function isSoloRoom(room) {
  return Boolean(room && ((room.meta && room.meta.gameMode === GAME_MODE_SOLO) || room.gameMode === GAME_MODE_SOLO));
}

function getCurrentPlayer(room) {
  const { playerId } = controller.getIdentity();
  return getPlayers(room).find((player) => player.id === playerId);
}

function getPlayerDisplayName(players, seat) {
  if (typeof seat !== "number") {
    return "-";
  }
  const player = (players || []).find((item) => item && item.seat === seat);
  if (!player) {
    return formatSeat(seat);
  }
  return player.name || player.id || formatSeat(seat);
}

function triggerAutoDrawIfNeeded(game, playerSeat, clientState) {
  if (!game || !clientState.canDraw) {
    return;
  }

  const roomId = appState.room && appState.room.roomId ? appState.room.roomId : "";
  const wallCount = game.wall ? game.wall.length : 0;
  const key = `${roomId}:${game.roundNumber}:${playerSeat}:${wallCount}`;
  if (appState.autoDrawKey === key) {
    return;
  }

  appState.autoDrawKey = key;
  window.setTimeout(async () => {
    try {
      await controller.sendGameCommand("drawTile", {});
    } catch (error) {
      appState.error = error.message;
      render();
    }
  }, 0);
}

function getDrawRevealState(game, playerSeat, playerRoundState) {
  const lastDraw = game && game.lastDraw ? game.lastDraw : null;
  const hand = playerRoundState && Array.isArray(playerRoundState.hand) ? playerRoundState.hand : [];
  const drawRevealSeconds = normalizeDrawRevealSecondsValue(game && game.drawRevealSeconds);

  if (
    !lastDraw ||
    lastDraw.initial ||
    lastDraw.seat !== playerSeat ||
    !hand.includes(lastDraw.tileId) ||
    !game ||
    game.phase !== "discard" ||
    drawRevealSeconds <= 0
  ) {
    clearDrawRevealState();
    return null;
  }

  const roomId = appState.room && appState.room.roomId ? appState.room.roomId : "";
  const key = `${roomId}:${game.roundNumber}:${lastDraw.seat}:${lastDraw.tileId}:${lastDraw.source || ""}`;
  const now = Date.now();

  if (appState.drawRevealCompletedKey === key) {
    return null;
  }

  if (appState.drawRevealKey !== key) {
    appState.drawRevealKey = key;
    appState.drawRevealEndsAt = now + drawRevealSeconds * 1000;
  }

  const remainingMs = appState.drawRevealEndsAt - now;
  if (remainingMs <= -DRAW_REVEAL_GRACE_MS) {
    appState.drawRevealCompletedKey = key;
    clearDrawRevealState();
    return null;
  }

  const visibleRemainingMs = Math.max(0, remainingMs);
  scheduleCountdownRender(getNextDrawRevealRenderDelay(remainingMs));

  return {
    tileId: lastDraw.tileId,
    countdownLabel: formatDrawRevealCountdown(visibleRemainingMs),
    isGracePeriod: remainingMs <= 0,
  };
}

function clearDrawRevealState() {
  appState.drawRevealKey = "";
  appState.drawRevealEndsAt = 0;
  if (appState.countdownTimer) {
    window.clearTimeout(appState.countdownTimer);
    appState.countdownTimer = 0;
  }
}

function scheduleCountdownRender(delay) {
  if (appState.countdownTimer) {
    window.clearTimeout(appState.countdownTimer);
  }

  appState.countdownTimer = window.setTimeout(() => {
    appState.countdownTimer = 0;
    render();
  }, Math.max(16, delay));
}

function getNextDrawRevealRenderDelay(remainingMs) {
  if (remainingMs <= 0) {
    return DRAW_REVEAL_GRACE_MS + remainingMs;
  }

  if (remainingMs > 1000) {
    const currentSecond = Math.ceil(remainingMs / 1000);
    return remainingMs - (currentSecond - 1) * 1000;
  }

  const currentTenth = Math.max(1, Math.floor(remainingMs / DRAW_REVEAL_FINAL_STEP_MS));
  return remainingMs - (currentTenth * DRAW_REVEAL_FINAL_STEP_MS - 1);
}

function formatDrawRevealCountdown(remainingMs) {
  if (remainingMs <= 0) {
    return "";
  }

  if (remainingMs > 1000) {
    return String(Math.ceil(remainingMs / 1000));
  }

  const tenths = Math.max(1, Math.floor(remainingMs / DRAW_REVEAL_FINAL_STEP_MS));
  return (tenths / 10).toFixed(1);
}

function readCreateDrawRevealSeconds() {
  return normalizeDrawRevealSecondsValue(
    elements.createDrawRevealSecondsSelect ? elements.createDrawRevealSecondsSelect.value : DEFAULT_DRAW_REVEAL_SECONDS,
  );
}

function readCreateScoringEnabled() {
  return normalizeScoringEnabled(
    elements.createScoringEnabledSelect ? elements.createScoringEnabledSelect.value : DEFAULT_SCORING_ENABLED,
  );
}

function normalizeDrawRevealSecondsValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DRAW_REVEAL_SECONDS;
  }

  return Math.min(6, Math.max(0, Math.round(parsed)));
}

function formatDrawRevealSetting(value) {
  const seconds = normalizeDrawRevealSecondsValue(value);
  return seconds <= 0 ? "不倒數" : `${seconds} 秒`;
}

function formatSeat(seat) {
  return typeof seat === "number" ? `P${seat + 1}` : "-";
}

function renderSeatLabelLegacy(game, seat) {
  return `${formatSeat(seat)}${renderScoreBadge(game, seat)}`;
}

function renderScoreBadgeLegacy(game, seat) {
  const score = getSeatScore(game, seat);
  return score > 0 ? `<span class="score-badge">+${score}</span>` : "";
}

function getSeatScoreLegacy(game, seat) {
  if (!game || !Array.isArray(game.scores) || typeof seat !== "number") {
    return 0;
  }

  const score = Number(game.scores[seat]);
  return Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
}

function getTurnBadge(game, playerSeat) {
  if (!game || game.status !== "playing") {
    return "輪到：-";
  }
  return game.turnSeat === playerSeat ? "輪到：你" : `輪到：${renderSeatLabel(game, game.turnSeat)}`;
}

function getSelfStatusText(clientState, game, playerSeat, room = null) {
  if (clientState.canDiscard) {
    return "輪到你打牌";
  }
  if (clientState.canDraw) {
    return "輪到你摸牌";
  }
  if (hasSelectableActions(clientState)) {
    return "請點選可用操作";
  }
  if (isSoloRoom(room) && room.meta && room.meta.botThinking) {
    return "等待電腦思考";
  }
  if (game && game.status === "playing") {
    return game.turnSeat === playerSeat ? "輪到你操作" : "等待對手";
  }
  return "等待中";
}

function getIdleActionText(clientState) {
  if (clientState.canDraw) {
    return "請先摸牌";
  }
  if (clientState.canDiscard) {
    return "請點一張牌打出";
  }
  return "等待對手操作";
}

function hasSelectableActions(clientState) {
  if (!clientState) {
    return false;
  }

  return Boolean(
    clientState.canSelfDraw ||
      (Array.isArray(clientState.concealedKongs) && clientState.concealedKongs.length) ||
      (Array.isArray(clientState.addedKongs) && clientState.addedKongs.length) ||
      (Array.isArray(clientState.claimOptions) && clientState.claimOptions.length),
  );
}

function getMeldLabel(type) {
  if (type === "chow") {
    return "吃";
  }
  if (type === "pung") {
    return "碰";
  }
  if (type === "kong") {
    return "槓";
  }
  return type;
}

function describeGamePhase(game, playerSeat, room = null) {
  if (!game) {
    return isSoloRoom(room) ? "按下開始單人遊戲後即可直接對局。" : "房間已建立，等待開始對局。";
  }

  if (game.status === "waiting") {
    return isSoloRoom(room) ? "單人模式準備中。" : "兩位玩家都進房後，按下開始對局。";
  }

  if (game.status === "finished") {
    return game && game.result && game.result.message ? game.result.message : "本局已結束，可以重新開局。";
  }

  if (isSoloRoom(room) && room.meta && room.meta.botThinking) {
    return "電腦思考中...";
  }

  if (game.phase === "draw") {
    return game.turnSeat === playerSeat ? "輪到你摸牌。" : isSoloRoom(room) ? "等待電腦摸牌。" : "等待對手摸牌。";
  }

  if (game.phase === "discard") {
    return game.turnSeat === playerSeat
      ? "輪到你出牌，請點一張手牌。"
      : isSoloRoom(room)
        ? "等待電腦出牌。"
        : "等待對手出牌。";
  }

  if (game.phase === "response") {
    return game.pendingClaim && game.pendingClaim.toSeat === playerSeat
      ? "你可以對這張牌進行吃、碰、槓或胡。"
      : isSoloRoom(room)
        ? "等待電腦回應。"
        : "等待對手回應。";
  }

  if (game.phase === "robKong") {
    return game.pendingClaim && game.pendingClaim.toSeat === playerSeat
      ? "你可以搶槓胡。"
      : isSoloRoom(room)
        ? "等待電腦決定是否搶槓。"
        : "等待搶槓胡回應。";
  }

  return "對局進行中。";
}

function renderRoomPanel() {
  const room = appState.room;
  if (!room) {
    elements.roomPanel.innerHTML = `
      <div class="panel-head">
        <h2>${appState.selectedMode === GAME_MODE_SOLO ? "單人設定" : "房間資訊"}</h2>
        <p>${appState.selectedMode === GAME_MODE_SOLO ? "選好規則、難度與台數計算後，即可開始單人對電腦。" : "建立房間或加入房間後，這裡會顯示目前對局資訊。"}</p>
      </div>
      <div class="empty-state">
        <p>${appState.selectedMode === GAME_MODE_SOLO ? "開始單人遊戲後，這裡會顯示目前對局狀態。" : "建立或加入房間後，這裡會顯示目前房間狀態。"}</p>
      </div>
    `;
    return;
  }

  const players = getPlayers(room);
  const currentPlayer = getCurrentPlayer(room);
  const isHost = controller.isHost();
  const game = room.game || null;
  const isSoloMode = isSoloRoom(room);
  const canStart = players.length === 2 && (!game || game.status !== "playing");
  const currentRuleset = getRuleset(room.rulesetId || (game && game.rulesetId) || DEFAULT_RULESET);
  const startLabel = game && game.status === "finished" ? "重新開始" : "開始對局";
  const currentPlayerId = currentPlayer ? currentPlayer.id : "";
  const currentPlayerSeat = currentPlayer ? currentPlayer.seat : 0;
  const scoringStatus = isScoringEnabled(game) ? "開啟" : "關閉";

  elements.roomPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${isSoloMode ? "單人對局" : `房間 ${escapeHtml(room.roomId)}`}</h2>
        <p>${escapeHtml(currentRuleset.description)}</p>
      </div>
      <div class="room-actions">
        ${isSoloMode ? "" : `<button class="ghost-button" data-room-action="copy-link">複製邀請連結</button>`}
        ${
          !isSoloMode && isHost
            ? `
              <label class="field room-inline-field">
                <span>規則</span>
                <select id="room-ruleset-select">
                  <option value="full136" ${currentRuleset.id === "full136" ? "selected" : ""}>雙人全牌 136 張</option>
                  <option value="classic64" ${currentRuleset.id === "classic64" ? "selected" : ""}>雙人精簡 64 張</option>
                </select>
              </label>
              <button class="primary-button" data-room-action="start-game" ${canStart ? "" : "disabled"}>${escapeHtml(startLabel)}</button>
            `
            : ""
        }
      </div>
    </div>
    <div class="room-grid">
      <div class="room-card">
        <h3>玩家</h3>
        <div class="seat-list">
          ${[0, 1]
            .map((seat) =>
              renderSeatCard(players.find((player) => player.seat === seat), currentPlayerId, room.hostPlayerId, game),
            )
            .join("")}
        </div>
      </div>
      <div class="room-card">
        <h3>對局資訊</h3>
        <p class="phase-copy">${escapeHtml(describeGamePhase(game, currentPlayerSeat, room))}</p>
        <div class="pill-row">
          ${isSoloMode ? `<span class="pill">模式：單人對電腦</span>` : ""}
          ${isSoloMode ? `<span class="pill">難度：${escapeHtml(SOLO_DIFFICULTY_LABELS[room.meta && room.meta.soloDifficulty] || SOLO_DIFFICULTY_LABELS[DEFAULT_SOLO_DIFFICULTY])}</span>` : ""}
          <span class="pill">規則：${escapeHtml(currentRuleset.name)}</span>
          <span class="pill">台數計算：${scoringStatus}</span>
          ${isScoringEnabled(game) ? '<span class="pill">統計：胡牌數（分數）</span>' : ""}
          <span class="pill">第 ${game && game.roundNumber != null ? game.roundNumber : 0} 局</span>
          <span class="pill">牌牆：${game && game.wall ? game.wall.length : 0}</span>
          <span class="pill">莊家：${renderSeatLabel(game, game ? game.dealerSeat : null)}</span>
          <span class="pill">輪到：${renderSeatLabel(game, game ? game.turnSeat : null)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderResultOverlayLegacyScoring(game, players) {
  if (!game || !game.result) {
    return "";
  }

  const isDraw = game.result.winKind === "draw";
  const winKindLabel =
    game.result.winKind === "selfDraw"
      ? "自摸"
      : game.result.winKind === "robKong"
        ? "搶槓胡"
        : "胡牌";
  const winnerName = getPlayerDisplayName(players, game.result.winnerSeat);
  const patternText = ((game.result.patterns || []).join("、")) || "未記錄牌型";
  const detail = isDraw ? game.result.message || "本局流局。" : `牌型：${patternText}`;
  const winningTile = !isDraw && game.result.winningTileId ? renderSingleTile(game.result.winningTileId, false) : "";
  const fullHand = !isDraw ? renderResultHand(game) : "";
  const scoringSummary = !isDraw ? renderResultScoring(game.result) : "";

  return `
    <div class="result-overlay">
      <div class="result-overlay-backdrop"></div>
      <div class="result-card">
        <span class="result-eyebrow">${isDraw ? "對局結果" : "胡牌結果"}</span>
        ${
          isDraw
            ? `<h3 class="result-title">流局</h3>`
            : `
              <div class="result-kind">${winKindLabel}</div>
              <h3 class="result-title">${escapeHtml(winnerName)}</h3>
            `
        }
        ${
          winningTile
            ? `
              <div class="result-winning-tile">
                ${winningTile}
              </div>
            `
            : ""
        }
        ${fullHand}
        ${scoringSummary}
        <p class="result-patterns">${escapeHtml(detail)}</p>
        <div class="result-actions result-actions-centered">
          <button class="primary-button result-action-button" type="button" data-command="restartGame">繼續遊戲</button>
          <button class="ghost-button result-action-button" type="button" data-ui-action="leave-room">離開遊戲</button>
        </div>
      </div>
    </div>
  `;
}

function renderResultOverlay(game, players) {
  if (!game || !game.result) {
    return "";
  }

  const isDraw = game.result.winKind === "draw";
  const winKindLabel =
    game.result.winKind === "selfDraw"
      ? "自摸"
      : game.result.winKind === "robKong"
        ? "搶槓"
        : "胡牌";
  const winnerName = getPlayerDisplayName(players, game.result.winnerSeat);
  const patternText = getResultPatternText(game.result);
  const detail = isDraw ? game.result.message || "本局流局。" : `牌型：${patternText}`;
  const winningTile = !isDraw && game.result.winningTileId ? renderSingleTile(game.result.winningTileId, false) : "";
  const fullHand = !isDraw ? renderResultHand(game) : "";
  const scoringSummary = !isDraw ? renderResultScoring(game.result) : "";

  return `
    <div class="result-overlay">
      <div class="result-overlay-backdrop"></div>
      <div class="result-card">
        <span class="result-eyebrow">${isDraw ? "對局結果" : "胡牌結果"}</span>
        ${
          isDraw
            ? `<h3 class="result-title">流局</h3>`
            : `
              <div class="result-kind">${winKindLabel}</div>
              <h3 class="result-title">${escapeHtml(winnerName)}</h3>
            `
        }
        ${
          winningTile
            ? `
              <div class="result-winning-tile">
                ${winningTile}
              </div>
            `
            : ""
        }
        ${fullHand}
        ${scoringSummary}
        <p class="result-patterns">${escapeHtml(detail)}</p>
        <div class="result-actions result-actions-centered">
          <button class="primary-button result-action-button" type="button" data-command="restartGame">繼續遊戲</button>
          <button class="ghost-button result-action-button" type="button" data-ui-action="leave-room">離開遊戲</button>
        </div>
      </div>
    </div>
  `;
}

function getResultPatternText(result) {
  const patterns = Array.isArray(result && result.patterns) ? result.patterns.filter(Boolean) : [];
  if (patterns.length) {
    return patterns.join("、");
  }

  const taiBreakdown = Array.isArray(result && result.taiBreakdown)
    ? result.taiBreakdown.filter((item) => item && item.tai > 0 && item.label)
    : [];
  if (taiBreakdown.length === 1 && taiBreakdown[0].key === "baseWin") {
    return "基本胡";
  }
  if (taiBreakdown.length > 0) {
    return "標準胡牌";
  }

  return "標準胡牌";
}

function renderResultHand(game) {
  const result = game && game.result ? game.result : null;
  if (!result || typeof result.winnerSeat !== "number") {
    return "";
  }

  const winnerState =
    game && Array.isArray(game.players)
      ? game.players.find((player) => player && player.seat === result.winnerSeat) || game.players[result.winnerSeat]
      : null;
  if (!winnerState) {
    return "";
  }

  const concealedTiles = Array.isArray(winnerState.hand) ? [...winnerState.hand] : [];
  if (result.winningTileId && !concealedTiles.includes(result.winningTileId)) {
    concealedTiles.push(result.winningTileId);
  }

  const sortedConcealedTiles = sortTileIds(concealedTiles);
  const melds = Array.isArray(winnerState.melds) ? winnerState.melds : [];

  return `
    <div class="result-hand-panel">
      <span class="result-hand-label">完整牌型</span>
      <div class="result-hand-groups">
        ${melds.map((meld) => renderResultHandGroup(getMeldLabel(meld.type), meld.tiles)).join("")}
        ${renderResultHandGroup(melds.length ? "手牌" : "完整牌型", sortedConcealedTiles)}
      </div>
    </div>
  `;
}

function renderResultScoring(result) {
  if (!result || !result.scoringEnabled) {
    return "";
  }

  const taiBreakdown = Array.isArray(result.taiBreakdown) ? result.taiBreakdown.filter((item) => item && item.tai > 0) : [];
  return `
    <div class="result-score-panel">
      <span class="result-score-label">台數計算</span>
      <ul class="result-score-breakdown">
        ${
          taiBreakdown.length
            ? taiBreakdown
                .map(
                  (item) => `
                    <li>
                      <span>${escapeHtml(item.label)}</span>
                      <strong>${item.tai}台</strong>
                    </li>
                  `,
                )
                .join("")
            : `
              <li>
                <span>未達記分條件</span>
                <strong>0台</strong>
              </li>
            `
        }
      </ul>
      <div class="result-score-total">
        <span>總共 ${Math.max(0, Number(result.totalTai) || 0)} 台</span>
        <strong>總分 ${formatPointScore(Number(result.roundScore) || 0)}</strong>
      </div>
    </div>
  `;
}

function isScoringEnabled(game) {
  return Boolean(game && game.scoringEnabled);
}

function renderSeatLabel(game, seat) {
  return `${formatSeat(seat)}${renderScoreBadge(game, seat)}`;
}

function renderScoreBadge(game, seat) {
  if (typeof seat !== "number") {
    return "";
  }

  const wins = getSeatWinCount(game, seat);
  const scoringEnabled = isScoringEnabled(game);
  if (!scoringEnabled && wins <= 0) {
    return "";
  }

  const score = getSeatPointScore(game, seat);
  const pointText = scoringEnabled ? ` (${formatPointScore(score)})` : "";
  const label = scoringEnabled ? `胡牌數 ${wins}，累積分數 ${formatPointScore(score)}` : `胡牌數 ${wins}`;
  return `<span class="score-badge" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">+${wins}${pointText}</span>`;
}

function getSeatWinCount(game, seat) {
  if (!game || typeof seat !== "number") {
    return 0;
  }

  const winsSource = Array.isArray(game.wins) ? game.wins : Array.isArray(game.winCounts) ? game.winCounts : [];
  const wins = Number(winsSource[seat]);
  return Number.isFinite(wins) && wins > 0 ? Math.floor(wins) : 0;
}

function getSeatPointScore(game, seat) {
  if (!game || !Array.isArray(game.scores) || typeof seat !== "number") {
    return 0;
  }

  const score = Number(game.scores[seat]);
  return Number.isFinite(score) ? Math.round(score) : 0;
}

function formatPointScore(score) {
  return `${Math.round(Number(score) || 0)}`;
}

function updatePageMode() {
  document.body.classList.toggle("app-solo-mode", appState.selectedMode === GAME_MODE_SOLO);
  document.body.classList.toggle("app-game-focus", isGameFocused());
  document.body.classList.toggle("app-native-fullscreen", isFullscreenActive());
}

function isGameFocused() {
  return Boolean(appState.room && appState.room.game && ["playing", "finished"].includes(appState.room.game.status));
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function canUseFullscreenApi() {
  const root = document.documentElement;
  return typeof root.requestFullscreen === "function" || typeof root.webkitRequestFullscreen === "function";
}

async function handleUiAction(action) {
  appState.error = "";

  try {
    if (action === "toggle-fullscreen") {
      await toggleFullscreenMode();
    }
    if (action === "leave-room") {
      appState.message = "已離開遊戲。";
      clearDrawRevealState();
      controller.leaveRoom();
      clearShareLink();
      return;
    }
    render();
  } catch (error) {
    appState.error = error.message;
    render();
  }
}

async function toggleFullscreenMode() {
  if (isFullscreenActive()) {
    const exitFullscreen =
      (typeof document.exitFullscreen === "function" ? document.exitFullscreen.bind(document) : null) ||
      (typeof document.webkitExitFullscreen === "function" ? document.webkitExitFullscreen.bind(document) : null);
    if (exitFullscreen) {
      await exitFullscreen();
      appState.message = "已離開全螢幕。";
      return;
    }
  }

  const root = document.documentElement;
  const requestFullscreen =
    (typeof root.requestFullscreen === "function" ? root.requestFullscreen.bind(root) : null) ||
    (typeof root.webkitRequestFullscreen === "function" ? root.webkitRequestFullscreen.bind(root) : null);

  if (requestFullscreen) {
    await requestFullscreen();
    appState.message = "已進入全螢幕。";
    return;
  }

  appState.message = "這台裝置不支援原生全螢幕，已使用牌桌專注模式。";
}

function updateShareLink() {
  if (!appState.room || !appState.room.roomId) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("room", appState.room.roomId);
  history.replaceState(null, "", url.toString());
}

function clearShareLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  history.replaceState(null, "", url.toString());
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", appState.room && appState.room.roomId ? appState.room.roomId : "");
  return url.toString();
}

function getClosestTarget(event, selector) {
  const rawTarget = event.target;
  const elementTarget =
    rawTarget instanceof Element ? rawTarget : rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null;
  return elementTarget ? elementTarget.closest(selector) : null;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripUndefined(value) {
  return Object.entries(value).reduce((result, [key, item]) => {
    if (item !== undefined) {
      result[key] = item;
    }
    return result;
  }, {});
}

function normalizeGameMode(value) {
  return value === GAME_MODE_SOLO ? GAME_MODE_SOLO : GAME_MODE_ONLINE;
}

function applyDefaultSettingsMigration() {
  if (queryRoom) {
    return;
  }

  const defaultsVersion = readLocalSetting(DEFAULTS_VERSION_STORAGE_KEY);
  if (defaultsVersion === DEFAULTS_VERSION) {
    return;
  }

  const storedMode = normalizeGameMode(readLocalSetting(GAME_MODE_STORAGE_KEY) || GAME_MODE_SOLO);
  const storedDifficulty = normalizeSoloDifficulty(readLocalSetting(SOLO_DIFFICULTY_STORAGE_KEY));
  const storedScoringEnabled = normalizeScoringEnabled(readLocalSetting(SCORING_ENABLED_STORAGE_KEY));

  if (storedMode === GAME_MODE_ONLINE) {
    writeLocalSetting(GAME_MODE_STORAGE_KEY, GAME_MODE_SOLO);
  }

  if (storedDifficulty === "easy") {
    writeLocalSetting(SOLO_DIFFICULTY_STORAGE_KEY, DEFAULT_SOLO_DIFFICULTY);
  }

  if (!storedScoringEnabled) {
    writeLocalSetting(SCORING_ENABLED_STORAGE_KEY, String(DEFAULT_SCORING_ENABLED));
  }

  writeLocalSetting(DEFAULTS_VERSION_STORAGE_KEY, DEFAULTS_VERSION);
}

function readLocalSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeLocalSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Ignore Safari private mode write failures.
  }
}

function getTileDisplayName(tileType) {
  if (/^m[1-9]$/.test(tileType)) {
    return `${TILE_NUMBER_LABELS[Number(tileType[1])]}萬`;
  }
  if (/^p[1-9]$/.test(tileType)) {
    return `${TILE_NUMBER_LABELS[Number(tileType[1])]}筒`;
  }
  if (/^s[1-9]$/.test(tileType)) {
    return `${TILE_NUMBER_LABELS[Number(tileType[1])]}索`;
  }
  return HONOR_TILE_NAMES[tileType] || tileType;
}

function getTileGlyph(tileType) {
  if (/^m[1-9]$/.test(tileType)) {
    return String.fromCodePoint(0x1f006 + Number(tileType[1]));
  }
  if (/^s[1-9]$/.test(tileType)) {
    return String.fromCodePoint(0x1f00f + Number(tileType[1]));
  }
  if (/^p[1-9]$/.test(tileType)) {
    return String.fromCodePoint(0x1f018 + Number(tileType[1]));
  }
  return TILE_GLYPHS[tileType] || tileType;
}

function renderTileArt(tileType) {
  return getTileSvgMarkup(tileType);
}

function getAppCheckStatusLabel(status) {
  if (!status || !status.configured) {
    return "App Check：待設定";
  }

  if (!status.appCheckConfigured) {
    return "App Check：未填 site key";
  }

  if (status.appCheckEnabled) {
    return status.appCheckDebug ? "App Check：Debug Token" : "App Check：已啟用";
  }

  return "App Check：尚未啟用";
}

function getTileThemeClass(tileType) {
  if (tileType.startsWith("m")) {
    return "tile-theme-man";
  }
  if (tileType.startsWith("p")) {
    return "tile-theme-pin";
  }
  if (tileType.startsWith("s")) {
    return "tile-theme-sou";
  }
  if (tileType === "R") {
    return "tile-theme-dragon-red";
  }
  if (tileType === "G") {
    return "tile-theme-dragon-green";
  }
  if (tileType === "B") {
    return "tile-theme-dragon-white";
  }
  return "tile-theme-wind";
}
