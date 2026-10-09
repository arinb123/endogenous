import PDFDocument from "pdfkit";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { openSync } from "fontkit";
import SVGtoPDF from "svg-to-pdfkit";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const typesetter = mathjax.document("", {
  InputJax: new TeX({
    packages: ["base", "ams"],
    formatError(_jax, error) { throw error; },
  }),
  OutputJax: new SVG({ fontCache: "none" }),
});
const MARGIN = 48;
const MATH_SIZE = 12;
const fallbackFonts = new Map();
let fontFiles;

function fontDirectories() {
  const home = homedir();
  if (process.platform === "win32") return [
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts"),
    path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Microsoft", "Windows", "Fonts"),
  ];
  if (process.platform === "darwin") return [
    "/System/Library/Fonts", "/Library/Fonts", path.join(home, "Library", "Fonts"),
  ];
  return [
    "/usr/share/fonts", "/usr/local/share/fonts", path.join(home, ".fonts"),
    path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "fonts"),
  ];
}

function findFontFiles(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch { return []; } // Optional or inaccessible system/user font directory.
  return entries.flatMap((entry) => {
    const file = path.join(directory, entry.name);
    // Do not follow directory symlinks; font-file symlinks are safe to open.
    if (entry.isDirectory()) return findFontFiles(file);
    return /\.(ttf|otf|ttc|otc|dfont)$/i.test(entry.name) ? [file] : [];
  });
}

function fontPriority(file) {
  const name = path.basename(file);
  if (/bold|italic|oblique|light|black|heavy/i.test(name)) return 2;
  // Prefer ordinary text faces over decorative fonts that share their glyphs.
  return /^(NotoSans|DejaVuSans|segoeui|arial|PingFang|Hiragino|msyh|msgothic)/i.test(name) ? 0 : 1;
}

// MathJax supplies paths for mathematical glyphs. For a Unicode variable name
// outside its fonts, use an installed font containing that exact character.
// Fail explicitly when none is available; never export missing-glyph boxes.
function fallbackFont(characters) {
  const charset = [...characters].map((character) => character.codePointAt(0).toString(16)).join(" ");
  if (fallbackFonts.has(charset)) return fallbackFonts.get(charset);
  // Scan lazily: ordinary math uses MathJax paths and needs no installed fonts.
  fontFiles ??= [...new Set(fontDirectories().flatMap(findFontFiles))]
    .sort((a, b) => fontPriority(a) - fontPriority(b) || a.localeCompare(b));
  for (const file of fontFiles) {
    try {
      const opened = openSync(file);
      const collection = opened.fonts;
      const fonts = collection || [opened];
      const font = fonts.find((candidate) => [...characters].every((character) => candidate.hasGlyphForCodePoint(character.codePointAt(0))));
      if (!font) continue;
      const fallback = { name: `ProofFallback${fallbackFonts.size}`, file, family: collection ? font.postscriptName : undefined };
      fallbackFonts.set(charset, fallback);
      return fallback;
    } catch { /* Skip fonts that Fontkit cannot read. */ }
  }
  throw new Error(`PDF needs an installed font for the variable-name character ${characters}. Install a suitable Unicode font, restart the server, or export LaTeX.`);
}

/** Math is typeset from the generated LaTeX, then embedded as vector paths.
 * No browser, TeX installation, or external service is used.
 */
export function typesetMath(latex) {
  const container = typesetter.convert(latex, { display: true });
  const svg = adaptor.tags(container, "svg")[0];
  if (!svg || adaptor.tags(container, "merror").length)
    throw new Error("An equation could not be typeset for PDF export.");
  const viewBox = adaptor.getAttribute(svg, "viewBox").split(/\s+/).map(Number);
  const width = viewBox[2] / 1000 * MATH_SIZE;
  const height = viewBox[3] / 1000 * MATH_SIZE;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("An equation has invalid PDF dimensions.");
  adaptor.setAttribute(svg, "width", `${width}pt`);
  adaptor.setAttribute(svg, "height", `${height}pt`);
  const fonts = [];
  for (const node of adaptor.tags(svg, "text")) {
    const font = fallbackFont(adaptor.textContent(node));
    fonts.push(font);
    adaptor.setAttribute(node, "font-family", font.name);
  }
  return { svg: adaptor.outerHTML(svg), width, height, fonts };
}

