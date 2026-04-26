const COLORS = {
  blue: "#4b63a2",
  blueDark: "#33497d",
  green: "#2f8c61",
  greenDark: "#1d6747",
  red: "#c65058",
  redDark: "#95383e",
  gold: "#d8b45a",
  frame: "#d8d0c4",
  shadow: "#e7dfd1",
};

const NUMBER_LABELS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONOR_LABELS = {
  E: "東",
  S: "南",
  W: "西",
  N: "北",
  R: "中",
  G: "發",
};

export function getTileSvgMarkup(tileType) {
  return [
    '<svg class="tile-image tile-art-svg" viewBox="0 0 160 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">',
    renderTileFrame(),
    renderTileFace(tileType),
    "</svg>",
  ].join("");
}

function renderTileFrame() {
  return `
    <rect x="12" y="16" width="136" height="192" rx="18" fill="${COLORS.shadow}" />
    <rect x="6" y="6" width="148" height="200" rx="18" fill="#fffdfa" stroke="${COLORS.frame}" stroke-width="2.5" />
    <rect x="11" y="11" width="138" height="190" rx="15" fill="#ffffff" opacity="0.95" />
  `;
}

function renderTileFace(tileType) {
  let face = "";
  if (/^m[1-9]$/.test(tileType)) {
    face = renderCharacterTile(Number(tileType[1]));
  } else if (/^p[1-9]$/.test(tileType)) {
    face = renderPinTile(Number(tileType[1]));
  } else if (/^s[1-9]$/.test(tileType)) {
    face = renderBambooTile(Number(tileType[1]));
  } else {
    face = renderHonorTile(tileType);
  }

  return `<g transform="translate(80 106) scale(1.07 1.12) translate(-80 -106)">${face}</g>`;
}

function renderCharacterTile(rank) {
  return [
    renderShadowedText(80, 70, NUMBER_LABELS[rank], COLORS.blue, 84),
    renderShadowedText(80, 152, "萬", COLORS.red, 68),
  ].join("");
}

function renderHonorTile(tileType) {
  if (tileType === "B") {
    return `
      <rect x="42" y="46" width="76" height="120" rx="10" fill="none" stroke="${COLORS.blue}" stroke-width="5.6" />
      <rect x="54" y="58" width="52" height="96" rx="6" fill="none" stroke="${COLORS.blue}" stroke-width="3.2" opacity="0.55" />
      <path d="M46 52 L64 52 L46 76 Z" fill="none" stroke="${COLORS.blue}" stroke-width="3.2" stroke-linejoin="round" />
      <path d="M114 52 L96 52 L114 76 Z" fill="none" stroke="${COLORS.blue}" stroke-width="3.2" stroke-linejoin="round" />
      <path d="M46 160 L64 160 L46 136 Z" fill="none" stroke="${COLORS.blue}" stroke-width="3.2" stroke-linejoin="round" />
      <path d="M114 160 L96 160 L114 136 Z" fill="none" stroke="${COLORS.blue}" stroke-width="3.2" stroke-linejoin="round" />
    `;
  }

  const fill = tileType === "R" ? COLORS.red : tileType === "G" ? COLORS.green : COLORS.blue;
  const fontSize = tileType === "R" || tileType === "G" ? 124 : 116;
  return renderShadowedText(80, 118, HONOR_LABELS[tileType] || tileType, fill, fontSize);
}

function renderPinTile(rank) {
  switch (rank) {
    case 1:
      return renderPinOne();
    case 2:
      return renderPinMarks([
        { x: 80, y: 72, color: "blue" },
        { x: 80, y: 148, color: "green" },
      ]);
    case 3:
      return renderPinMarks([
        { x: 58, y: 70, color: "blue" },
        { x: 80, y: 110, color: "red" },
        { x: 102, y: 150, color: "green" },
      ]);
    case 4:
      return renderPinMarks([
        { x: 56, y: 72, color: "blue" },
        { x: 104, y: 72, color: "green" },
        { x: 56, y: 148, color: "green" },
        { x: 104, y: 148, color: "blue" },
      ]);
    case 5:
      return renderPinMarks([
        { x: 56, y: 72, color: "blue" },
        { x: 104, y: 72, color: "green" },
        { x: 80, y: 110, color: "red" },
        { x: 56, y: 148, color: "green" },
        { x: 104, y: 148, color: "blue" },
      ]);
    case 6:
      return renderPinMarks([
        { x: 62, y: 56, color: "blue" },
        { x: 98, y: 56, color: "green" },
        { x: 62, y: 122, color: "red" },
        { x: 98, y: 122, color: "red" },
        { x: 62, y: 160, color: "red" },
        { x: 98, y: 160, color: "red" },
      ]);
    case 7:
      return renderPinMarks([
        { x: 50, y: 44, color: "green", scale: 0.94 },
        { x: 80, y: 62, color: "green", scale: 0.94 },
        { x: 110, y: 80, color: "green", scale: 0.94 },
        { x: 62, y: 122, color: "red" },
        { x: 98, y: 122, color: "red" },
        { x: 62, y: 156, color: "red" },
        { x: 98, y: 156, color: "red" },
      ]);
    case 8:
      return renderPinMarks([
        { x: 60, y: 52, color: "blue", scale: 0.94 },
        { x: 100, y: 52, color: "blue", scale: 0.94 },
        { x: 60, y: 88, color: "blue", scale: 0.94 },
        { x: 100, y: 88, color: "blue", scale: 0.94 },
        { x: 60, y: 124, color: "blue", scale: 0.94 },
        { x: 100, y: 124, color: "blue", scale: 0.94 },
        { x: 60, y: 160, color: "blue", scale: 0.94 },
        { x: 100, y: 160, color: "blue", scale: 0.94 },
      ]);
    case 9:
      return renderPinMarks([
        { x: 44, y: 50, color: "blue", scale: 0.82 },
        { x: 80, y: 50, color: "blue", scale: 0.82 },
        { x: 116, y: 50, color: "blue", scale: 0.82 },
        { x: 44, y: 106, color: "red", scale: 0.82 },
        { x: 80, y: 106, color: "red", scale: 0.82 },
        { x: 116, y: 106, color: "red", scale: 0.82 },
        { x: 44, y: 162, color: "green", scale: 0.82 },
        { x: 80, y: 162, color: "green", scale: 0.82 },
        { x: 116, y: 162, color: "green", scale: 0.82 },
      ]);
    default:
      return "";
  }
}

