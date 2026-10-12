import type { Board } from "./physics/resolve";

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Output resolution: at least `PX_PER_UNIT` px per tan unit and `MIN_LONG_SIDE` px on the long
 * side (crisp on high-density phone screens), but never more than `MAX_LONG_SIDE` px or
 * `MAX_PIXELS` in total: bigger files gain nothing visible, and iOS Safari fails on very
 * large canvases.
 */
const PX_PER_UNIT = 160;
const MIN_LONG_SIDE = 2048;
const MAX_LONG_SIDE = 3072;
const MAX_PIXELS = 8_000_000;
const JPEG_QUALITY = 0.92;
/** Overlays that belong to the live UI, not to the picture. */
const UI_ONLY = ".snap-flash, .piece-actions, .joints, .twist-zone, .group-outline";

export interface ExportOptions {
  filename: string;
  /** Crop to this part of the board (tan units); defaults to the whole board. */
  crop?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Caption drawn under the picture, e.g. the puzzle name and time. */
  caption?: { title: string; subtitle?: string };
  /**
   * Where the picture leads: printed as a quiet address line, and as a small QR code in the
   * caption's corner (never over the figure), so a shared image opens the same puzzle.
   */
  link?: string;
}

/**
 * Caption layout, in tan units for a typical puzzle picture. Big pictures (e.g. a whole free-play
 * board) scale the caption up (`captionScale`) so the text stays legible and the QR stays
 * scannable when the image is shown at phone size.
 */
const CAPTION = {
  /** Band height: title + subtitle (+ address line when there's a link). */
  height: (subtitle: boolean, link: boolean) => (link ? 1.6 : subtitle ? 1.15 : 0.8),
  qrSize: 1.3,
  pad: 0.2,
  /** With a link, narrow figures are widened to this so the text and QR sit side by side. */
  minWidthWithLink: 6,
  /** Long side (units) up to which the caption isn't scaled. */
  refLongSide: 7,
  maxScale: 2.5,
};

const captionScale = (w: number, h: number) =>
  Math.min(CAPTION.maxScale, Math.max(1, Math.max(w, h) / CAPTION.refLongSide));

const set = (el: Element, attrs: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
};
const make = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, tag);
  set(el, attrs);
  return el;
};

/**
 * Render the board as an image. The live SVG is styled by the page's CSS, which a standalone
 * image doesn't get, so the bits that matter are inlined here and UI overlays are dropped.
 */
async function renderImage(svg: SVGSVGElement, board: Board, opts: ExportOptions): Promise<Blob> {
  const crop = { ...(opts.crop ?? { minX: 0, minY: 0, maxX: board.width, maxY: board.height }) };
  const hasCaption = !!opts.caption || !!opts.link;
  const k = captionScale(crop.maxX - crop.minX, crop.maxY - crop.minY);
  const captionH = hasCaption ? CAPTION.height(!!opts.caption?.subtitle, !!opts.link) * k : 0;
  if (opts.link && crop.maxX - crop.minX < CAPTION.minWidthWithLink) {
    const grow = (CAPTION.minWidthWithLink - (crop.maxX - crop.minX)) / 2;
    crop.minX -= grow;
    crop.maxX += grow;
  }
  const w = crop.maxX - crop.minX;
  const h = crop.maxY - crop.minY + captionH;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(UI_ONLY).forEach((n) => n.remove());
  clone.querySelectorAll(".piece").forEach((n) => {
    n.removeAttribute("class");
    // no light outline in pictures: a hair-thin stroke in the piece's own colour just covers the
    // anti-aliasing seam where two pieces meet, so the figure reads as one solid shape
    const own = n.getAttribute("fill") ?? "none";
    set(n, { stroke: own, "stroke-width": 0.02, "stroke-linejoin": "round" });
  });
  clone.querySelectorAll(".guide").forEach((n) => {
    const solved = n.classList.contains("solved");
    n.removeAttribute("class");
    if (solved) set(n, { fill: "none", stroke: "none" });
    else
      set(n, {
        fill: "rgba(255,255,255,0.1)",
        stroke: "rgba(255,255,255,0.4)",
        "stroke-width": 0.03,
        "stroke-dasharray": "0.12 0.08",
        "stroke-linejoin": "round",
      });
  });

  // backdrop in the app's colours, behind everything
  const defs = clone.querySelector("defs") ?? clone.insertBefore(make("defs", {}), clone.firstChild);
  const box = { minX: crop.minX, minY: crop.minY, w, h };
  const backdrop = paintBackdrop(defs, box);
  clone.insertBefore(backdrop, defs.nextSibling);

  if (hasCaption) {
    // with a QR in the right corner, centre the text in the space left of it
    const qr = opts.link ? (CAPTION.qrSize + CAPTION.pad) * k : 0;
    const textX = crop.minX + (w - qr) / 2;
    const base = { x: textX, "text-anchor": "middle", "font-family": "system-ui, sans-serif" };
    let y = crop.maxY;
    if (opts.caption) {
      const hot = make("linearGradient", { id: "export-title", x1: 0, y1: 0, x2: 1, y2: 0 });
      hot.append(
        make("stop", { offset: 0, "stop-color": "#ff6b8b" }),
        make("stop", { offset: 0.55, "stop-color": "#ff8a3d" }),
        make("stop", { offset: 1, "stop-color": "#ffd166" }),
      );
      defs.append(hot);
      const title = make("text", {
        ...base,
        y: (y += 0.55 * k),
        "font-size": 0.42 * k,
        "font-weight": 900,
        "letter-spacing": 0.01 * k,
        fill: "url(#export-title)",
      });
      title.textContent = opts.caption.title;
      clone.append(title);
      if (opts.caption.subtitle) {
        const sub = make("text", { ...base, y: (y += 0.43 * k), "font-size": 0.28 * k, fill: "rgba(248,244,255,0.82)" });
        sub.textContent = opts.caption.subtitle;
        clone.append(sub);
      }
    }
    if (opts.link) {
      const url = make("text", { ...base, y: y + 0.4 * k, "font-size": 0.2 * k, fill: "rgba(248,244,255,0.6)" });
      url.textContent = opts.link.replace(/^https?:\/\//, "");
      clone.append(url);
      const size = CAPTION.qrSize * k;
      clone.append(
        await qrTile(opts.link, crop.maxX - CAPTION.pad * k - size, crop.maxY + (captionH - size) / 2, size),
      );
    }
  }

  // small figures still make a crisp, shareable image; big boards stay within sane limits
  const long = Math.max(w, h);
  const scale = Math.min(
    Math.max(PX_PER_UNIT, MIN_LONG_SIDE / long),
    MAX_LONG_SIDE / long,
    Math.sqrt(MAX_PIXELS / (w * h)),
  );
  const [pw, ph] = [Math.round(w * scale), Math.round(h * scale)];
  set(clone, { viewBox: `${crop.minX} ${crop.minY} ${w} ${h}`, width: pw, height: ph });
  clone.removeAttribute("class");

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not render the board"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    // JPEG at high quality: the picture is opaque gradients and flat colour, where it's visually
    // lossless at about a tenth of the PNG size (PNG of the glow backdrop runs to several MB)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode image"))), "image/jpeg", JPEG_QUALITY),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export the board as an image: on phones that can share files, open the share sheet (so it can
 * go straight to Photos or a chat); otherwise download it.
 */
export async function exportBoardImage(svg: SVGSVGElement, board: Board, opts: ExportOptions) {
  const blob = await renderImage(svg, board, opts);
  const file = new File([blob], opts.filename, { type: "image/jpeg" });
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opts.caption?.title ?? "Tangram" });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // user closed the share sheet
      // fall through to a download
    }
  }
  const a = document.createElement("a");
  a.download = opts.filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * The picture's background: a rich violet → indigo gradient with soft glows in the app's
 * piece colours, a faint dot texture, and a gentle vignette.
 */
