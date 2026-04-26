import {
  buildDeck,
  canClaimDiscardKong,
  canClaimPung,
  evaluateWinningHand,
  getAddedKongOptions,
  getChowCombos,
  getConcealedKongTypes,
  getRuleset,
  getTileLabel,
  getTileType,
  getTilesByType,
  sortTileIds,
} from "./rules.js?v=20260425i";

export const DEFAULT_DRAW_REVEAL_SECONDS = 3;
const MIN_DRAW_REVEAL_SECONDS = 0;
const MAX_DRAW_REVEAL_SECONDS = 6;

function createRoundPlayer(seat) {
  return {
    seat,
    hand: [],
    melds: [],
    discards: [],
  };
}

export function normalizeRoundPlayer(player = {}, seat = 0) {
  return {
    seat: typeof player.seat === "number" ? player.seat : seat,
    hand: Array.isArray(player.hand) ? player.hand : [],
    melds: Array.isArray(player.melds) ? player.melds : [],
    discards: Array.isArray(player.discards) ? player.discards : [],
  };
}

export function normalizeGameState(game) {
  if (!game) {
    return null;
  }

  const normalizedPlayers = Array.from({ length: 2 }, (_, seat) =>
    normalizeRoundPlayer(
      Array.isArray(game.players)
        ? game.players.find((player) => player && player.seat === seat) || game.players[seat]
        : null,
      seat,
    ),
  );

  return {
    ...game,
    players: normalizedPlayers,
    drawRevealSeconds: normalizeDrawRevealSeconds(game.drawRevealSeconds),
    actionLog: Array.isArray(game.actionLog) ? game.actionLog : [],
    wall: Array.isArray(game.wall) ? game.wall : [],
    pendingClaim: game.pendingClaim || null,
    latestDiscard: game.latestDiscard || null,
    result: game.result || null,
    lastDraw: game.lastDraw || null,
    scores: normalizeScores(game.scores),
  };
}

export function normalizeDrawRevealSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DRAW_REVEAL_SECONDS;
  }

  return Math.min(MAX_DRAW_REVEAL_SECONDS, Math.max(MIN_DRAW_REVEAL_SECONDS, Math.round(parsed)));
}

export function createWaitingGame(rulesetId, options = {}) {
  const ruleset = getRuleset(rulesetId);
  const drawRevealSeconds = normalizeDrawRevealSeconds(
    typeof options === "number" ? options : options && options.drawRevealSeconds,
  );
  return {
    status: "waiting",
    phase: "waiting",
    rulesetId: ruleset.id,
    rulesetName: ruleset.name,
    drawRevealSeconds,
    players: [createRoundPlayer(0), createRoundPlayer(1)],
    actionLog: [`已建立房間，規則為「${ruleset.name}」。`],
    latestDiscard: null,
    pendingClaim: null,
    wall: [],
    dealerSeat: 0,
    turnSeat: 0,
    roundNumber: 0,
    nextDiscardId: 1,
    nextMeldId: 1,
    winnerSeat: null,
    result: null,
    lastDraw: null,
    scores: [0, 0],
  };
}

export function createStartedGame(rulesetId, previousGame, options = {}) {
  const ruleset = getRuleset(rulesetId);
  const deck = buildDeck(ruleset.id);
  const players = [createRoundPlayer(0), createRoundPlayer(1)];
  const drawRevealSeconds = normalizeDrawRevealSeconds(
    options && Object.prototype.hasOwnProperty.call(options, "drawRevealSeconds")
      ? options.drawRevealSeconds
      : previousGame && previousGame.drawRevealSeconds,
  );

  for (let drawCount = 0; drawCount < 13; drawCount += 1) {
    players[0].hand.push(deck.shift());
    players[1].hand.push(deck.shift());
  }

  players[0].hand = sortTileIds(players[0].hand);
  players[1].hand = sortTileIds(players[1].hand);

  const dealerSeat = 0;
  const dealerDraw = deck.shift();
  players[dealerSeat].hand = sortTileIds([...players[dealerSeat].hand, dealerDraw]);
  const scores = normalizeScores(previousGame && previousGame.scores);

  return {
    status: "playing",
    phase: "discard",
    rulesetId: ruleset.id,
    rulesetName: ruleset.name,
    drawRevealSeconds,
    players,
    actionLog: [`新的一局開始，${seatLabel(dealerSeat)}為莊家。`],
    latestDiscard: null,
    pendingClaim: null,
    wall: deck,
    dealerSeat,
    turnSeat: dealerSeat,
    roundNumber: ((previousGame && previousGame.roundNumber) || 0) + 1,
    nextDiscardId: 1,
    nextMeldId: 1,
    winnerSeat: null,
    result: null,
    scores,
    lastDraw: {
      seat: dealerSeat,
      tileId: dealerDraw,
      source: "live",
      initial: true,
    },
  };
}

