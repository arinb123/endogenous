import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseState, MAX_STATE_BYTES } from "./public/core/state.js";
import { buildProof } from "./public/core/proof-export.js";

const root = path.resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const port = Number(process.env.PORT || 5173);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname === "/api/export/pdf" && request.method === "POST") {
      // All rendering remains on loopback. Accept state JSON, never arbitrary
      // TeX/HTML; the same checked importer supplies the proof's trusted model.
      const origin = request.headers.origin;
      if (origin) {
        let originUrl;
        try { originUrl = new URL(origin); } catch { originUrl = null; }
        if (!originUrl || originUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(originUrl.hostname)) {
          response.writeHead(403).end("Forbidden");
          return;
        }
      }
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_STATE_BYTES) {
          response.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This state file is too large (maximum 10 MB)." }));
          return;
        }
        chunks.push(chunk);
      }
      try {
        const state = parseState(Buffer.concat(chunks).toString("utf8"));
        const proof = buildProof(state.document, state.lemmas);
        const { renderProofPdf } = await import("./proof-pdf.mjs");
        const pdf = await renderProofPdf(proof);
        response.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="endogenous-proof.pdf"',
          "Content-Length": pdf.length, "Cache-Control": "no-store",
        }).end(pdf);
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    const filename = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (
      !filename.startsWith(root + path.sep) ||
      !["GET", "HEAD"].includes(request.method)
    ) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": `${types[path.extname(filename)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Endogenous: http://127.0.0.1:${server.address().port}`),
);