function renderBambooTile(rank) {
  switch (rank) {
    case 1:
      return renderBambooBird();
    case 2:
      return renderBambooMarks([
        { x: 80, y: 68, color: "green" },
        { x: 80, y: 148, color: "green" },
      ]);
    case 3:
      return renderBambooMarks([
        { x: 80, y: 60, color: "green" },
        { x: 62, y: 146, color: "green" },
        { x: 98, y: 146, color: "green" },
      ]);
    case 4:
      return renderBambooMarks([
        { x: 60, y: 66, color: "green" },
        { x: 100, y: 66, color: "green" },
        { x: 60, y: 148, color: "green" },
        { x: 100, y: 148, color: "green" },
      ]);
    case 5:
      return renderBambooMarks([
        { x: 60, y: 64, color: "green" },
        { x: 100, y: 64, color: "green" },
        { x: 80, y: 106, color: "red" },
        { x: 60, y: 148, color: "green" },
        { x: 100, y: 148, color: "green" },
      ]);
    case 6:
      return renderBambooMarks([
        { x: 52, y: 64, color: "green" },
        { x: 80, y: 64, color: "green" },
        { x: 108, y: 64, color: "green" },
        { x: 52, y: 148, color: "green" },
        { x: 80, y: 148, color: "green" },
        { x: 108, y: 148, color: "green" },
      ]);
    case 7:
      return renderBambooMarks([
        { x: 80, y: 44, color: "red", length: 40, width: 7.2 },
        { x: 58, y: 98, color: "green", length: 40, width: 7.2 },
        { x: 58, y: 156, color: "green", length: 40, width: 7.2 },
        { x: 80, y: 98, color: "blue", length: 40, width: 7.2 },
        { x: 80, y: 156, color: "green", length: 40, width: 7.2 },
        { x: 102, y: 98, color: "green", length: 40, width: 7.2 },
        { x: 102, y: 156, color: "green", length: 40, width: 7.2 },
      ]);
    case 8:
      return renderBambooMarks([
        { x: 52, y: 72, color: "green", rotate: 0, length: 44, width: 7.2 },
        { x: 72, y: 70, color: "green", rotate: 30, length: 42, width: 7.2 },
        { x: 88, y: 70, color: "green", rotate: -30, length: 42, width: 7.2 },
        { x: 108, y: 72, color: "green", rotate: 0, length: 44, width: 7.2 },
        { x: 52, y: 144, color: "green", rotate: 0, length: 44, width: 7.2 },
        { x: 72, y: 146, color: "green", rotate: -30, length: 42, width: 7.2 },
        { x: 88, y: 146, color: "green", rotate: 30, length: 42, width: 7.2 },
        { x: 108, y: 144, color: "green", rotate: 0, length: 44, width: 7.2 },
      ]);
    case 9:
      return renderBambooMarks([
        { x: 50, y: 56, color: "blue", scale: 0.84 },
        { x: 50, y: 108, color: "blue", scale: 0.84 },
        { x: 50, y: 160, color: "blue", scale: 0.84 },
        { x: 80, y: 56, color: "red", scale: 0.84 },
        { x: 80, y: 108, color: "red", scale: 0.84 },
        { x: 80, y: 160, color: "red", scale: 0.84 },
        { x: 110, y: 56, color: "green", scale: 0.84 },
        { x: 110, y: 108, color: "green", scale: 0.84 },
        { x: 110, y: 160, color: "green", scale: 0.84 },
      ]);
    default:
      return "";
  }
}