function paintBackdrop(defs: Element, box: { minX: number; minY: number; w: number; h: number }) {
  const g = make("g", {});
  const rect = (fill: string) => make("rect", { x: box.minX, y: box.minY, width: box.w, height: box.h, fill });

  const base = make("linearGradient", { id: "export-bg", x1: 0, y1: 0, x2: 0.8, y2: 1 });
  base.append(
    make("stop", { offset: 0, "stop-color": "#3a1585" }),
    make("stop", { offset: 0.45, "stop-color": "#2a1670" }),
    make("stop", { offset: 1, "stop-color": "#10215e" }),
  );
  defs.append(base);
  g.append(rect("url(#export-bg)"));

  // coloured light: pink top-left, blue right, purple bottom, a touch of amber
  const glows: [string, number, number, number, string, number][] = [
    ["export-glow-pink", 0.08, 0.02, 0.75, "#ff4d6d", 0.55],
    ["export-glow-blue", 1.0, 0.35, 0.7, "#3a86ff", 0.5],
    ["export-glow-purple", 0.45, 1.05, 0.75, "#c77dff", 0.45],
    ["export-glow-amber", 0.9, 0.95, 0.45, "#ffbe0b", 0.16],
  ];
  for (const [id, cx, cy, r, color, alpha] of glows) {
    const rg = make("radialGradient", { id, cx, cy, r });
    rg.append(
      make("stop", { offset: 0, "stop-color": color, "stop-opacity": alpha }),
      make("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }),
    );
    defs.append(rg);
    g.append(rect(`url(#${id})`));
  }

  // faint dot grid, like the app's backdrop
  const step = 0.32;
  const dots = make("pattern", { id: "export-dots", width: step, height: step, patternUnits: "userSpaceOnUse" });
  dots.append(make("circle", { cx: step / 2, cy: step / 2, r: 0.022, fill: "rgba(255,255,255,0.10)" }));
  defs.append(dots);
  g.append(rect("url(#export-dots)"));

  // vignette pulls the eye to the figure
  const vig = make("radialGradient", { id: "export-vignette", cx: 0.5, cy: 0.45, r: 0.75 });
  vig.append(
    make("stop", { offset: 0.55, "stop-color": "#08001c", "stop-opacity": 0 }),
    make("stop", { offset: 1, "stop-color": "#08001c", "stop-opacity": 0.45 }),
  );
  defs.append(vig);
  g.append(rect("url(#export-vignette)"));
  return g;
}


/**
 * A QR code on a small white tile (dark on light: many phone scanners can't read inverted
 * codes). The encoder is loaded only when exporting, so it costs nothing until then.
 */
async function qrTile(text: string, x: number, y: number, size: number) {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2; // modules of white margin around the code
  const cell = size / (n + quiet * 2);
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${(c + quiet) * cell},${(r + quiet) * cell}h${cell}v${cell}h${-cell}z`;
    }
  }
  const g = make("g", { transform: `translate(${x},${y})` });
  g.append(
    make("rect", { width: size, height: size, rx: cell * 1.5, fill: "#ffffff" }),
    make("path", { d, fill: "#1a1240", "shape-rendering": "crispEdges" }),
  );
  return g;
}