export function applyGameCommand(gameState, command) {
  const game = cloneGame(normalizeGameState(gameState));
  const { playerSeat, type, payload = {} } = command;

  if (!game || !["playing", "finished"].includes(game.status)) {
    return failure("牌局尚未開始。");
  }

  if (type === "restartGame") {
    if (game.status !== "finished") {
      return failure("本局尚未結束，不能重新開局。");
    }
    return success(createStartedGame((payload.rulesetId || game.rulesetId), game));
  }

  if (game.status !== "playing") {
    return failure("本局已結束，請重新開局。");
  }

  switch (type) {
    case "drawTile":
      return handleDrawTile(game, playerSeat);
    case "discardTile":
      return handleDiscardTile(game, playerSeat, payload.tileId);
    case "passClaim":
      return handlePassClaim(game, playerSeat);
    case "claimChow":
      return handleClaimChow(game, playerSeat, payload.neededTypes || []);
    case "claimPung":
      return handleClaimPung(game, playerSeat);
    case "claimDiscardKong":
      return handleClaimDiscardKong(game, playerSeat);
    case "declareSelfDraw":
      return handleDeclareSelfDraw(game, playerSeat);
    case "claimWin":
      return handleClaimWin(game, playerSeat);
    case "concealedKong":
      return handleConcealedKong(game, playerSeat, payload.tileType);
    case "addedKong":
      return handleAddedKong(game, playerSeat, payload.meldId, payload.tileId);
    default:
      return failure("未知的操作。");
  }
}

export function getPlayerClientState(game, playerSeat) {
  game = normalizeGameState(game);
  if (!game) {
    return {
      canDraw: false,
      canDiscard: false,
      canSelfDraw: false,
      concealedKongs: [],
      addedKongs: [],
      claimOptions: [],
      pendingClaim: null,
    };
  }

  const player = getPlayer(game, playerSeat);
  if (!player) {
    return {
      canDraw: false,
      canDiscard: false,
      canSelfDraw: false,
      concealedKongs: [],
      addedKongs: [],
      claimOptions: [],
      pendingClaim: null,
    };
  }

  const canDraw = game.status === "playing" && game.phase === "draw" && game.turnSeat === playerSeat;
  const canDiscard = game.status === "playing" && game.phase === "discard" && game.turnSeat === playerSeat;
  const canSelfDraw =
    canDiscard &&
    evaluateWinningHand({
      handTileIds: player.hand,
      melds: player.melds,
    }).canWin;

  const concealedKongs = canDiscard ? getConcealedKongTypes(player.hand) : [];
  const addedKongs = canDiscard ? getAddedKongOptions(player) : [];

  const claimOptions = [];
  if (
    game.status === "playing" &&
    ["response", "robKong"].includes(game.phase) &&
    game.pendingClaim && game.pendingClaim.toSeat === playerSeat
  ) {
    if (game.pendingClaim.kind === "discard") {
      if (game.pendingClaim.options.includes("win")) {
        claimOptions.push({ type: "claimWin", label: "胡牌" });
      }
      if (game.pendingClaim.options.includes("pung")) {
        claimOptions.push({ type: "claimPung", label: "碰" });
      }
      if (game.pendingClaim.options.includes("kong")) {
        claimOptions.push({ type: "claimDiscardKong", label: "槓" });
      }
      if (game.pendingClaim.options.includes("chow")) {
        for (const combo of game.pendingClaim.chowCombos) {
          claimOptions.push({
            type: "claimChow",
            label: `吃 ${combo.label}`,
            neededTypes: combo.neededTypes,
          });
        }
      }
      claimOptions.push({ type: "passClaim", label: "過" });
    } else if (game.pendingClaim.kind === "robKong") {
      claimOptions.push({ type: "claimWin", label: "搶槓胡" });
      claimOptions.push({ type: "passClaim", label: "過" });
    }
  }

  return {
    canDraw,
    canDiscard,
    canSelfDraw,
    concealedKongs,
    addedKongs,
    claimOptions,
    pendingClaim: game.pendingClaim,
  };
}

