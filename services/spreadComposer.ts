type TextSide = "left" | "right" | "none";

export type ComposeOptions = {
  canvas: HTMLCanvasElement;
  backgroundImg: HTMLImageElement; // generated spread image
  title?: string;
  body?: string;
  highlights?: string[];           // short lines (like your big colored phrases)
  textSide: TextSide;
  pageIndex?: number;             // used for light variation
};

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitFontToBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  boxW: number,
  boxH: number,
  maxPx: number,
  minPx: number,
  lineMult: number,
  fontFamily: string,
  weight = 600
) {
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `${weight} ${mid}px ${fontFamily}`;
    const lines = wrapLines(ctx, text, boxW);
    const lineH = Math.round(mid * lineMult);
    const totalH = lines.length * lineH;

    if (totalH <= boxH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

function drawSideGradient(ctx: CanvasRenderingContext2D, W: number, H: number, side: TextSide) {
  if (side === "none") return;

  const left = side === "left";
  const x0 = left ? 0 : W;
  const x1 = left ? Math.round(W * 0.55) : Math.round(W * 0.45);

  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  // Dark -> transparent
  if (left) {
    g.addColorStop(0, "rgba(0,0,0,0.70)");
    g.addColorStop(1, "rgba(0,0,0,0.00)");
  } else {
    g.addColorStop(0, "rgba(0,0,0,0.70)");
    g.addColorStop(1, "rgba(0,0,0,0.00)");
  }

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function pickAccentPair(pageIndex: number) {
  // max 2 colors per page
  const pairs: [string, string][] = [
    ["#FF5A2A", "#44D27D"], // orange + green
    ["#FFD84D", "#4EA3FF"], // yellow + blue
    ["#FF6BD6", "#FFD84D"], // pink + yellow
  ];
  return pairs[Math.abs(pageIndex) % pairs.length];
}

export function composeSpread(opts: ComposeOptions) {
  const { canvas, backgroundImg, title, body, highlights, textSide, pageIndex = 0 } = opts;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context not available");

  const W = canvas.width;
  const H = canvas.height;

  // 1) Background image
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(backgroundImg, 0, 0, W, H);

  // 2) Legibility gradient
  drawSideGradient(ctx, W, H, textSide);

  if (textSide === "none") return;

  const left = textSide === "left";

  // Text box positioning (similar to your reference pages)
  const boxX = left ? Math.round(W * 0.06) : Math.round(W * 0.58);
  const boxY = Math.round(H * 0.10);
  const boxW = Math.round(W * 0.36);
  const boxH = Math.round(H * 0.80);

  const fontFamily = `Georgia, 'Times New Roman', Times, serif`;

  // Scale font sizes from canvas height (THIS is the fix)
  const titleMax = Math.round(H * 0.045); // smaller title
  const bodyMax = Math.round(H * 0.022);  // smaller body
  const bodyMin = Math.round(H * 0.014);  // smaller min

  const [accent1, accent2] = pickAccentPair(pageIndex);

  let y = boxY;

  // 3) Title
  if (title?.trim()) {
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.font = `italic 700 ${titleMax}px ${fontFamily}`;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 2;
    const t = title.trim();
    ctx.fillText(t, boxX, y);
    y += Math.round(titleMax * 1.10);
  }

  // 4) Body paragraph (auto-fit)
  if (body?.trim()) {
    const remainingH = boxY + boxH - y;
    const fittedPx = fitFontToBox(ctx, body, boxW, remainingH, bodyMax, bodyMin, 1.32, fontFamily, 400);

    ctx.font = `italic 400 ${fittedPx}px ${fontFamily}`;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 2;

    const lines = wrapLines(ctx, body, boxW);
    const lineH = Math.round(fittedPx * 1.32);

    for (const line of lines) {
      if (y + lineH > boxY + boxH) break;
      ctx.fillText(line, boxX, y);
      y += lineH;
    }

    y += Math.round(fittedPx * 0.6);
  }

  // 5) Highlights (if needed, style as small white serif)
  if (highlights && highlights.length) {
    const hiPx = Math.round(H * 0.022);
    const hiLineH = Math.round(hiPx * 1.18);
    ctx.font = `italic 400 ${hiPx}px ${fontFamily}`;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 2;

    for (let i = 0; i < highlights.length; i++) {
      const line = (highlights[i] || "").trim();
      if (!line) continue;
      if (y + hiLineH > boxY + boxH) break;
      ctx.fillText(line, boxX, y);
      y += hiLineH;
    }
  }

  // Optional tiny variation per-page: slight text shadow every other page
  if (pageIndex % 2 === 1) {
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
  } else {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}
