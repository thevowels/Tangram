import type { Board } from "./physics/resolve";

const SVG_NS = "http://www.w3.org/2000/svg";
/** At least this many px per tan unit, and at least `MIN_LONG_SIDE` px on the long side. */
const PX_PER_UNIT = 80;
const MIN_LONG_SIDE = 1080;
/** Overlays that belong to the live UI, not to the picture. */
const UI_ONLY = ".snap-flash, .piece-actions, .joints, .twist-zone, .group-outline";

export interface ExportOptions {
  filename: string;
  /** Crop to this part of the board (tan units); defaults to the whole board. */
  crop?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Caption drawn under the picture, e.g. the puzzle name and time. */
  caption?: { title: string; subtitle?: string };
}

const set = (el: Element, attrs: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
};
const make = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, tag);
  set(el, attrs);
  return el;
};

/**
 * Render the board as a PNG. The live SVG is styled by the page's CSS, which a standalone
 * image doesn't get, so the bits that matter are inlined here and UI overlays are dropped.
 */
async function renderPng(svg: SVGSVGElement, board: Board, opts: ExportOptions): Promise<Blob> {
  const crop = opts.crop ?? { minX: 0, minY: 0, maxX: board.width, maxY: board.height };
  const captionH = opts.caption ? (opts.caption.subtitle ? 1.15 : 0.8) : 0;
  const w = crop.maxX - crop.minX;
  const h = crop.maxY - crop.minY + captionH;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(UI_ONLY).forEach((n) => n.remove());
  clone.querySelectorAll(".piece").forEach((n) => {
    n.removeAttribute("class");
    set(n, { stroke: "rgba(255,255,255,0.35)", "stroke-width": 0.03, "stroke-linejoin": "round" });
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
  const grad = make("linearGradient", { id: "export-bg", x1: 0, y1: 0, x2: 1, y2: 1 });
  grad.append(make("stop", { offset: 0, "stop-color": "#2b1766" }), make("stop", { offset: 1, "stop-color": "#0f1b4d" }));
  defs.append(grad);
  clone.insertBefore(
    make("rect", { x: crop.minX, y: crop.minY, width: w, height: h, fill: "url(#export-bg)" }),
    defs.nextSibling,
  );

  if (opts.caption) {
    const base = { x: crop.minX + w / 2, "text-anchor": "middle", "font-family": "system-ui, sans-serif" };
    const title = make("text", {
      ...base,
      y: crop.maxY + 0.55,
      "font-size": 0.42,
      "font-weight": 800,
      fill: "#ffffff",
    });
    title.textContent = opts.caption.title;
    clone.append(title);
    if (opts.caption.subtitle) {
      const sub = make("text", { ...base, y: crop.maxY + 0.98, "font-size": 0.28, fill: "rgba(244,240,255,0.7)" });
      sub.textContent = opts.caption.subtitle;
      clone.append(sub);
    }
  }

  // small figures still make a crisp, shareable image
  const scale = Math.max(PX_PER_UNIT, MIN_LONG_SIDE / Math.max(w, h));
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
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode PNG"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export the board as a PNG: on phones that can share files, open the share sheet (so it can
 * go straight to Photos or a chat); otherwise download it.
 */
export async function exportBoardImage(svg: SVGSVGElement, board: Board, opts: ExportOptions) {
  const blob = await renderPng(svg, board, opts);
  const file = new File([blob], opts.filename, { type: "image/png" });
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