function handleDrawTile(game, playerSeat) {
  if (game.phase !== "draw" || game.turnSeat !== playerSeat) {
    return failure("現在不能摸牌。");
  }

  drawTurnTile(game, playerSeat, "摸牌", "live");
  return success(game);
}

function handleDiscardTile(game, playerSeat, tileId) {
  if (game.phase !== "discard" || game.turnSeat !== playerSeat) {
    return failure("現在不能打牌。");
  }

  const player = getPlayer(game, playerSeat);
  if (!player.hand.includes(tileId)) {
    return failure("指定的牌不在手牌中。");
  }

  removeExactTile(player.hand, tileId);
  player.hand = sortTileIds(player.hand);

  const discardRecord = {
    id: game.nextDiscardId,
    tileId,
    claimed: false,
  };
  game.nextDiscardId += 1;
  player.discards.push(discardRecord);
  game.latestDiscard = {
    id: discardRecord.id,
    tileId,
    seat: playerSeat,
  };
  game.lastDraw = null;

  appendLog(game, `${seatLabel(playerSeat)}打出 ${getTileLabel(tileId)}。`);

  const targetSeat = getOpponentSeat(playerSeat);
  const claimState = buildDiscardClaimState(game, targetSeat);

  if (claimState.options.length > 0) {
    game.phase = "response";
    game.pendingClaim = claimState;
    return success(game);
  }

  game.pendingClaim = null;
  drawTurnTile(game, targetSeat, "摸牌", "live");
  return success(game);
}

function handlePassClaim(game, playerSeat) {
  const claim = game.pendingClaim;
  if (!claim || claim.toSeat !== playerSeat) {
    return failure("目前沒有可以放棄的叫牌。");
  }

  if (claim.kind === "discard") {
    game.pendingClaim = null;
    drawTurnTile(game, playerSeat, "摸牌", "live");
    appendLog(game, `${seatLabel(playerSeat)}選擇過牌。`);
    return success(game);
  }

  if (claim.kind === "robKong") {
    finalizeAddedKong(game, claim.playerSeat, claim.meldId, claim.tileId);
    appendLog(game, `${seatLabel(playerSeat)}放棄搶槓。`);
    return success(game);
  }

  return failure("無法處理過牌。");
}

function handleClaimChow(game, playerSeat, neededTypes) {
  const claim = game.pendingClaim;
  if (
    !claim ||
    claim.kind !== "discard" ||
    game.phase !== "response" ||
    claim.toSeat !== playerSeat ||
    !claim.options.includes("chow")
  ) {
    return failure("現在不能吃牌。");
  }

  const combo = claim.chowCombos.find((candidate) => candidate.key === neededTypes.join("|"));
  if (!combo) {
    return failure("指定的吃牌組合不存在。");
  }

  const player = getPlayer(game, playerSeat);
  const usedTileIds = [];
  for (const tileType of combo.neededTypes) {
    const matches = getTilesByType(player.hand, tileType, 1);
    if (matches.length > 0) {
      usedTileIds.push(matches[0]);
    }
  }

  if (usedTileIds.length !== 2) {
    return failure("手牌不足以完成吃牌。");
  }

  removeTiles(player.hand, usedTileIds);
  markDiscardClaimed(game, claim.discardId);
  player.melds.push({
    id: game.nextMeldId,
    type: "chow",
    concealed: false,
    tileType: combo.sequence[0],
    tiles: sortTileIds([...usedTileIds, claim.tileId]),
    fromSeat: claim.fromSeat,
  });
  game.nextMeldId += 1;
  player.hand = sortTileIds(player.hand);
  game.latestDiscard = null;
  game.pendingClaim = null;
  game.phase = "discard";
  game.turnSeat = playerSeat;
  appendLog(game, `${seatLabel(playerSeat)}吃了 ${combo.label}。`);
  return success(game);
}

