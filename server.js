import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const app = express();
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5174);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "dist");
const isProduction = process.env.NODE_ENV === "production";
const httpServer = createServer(app);

app.use(express.json({ limit: "2mb" }));

app.post("/api/fetch-share", async (req, res) => {
  const url = String(req.body?.url || "").trim();

  if (!/^https:\/\/chatgpt\.com\/share\//.test(url) && !/^https:\/\/chat\.openai\.com\/share\//.test(url)) {
    res.status(400).json({ error: "Use a public ChatGPT share URL." });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
      }
    });

    const html = await response.text();

    if (!response.ok) {
      res.status(response.status).json({ error: `ChatGPT returned ${response.status}.`, html });
      return;
    }

    res.json({ html, finalUrl: response.url });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to fetch share page." });
  }
});

if (isProduction) {
  app.use(express.static(distPath));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server: httpServer }
    },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

httpServer.listen(port, host, () => {
  console.log(`Local app running at http://${host}:${port}`);
});