function renderPinOne() {
  const petals = Array.from({ length: 8 }, (_, index) => {
    const angle = (Math.PI / 4) * index;
    const x = Math.cos(angle) * 20;
    const y = Math.sin(angle) * 20;
    const stroke = index % 2 === 0 ? COLORS.red : COLORS.green;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="none" stroke="${stroke}" stroke-width="3.2" />`;
  }).join("");

  return `
    <g transform="translate(80 108)">
      <circle r="40" fill="none" stroke="${COLORS.green}" stroke-width="6" />
      <circle r="31" fill="none" stroke="${COLORS.gold}" stroke-width="5" opacity="0.9" />
      <circle r="23" fill="#fffdfa" stroke="${COLORS.green}" stroke-width="2.6" />
      ${petals}
      <circle r="13.5" fill="none" stroke="${COLORS.red}" stroke-width="4.2" />
      <circle r="5.2" fill="${COLORS.red}" />
    </g>
  `;
}

function renderBambooBird() {
  return `
    <g transform="translate(80 110)">
      <path d="M-24 28 C-18 6 -8 -12 12 -30 C28 -44 42 -34 40 -16 C38 -2 24 10 12 18 C22 20 32 28 36 40"
        fill="none"
        stroke="${COLORS.green}"
        stroke-width="6"
        stroke-linecap="round"
        stroke-linejoin="round" />
      <path d="M-8 10 C2 0 16 2 22 16 C10 18 0 18 -8 10 Z" fill="${COLORS.blue}" opacity="0.78" />
      <circle cx="14" cy="-24" r="4.4" fill="${COLORS.red}" />
      <path d="M20 -24 L32 -20 L20 -16" fill="${COLORS.gold}" />
      <path d="M-8 24 L-26 44 M2 28 L-12 48 M14 28 L2 50" fill="none" stroke="${COLORS.green}" stroke-width="4.2" stroke-linecap="round" />
      <path d="M-6 -2 C6 -18 18 -20 24 -4" fill="none" stroke="${COLORS.greenDark}" stroke-width="3.2" stroke-linecap="round" />
    </g>
  `;
}

function renderPinMarks(marks) {
  return marks
    .map((mark) => renderPinPip(mark.x, mark.y, mark.color, mark.scale || 1))
    .join("");
}

function renderBambooMarks(marks) {
  return marks
    .map((mark) =>
      renderBambooPip(mark.x, mark.y, mark.color, {
        scale: mark.scale || 1,
        rotate: mark.rotate || 0,
        length: mark.length || null,
        width: mark.width || null,
      }),
    )
    .join("");
}

function renderPinPip(x, y, colorKey, scale = 1) {
  const color = getPipColor(colorKey);
  const outer = formatNumber(18.4 * scale);
  const middle = formatNumber(8.8 * scale);
  const inner = formatNumber(4.2 * scale);
  const strokeWidth = formatNumber(5.3 * scale);
  const middleWidth = formatNumber(2.4 * scale);

  return `
    <g transform="translate(${x} ${y})">
      <circle r="${outer}" fill="#fffdf9" stroke="${color}" stroke-width="${strokeWidth}" />
      <circle r="${middle}" fill="none" stroke="${color}" stroke-width="${middleWidth}" opacity="0.68" />
      <circle r="${inner}" fill="${color}" />
    </g>
  `;
}

function renderBambooPip(x, y, colorKey, { scale = 1, rotate = 0, length = null, width = null } = {}) {
  const color = getPipColor(colorKey);
  const edge = getPipEdgeColor(colorKey);
  const lineLength = length || 48 * scale;
  const lineWidth = width || 7.6 * scale;
  const glowWidth = lineWidth + 2.4 * scale;

  return `
    <g transform="translate(${x} ${y}) rotate(${rotate})">
      <path d="M0 ${formatNumber(-lineLength / 2)} V ${formatNumber(lineLength / 2)}" stroke="${edge}" stroke-width="${formatNumber(glowWidth)}" stroke-linecap="round" />
      <path d="M0 ${formatNumber(-lineLength / 2)} V ${formatNumber(lineLength / 2)}" stroke="${color}" stroke-width="${formatNumber(lineWidth)}" stroke-linecap="round" />
    </g>
  `;
}

function renderShadowedText(x, y, text, fill, fontSize) {
  const escaped = escapeXml(text);
  return `
    <text x="${x}" y="${y + 3}" text-anchor="middle" dominant-baseline="middle" font-family="KaiTi, STKaiti, BiauKai, PMingLiU, Noto Serif TC, serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" opacity="0.62">${escaped}</text>
    <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="KaiTi, STKaiti, BiauKai, PMingLiU, Noto Serif TC, serif" font-size="${fontSize}" font-weight="700" fill="${fill}" stroke="#f7f1e7" stroke-width="1.2" paint-order="stroke fill">${escaped}</text>
  `;
}

function getPipColor(colorKey) {
  if (colorKey === "red") {
    return COLORS.red;
  }
  if (colorKey === "green") {
    return COLORS.green;
  }
  return COLORS.blue;
}

function getPipEdgeColor(colorKey) {
  if (colorKey === "red") {
    return COLORS.redDark;
  }
  if (colorKey === "green") {
    return COLORS.greenDark;
  }
  return COLORS.blueDark;
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