function handleClaimPung(game, playerSeat) {
  const claim = game.pendingClaim;
  if (
    !claim ||
    claim.kind !== "discard" ||
    game.phase !== "response" ||
    claim.toSeat !== playerSeat ||
    !claim.options.includes("pung")
  ) {
    return failure("現在不能碰牌。");
  }

  const player = getPlayer(game, playerSeat);
  const usedTileIds = getTilesByType(player.hand, getTileType(claim.tileId), 2);
  if (usedTileIds.length !== 2) {
    return failure("手牌不足以完成碰牌。");
  }

  removeTiles(player.hand, usedTileIds);
  markDiscardClaimed(game, claim.discardId);
  player.melds.push({
    id: game.nextMeldId,
    type: "pung",
    concealed: false,
    tileType: getTileType(claim.tileId),
    tiles: sortTileIds([...usedTileIds, claim.tileId]),
    fromSeat: claim.fromSeat,
  });
  game.nextMeldId += 1;
  player.hand = sortTileIds(player.hand);
  game.latestDiscard = null;
  game.pendingClaim = null;
  game.phase = "discard";
  game.turnSeat = playerSeat;
  appendLog(game, `${seatLabel(playerSeat)}碰了 ${getTileLabel(claim.tileId)}。`);
  return success(game);
}

function handleClaimDiscardKong(game, playerSeat) {
  const claim = game.pendingClaim;
  if (
    !claim ||
    claim.kind !== "discard" ||
    game.phase !== "response" ||
    claim.toSeat !== playerSeat ||
    !claim.options.includes("kong")
  ) {
    return failure("現在不能明槓。");
  }

  const player = getPlayer(game, playerSeat);
  const usedTileIds = getTilesByType(player.hand, getTileType(claim.tileId), 3);
  if (usedTileIds.length !== 3) {
    return failure("手牌不足以完成明槓。");
  }

  removeTiles(player.hand, usedTileIds);
  markDiscardClaimed(game, claim.discardId);
  player.melds.push({
    id: game.nextMeldId,
    type: "kong",
    concealed: false,
    tileType: getTileType(claim.tileId),
    tiles: sortTileIds([...usedTileIds, claim.tileId]),
    fromSeat: claim.fromSeat,
  });
  game.nextMeldId += 1;
  player.hand = sortTileIds(player.hand);
  game.latestDiscard = null;
  game.pendingClaim = null;
  game.turnSeat = playerSeat;
  drawSupplementTile(game, playerSeat, "明槓補牌");
  return success(game);
}

function handleConcealedKong(game, playerSeat, tileType) {
  if (game.phase !== "discard" || game.turnSeat !== playerSeat) {
    return failure("現在不能暗槓。");
  }

  const player = getPlayer(game, playerSeat);
  const usedTileIds = getTilesByType(player.hand, tileType, 4);
  if (usedTileIds.length !== 4) {
    return failure("沒有可暗槓的四張同牌。");
  }

  removeTiles(player.hand, usedTileIds);
  player.melds.push({
    id: game.nextMeldId,
    type: "kong",
    concealed: true,
    tileType,
    tiles: sortTileIds(usedTileIds),
    fromSeat: playerSeat,
  });
  game.nextMeldId += 1;
  player.hand = sortTileIds(player.hand);
  appendLog(game, `${seatLabel(playerSeat)}暗槓 ${getTileLabel(tileType)}。`);
  drawSupplementTile(game, playerSeat, "暗槓補牌");
  return success(game);
}

