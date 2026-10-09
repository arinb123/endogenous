import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { probabilityExpression } from "../public/core/expression.js";
import { applyDoCalculus } from "../public/core/algebra.js";
import { parseState, serializeState } from "../public/core/state.js";
import { exportMarkdown, exportLatex } from "../public/core/proof-export.js";

function savedProof(outcomeLabel = "y") {
  const graph = {
    nodes: ["x", "y", "z"].map((id, index) => ({
      id, label: id === "y" ? outcomeLabel : id, x: 100 + index * 200, y: 200,
    })),
    edges: [],
  };
  const first = probabilityExpression({
    outcome: ["y"], intervention: ["x"], observation: ["z"],
  });
  const next = applyDoCalculus(graph, first, [first.id], 1, "delete", {
    X: ["x"], Y: ["y"], Z: ["z"], W: [],
  });
  return serializeState({
    graph,
    initial: first.probability,
    current: next.expression,
    history: [
      { expression: first, certificate: null },
      { expression: next.expression, certificate: next.certificate },
    ],
  }, []);
}

async function startServer(t) {
  // Starting outside the project also checks that static files and PDF imports
  // are resolved relative to the server module, rather than the shell directory.
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd: tmpdir(), env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  });
  let output = "";
  let errors = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { errors += chunk; });
  child.stdout.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Server did not start: ${errors}`)), 10000);
    const finish = (error, url) => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error);
      else resolve(url);
    };
    const onError = (error) => finish(error);
    const onClose = (code) => finish(new Error(`Server exited with ${code}: ${errors}`));
    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/Endogenous: (http:\/\/127\.0\.0\.1:(\d+))/u);
      if (match) {
        if (Number(match[2]) === 0) finish(new Error("Server must report its actual assigned port."));
        else finish(null, match[1]);
      }
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

async function assertPdf(response) {
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
  assert.equal(response.headers.get("content-type"), "application/pdf");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(bytes.subarray(-40).toString("ascii"), /%%EOF/u);
}

test("local server and exports work across supported operating systems", { timeout: 90000 }, async (t) => {
  const base = await startServer(t);
  const request = (pathname, options = {}) => fetch(base + pathname, {
    ...options, signal: AbortSignal.timeout(20000),
  });
  const pdf = (body) => request("/api/export/pdf", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body,
  });

  await t.test("serves the workbench and browser modules from any working directory", async () => {
    const page = await request("/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/u);
    assert.match(await page.text(), /id="export-proof"/u);
    const head = await request("/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const file of ["/app.js", "/core/state.js", "/core/proof-export.js"]) {
      const module = await request(file);
      assert.equal(module.status, 200, file);
      assert.match(module.headers.get("content-type"), /^text\/javascript/u);
      assert.ok((await module.text()).length > 0, file);
    }
  });

  await t.test("state, Markdown, and LaTeX preserve a checked Unicode derivation", () => {
    const text = savedProof("漢字é");
    const restored = parseState(text);
    assert.deepEqual(restored.document, JSON.parse(text).document);
    for (const exportText of [exportMarkdown, exportLatex]) {
      const result = exportText(restored.document, restored.lemmas);
      assert.match(result, /\\text\{漢字é\}/u);
      assert.match(result, /\(2\) Rule 1, with/u);
    }
  });

  await t.test("PDF endpoint renders ordinary math and accented labels", async () => {
    await assertPdf(await pdf(savedProof()));
    await assertPdf(await pdf(savedProof("café")));
  });

  await t.test("CJK PDF uses a matching font or reports the missing font explicitly", async () => {
    const response = await pdf(savedProof("漢字é"));
    if (response.status === 200) {
      await assertPdf(response);
    } else {
      assert.equal(response.status, 400);
      const { error } = await response.json();
      assert.match(error, /PDF needs an installed font/u);
      t.diagnostic("CJK font is unavailable on this host; the exporter reported it explicitly.");
    }
  });
});