/** Render a format-independent proof model. Each equation stays on one page;
 * long proofs paginate, and wide equations get wider pages instead of clipping.
 */
export async function renderProofPdf(proof) {
  const sections = proof.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => block.type === "math"
      ? { ...block, drawing: typesetMath(block.latex) }
      : block),
  }));
  const widest = Math.max(0, ...sections.flatMap((section) => section.blocks.map((block) => block.drawing?.width || 0)));
  // Normal proofs use A4. Longer expressions can use landscape-width pages;
  // unusually wide expressions keep a legible 10pt equivalent on wider pages.
  const pageWidth = Math.max(595.28, widest * 10 / MATH_SIZE + MARGIN * 2);
  if (pageWidth > 14400) throw new Error("This expression is too wide for PDF. Export the LaTeX source instead.");
  const pageHeight = 841.89;
  const contentWidth = pageWidth - MARGIN * 2;
  const pdf = new PDFDocument({
    size: [pageWidth, pageHeight], margin: MARGIN, bufferPages: true,
    info: { Title: proof.title, Author: "Endogenous", Subject: "Checked causal derivation" },
  });
  for (const section of sections)
    for (const block of section.blocks)
      for (const font of block.drawing?.fonts || []) pdf.registerFont(font.name, font.file, font.family);
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
  });
  let y = MARGIN;
  const ensureSpace = (height) => {
    if (y + height > pageHeight - MARGIN - 22) {
      pdf.addPage();
      y = MARGIN;
    }
  };
  const text = (value, size = 10, bold = false) => {
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    const height = pdf.heightOfString(value, { width: contentWidth, lineGap: 3 });
    ensureSpace(height + 8);
    pdf.fillColor("#222b3c").text(value, MARGIN, y, { width: contentWidth, lineGap: 3 });
    y = pdf.y + 8;
  };
  try {
    if (proof.title) {
      text(proof.title, 22, true);
      y += 8;
    }
    for (const section of sections) {
      if (section.title) {
        ensureSpace(75);
        text(section.title, 13, true);
      }
      for (let i = 0; i < section.blocks.length; i++) {
        const block = section.blocks[i];
        if (block.type === "text") {
          // Keep a line's number/reason next to its equation where possible.
          if (section.blocks[i + 1]?.drawing) ensureSpace(65);
          text(block.text);
          continue;
        }
        // A compact step is two lines: its rule/sets and its expression. Move
        // them together so a page never starts with an unexplained equality.
        const drawings = [block.drawing];
        if (block.keepWithNext && section.blocks[i + 1]?.drawing)
          drawings.push(section.blocks[++i].drawing);
        const scales = drawings.map((drawing) => Math.min(1, contentWidth / drawing.width));
        const mathHeight = drawings.reduce((total, drawing, index) => total + drawing.height * scales[index], 0);
        const availableHeight = pageHeight - MARGIN * 2 - 22 - drawings.length * 16;
        const fit = Math.min(1, availableHeight / mathHeight);
        ensureSpace(mathHeight * fit + drawings.length * 16);
        drawings.forEach((drawing, index) => {
          const scale = scales[index] * fit;
          const height = drawing.height * scale;
          SVGtoPDF(pdf, drawing.svg, MARGIN, y, {
            width: drawing.width * scale, height, assumePt: true,
            fontCallback: (family) => family,
            warningCallback: (warning) => { throw new Error(`PDF math rendering failed: ${warning}`); },
          });
          y += height + 16;
        });
      }
      y += 12;
    }
    pdf.end();
  } catch (error) {
    pdf.destroy(error);
  }
  return complete;
}