function handleAddedKong(game, playerSeat, meldId, tileId) {
  if (game.phase !== "discard" || game.turnSeat !== playerSeat) {
    return failure("現在不能補槓。");
  }

  const player = getPlayer(game, playerSeat);
  const meld = player.melds.find((candidate) => candidate.id === meldId);
  if (!meld || meld.type !== "pung" || meld.concealed) {
    return failure("這副牌不能補槓。");
  }

  if (!player.hand.includes(tileId) || getTileType(tileId) !== meld.tileType) {
    return failure("缺少補槓需要的牌。");
  }

  const targetSeat = getOpponentSeat(playerSeat);
  const opponent = getPlayer(game, targetSeat);
  const robWin = evaluateWinningHand({
    handTileIds: opponent.hand,
    melds: opponent.melds,
    additionalTileType: meld.tileType,
  });

  if (robWin.canWin) {
    game.phase = "robKong";
    game.pendingClaim = {
      kind: "robKong",
      playerSeat,
      toSeat: targetSeat,
      meldId,
      tileId,
      tileType: meld.tileType,
    };
    appendLog(game, `${seatLabel(playerSeat)}宣告補槓，等待 ${seatLabel(targetSeat)} 是否搶槓。`);
    return success(game);
  }

  finalizeAddedKong(game, playerSeat, meldId, tileId);
  return success(game);
}

function handleDeclareSelfDraw(game, playerSeat) {
  if (game.phase !== "discard" || game.turnSeat !== playerSeat) {
    return failure("現在不能自摸。");
  }

  const player = getPlayer(game, playerSeat);
  const evaluation = evaluateWinningHand({
    handTileIds: player.hand,
    melds: player.melds,
  });
  if (!evaluation.canWin) {
    return failure("目前手牌尚未成胡。");
  }

  finishWithWinner(game, {
    winnerSeat: playerSeat,
    loserSeat: getOpponentSeat(playerSeat),
    winKind: "selfDraw",
    winningTileId: game.lastDraw ? game.lastDraw.tileId : null,
    patterns: [...evaluation.patterns, "自摸"],
  });
  return success(game);
}

function handleClaimWin(game, playerSeat) {
  const claim = game.pendingClaim;
  if (!claim || claim.toSeat !== playerSeat) {
    return failure("目前沒有可胡的牌。");
  }

  if (claim.kind === "discard") {
    const player = getPlayer(game, playerSeat);
    const evaluation = evaluateWinningHand({
      handTileIds: player.hand,
      melds: player.melds,
      additionalTileId: claim.tileId,
    });
    if (!evaluation.canWin) {
      return failure("這張牌不能讓你胡牌。");
    }

    markDiscardClaimed(game, claim.discardId);
    finishWithWinner(game, {
      winnerSeat: playerSeat,
      loserSeat: claim.fromSeat,
      winKind: "discardWin",
      winningTileId: claim.tileId,
      patterns: evaluation.patterns,
    });
    return success(game);
  }

  if (claim.kind === "robKong") {
    const player = getPlayer(game, playerSeat);
    const evaluation = evaluateWinningHand({
      handTileIds: player.hand,
      melds: player.melds,
      additionalTileType: claim.tileType,
    });
    if (!evaluation.canWin) {
      return failure("目前不能搶槓胡。");
    }

    finishWithWinner(game, {
      winnerSeat: playerSeat,
      loserSeat: claim.playerSeat,
      winKind: "robKong",
      winningTileId: claim.tileId,
      patterns: [...evaluation.patterns, "搶槓"],
    });
    return success(game);
  }

  return failure("這個胡牌動作無效。");
}

function buildDiscardClaimState(game, targetSeat) {
  const player = getPlayer(game, targetSeat);
  const tileId = game.latestDiscard.tileId;
  const options = [];
  const chowCombos = getChowCombos(player.hand, tileId);

  if (
    evaluateWinningHand({
      handTileIds: player.hand,
      melds: player.melds,
      additionalTileId: tileId,
    }).canWin
  ) {
    options.push("win");
  }

  if (canClaimPung(player.hand, tileId)) {
    options.push("pung");
  }

  if (canClaimDiscardKong(player.hand, tileId)) {
    options.push("kong");
  }

  if (chowCombos.length > 0) {
    options.push("chow");
  }

  return {
    kind: "discard",
    fromSeat: game.latestDiscard.seat,
    toSeat: targetSeat,
    discardId: game.latestDiscard.id,
    tileId,
    options,
    chowCombos,
  };
}

function drawTurnTile(game, playerSeat, reason, source) {
  const tileId = game.wall.shift();
  if (!tileId) {
    finishAsDraw(game, "牌牆已摸完，流局。");
    return;
  }

  const player = getPlayer(game, playerSeat);
  player.hand = sortTileIds([...player.hand, tileId]);
  game.phase = "discard";
  game.turnSeat = playerSeat;
  game.lastDraw = {
    seat: playerSeat,
    tileId,
    source,
  };
  appendLog(game, `${seatLabel(playerSeat)}${reason}。`);
}

function drawSupplementTile(game, playerSeat, reason) {
  const tileId = game.wall.pop();
  if (!tileId) {
    finishAsDraw(game, "補牌時牌牆已空，流局。");
    return;
  }

  const player = getPlayer(game, playerSeat);
  player.hand = sortTileIds([...player.hand, tileId]);
  game.phase = "discard";
  game.turnSeat = playerSeat;
  game.lastDraw = {
    seat: playerSeat,
    tileId,
    source: "supplement",
  };
  game.pendingClaim = null;
  game.latestDiscard = null;
  appendLog(game, `${seatLabel(playerSeat)}${reason}。`);
}

function finalizeAddedKong(game, playerSeat, meldId, tileId) {
  const player = getPlayer(game, playerSeat);
  const meld = player.melds.find((candidate) => candidate.id === meldId);
  if (!meld) {
    return;
  }

  removeExactTile(player.hand, tileId);
  meld.type = "kong";
  meld.tiles = sortTileIds([...meld.tiles, tileId]);
  player.hand = sortTileIds(player.hand);
  game.pendingClaim = null;
  game.latestDiscard = null;
  appendLog(game, `${seatLabel(playerSeat)}補槓 ${getTileLabel(tileId)}。`);
  drawSupplementTile(game, playerSeat, "補槓補牌");
}

function finishWithWinner(game, { winnerSeat, loserSeat, winKind, winningTileId, patterns }) {
  game.status = "finished";
  game.phase = "finished";
  game.winnerSeat = winnerSeat;
  game.pendingClaim = null;
  game.turnSeat = winnerSeat;
  game.result = {
    winnerSeat,
    loserSeat,
    winKind,
    winningTileId,
    patterns,
  };
  game.scores = normalizeScores(game.scores);
  game.scores[winnerSeat] += 1;
  const summaryLabel =
    winKind === "selfDraw"
      ? `${seatLabel(winnerSeat)}自摸`
      : winKind === "robKong"
        ? `${seatLabel(winnerSeat)}搶槓胡`
        : `${seatLabel(winnerSeat)}胡牌`;
  appendLog(game, `${summaryLabel}，牌型：${patterns.join("、") || "一般胡牌"}。`);
}

function normalizeScores(scores) {
  return Array.from({ length: 2 }, (_, seat) => {
    const value = Array.isArray(scores) ? Number(scores[seat]) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
}

function finishAsDraw(game, message) {
  game.status = "finished";
  game.phase = "finished";
  game.pendingClaim = null;
  game.result = {
    winKind: "draw",
    patterns: [],
    message,
  };
  appendLog(game, message);
}

function markDiscardClaimed(game, discardId) {
  for (const player of game.players) {
    const discard = player.discards.find((item) => item.id === discardId);
    if (discard) {
      discard.claimed = true;
      return;
    }
  }
}

function getPlayer(game, seat) {
  if (!game || !Array.isArray(game.players)) {
    return null;
  }
  return game.players.find((player) => player && player.seat === seat) || null;
}

function getOpponentSeat(seat) {
  return seat === 0 ? 1 : 0;
}

function removeExactTile(tileIds, tileId) {
  const index = tileIds.indexOf(tileId);
  if (index >= 0) {
    tileIds.splice(index, 1);
  }
}

function removeTiles(tileIds, usedTileIds) {
  for (const tileId of usedTileIds) {
    removeExactTile(tileIds, tileId);
  }
}

function appendLog(game, message) {
  game.actionLog = [message, ...game.actionLog].slice(0, 20);
}

function seatLabel(seat) {
  return `玩家 ${seat + 1}`;
}

function cloneGame(game) {
  return JSON.parse(JSON.stringify(game));
}

function success(game) {
  return {
    ok: true,
    game,
  };
}

function failure(message) {
  return {
    ok: false,
    message,
  };
}
