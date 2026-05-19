import JSZip from "jszip";
import "./styles.css";

const state = {
  pairs: [],
  sourceTitle: "ChatGPT shared chat",
  sourceUrl: ""
};

const sampleText = `User: Summarize this project idea.

ChatGPT: Build a small local website that turns a shared ChatGPT conversation into a DOCX document.

User: Add navigation.

ChatGPT: Include a table of contents where each prompt-reply pair links to the matching section in the document.`;

document.querySelector("#app").innerHTML = `
  <main class="shell">
    <section class="workspace">
      <aside class="panel controls">
        <div class="brand">
          <div class="mark">D</div>
          <div>
            <h1>Chat DOCX</h1>
            <p>Local converter for shared ChatGPT chats</p>
          </div>
        </div>

        <nav class="projectLinks" aria-label="Project links">
          <a href="https://github.com/Atheicus-Builds/chatgptdownloaderdocx" target="_blank" rel="noreferrer">GitHub repo</a>
          <a href="https://atheicus.com" target="_blank" rel="noreferrer">atheicus.com</a>
        </nav>

        <label class="field">
          <span>Shared chat URL</span>
          <input id="shareUrl" type="url" placeholder="https://chatgpt.com/share/..." autocomplete="off" />
        </label>

        <div class="row">
          <button id="fetchBtn" class="primary" type="button">Fetch share</button>
          <button id="sampleBtn" type="button">Try sample</button>
        </div>

        <div class="divider"></div>

        <label class="field">
          <span>Or paste shared page text / copied chat</span>
          <textarea id="rawInput" spellcheck="false" placeholder="Paste the conversation text here"></textarea>
        </label>

        <div class="row">
          <button id="parseBtn" type="button">Parse pasted chat</button>
          <button id="clearBtn" type="button" aria-label="Clear">Clear</button>
        </div>

        <p id="status" class="status">Ready.</p>
      </aside>

      <section class="document">
        <header class="docHeader">
          <div>
            <span class="eyebrow">Document Preview</span>
            <h2 id="docTitle">No chat loaded</h2>
          </div>
          <button id="downloadBtn" class="primary" type="button" disabled>Download DOCX</button>
        </header>

        <section class="toc" aria-labelledby="tocTitle">
          <h3 id="tocTitle">Table of contents</h3>
          <ol id="tocList"></ol>
        </section>

        <section id="previewList" class="previewList" aria-live="polite">
          <div class="empty">
            <h3>Paste a chat or fetch a public share link.</h3>
            <p>The DOCX will include a clickable table of contents linking to every prompt-reply pair.</p>
          </div>
        </section>
      </section>
    </section>
  </main>
`;

const els = {
  shareUrl: document.querySelector("#shareUrl"),
  rawInput: document.querySelector("#rawInput"),
  fetchBtn: document.querySelector("#fetchBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  parseBtn: document.querySelector("#parseBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  status: document.querySelector("#status"),
  docTitle: document.querySelector("#docTitle"),
  tocList: document.querySelector("#tocList"),
  previewList: document.querySelector("#previewList")
};

els.fetchBtn.addEventListener("click", fetchShare);
els.sampleBtn.addEventListener("click", () => {
  els.rawInput.value = sampleText;
  loadPairs(parsePlainText(sampleText), "Sample ChatGPT conversation", "");
});
els.parseBtn.addEventListener("click", () => {
  loadPairs(parsePlainText(els.rawInput.value), "Pasted ChatGPT conversation", "");
});
els.clearBtn.addEventListener("click", clearAll);
els.downloadBtn.addEventListener("click", downloadDocx);

async function fetchShare() {
  const url = els.shareUrl.value.trim();
  if (!url) {
    setStatus("Paste a public ChatGPT share URL first.", "warn");
    return;
  }

  setBusy(true);
  setStatus("Fetching the shared page locally...");

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/fetch-share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to fetch the share page.");
    }

    const parsed = parseShareHtml(payload.html);
    state.sourceUrl = payload.finalUrl || url;
    loadPairs(parsed.pairs, parsed.title || "ChatGPT shared chat", state.sourceUrl);
  } catch (error) {
    setStatus(`${error.message} You can still paste the copied chat text below.`, "warn");
  } finally {
    setBusy(false);
  }
}

function parseShareHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent?.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
  const compactPairs = parseCompactChatGptData(html);
  if (compactPairs.length) {
    return { title, pairs: compactPairs };
  }

  const scripts = [...doc.querySelectorAll("script")].map((script) => script.textContent || "");
  const candidates = [];

  for (const script of scripts) {
    const decoded = decodeEscapedJson(script);
    collectMessageObjects(decoded, candidates);
  }

  const normalized = candidates
    .map((item) => ({
      role: normalizeRole(item.role || item.author?.role || item.message?.author?.role),
      text: extractText(item)
    }))
    .filter((item) => item.role && item.text && item.text.length > 1);

  const pairs = pairMessages(dedupeMessages(normalized));
  if (pairs.length) {
    return { title, pairs };
  }

  const visibleText = [...doc.querySelectorAll("main, article, [data-message-author-role], body")]
    .map((node) => node.innerText || node.textContent || "")
    .sort((a, b) => b.length - a.length)[0];

  return { title, pairs: parsePlainText(visibleText || doc.body.textContent || "") };
}

function parseCompactChatGptData(html) {
  const payloads = extractReactRouterPayloads(html);
  const messages = [];

  for (const data of payloads) {
    if (!Array.isArray(data)) continue;

    for (const item of data) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;

      const id = getCompactValue(data, item, "id");
      const author = getCompactValue(data, item, "author");
      const content = getCompactValue(data, item, "content");
      const metadata = getCompactValue(data, item, "metadata");
      const recipient = getCompactValue(data, item, "recipient");
      const channel = getCompactValue(data, item, "channel");
      const createTime = getCompactValue(data, item, "create_time") || 0;
      const role = normalizeRole(getCompactValue(data, author, "role"));
      const parts = getCompactValue(data, content, "parts");
      const hidden = getCompactValue(data, metadata, "is_visually_hidden_from_conversation");
      const thinking = getCompactValue(data, metadata, "is_thinking_preamble_message");
      const text = Array.isArray(parts)
        ? cleanText(parts.map((part) => resolveCompactValue(data, part)).filter((part) => typeof part === "string").join("\n\n"))
        : "";

      if (!id || !role || !text || hidden || thinking) continue;
      if (role === "assistant" && recipient && recipient !== "all") continue;
      if (role === "assistant" && channel && channel !== "final") continue;
      messages.push({ role, text, createTime });
    }
  }

  const ordered = messages.sort((a, b) => a.createTime - b.createTime);
  return pairMessages(dedupeMessages(ordered));
}

function extractReactRouterPayloads(html) {
  const payloads = [];
  const enqueueRegex = /enqueue\(("(?:\\.|[^"\\])*")\)/g;
  let match;

  while ((match = enqueueRegex.exec(html))) {
    try {
      const streamText = JSON.parse(match[1]);
      for (const line of streamText.split("\n")) {
        const trimmed = line.trim();
        const jsonStart = trimmed.indexOf("[");
        if (jsonStart === -1) continue;
        payloads.push(JSON.parse(trimmed.slice(jsonStart)));
      }
    } catch {
      // Ignore non-data stream chunks.
    }
  }

  return payloads;
}

function getCompactValue(data, object, keyName) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return undefined;

  for (const [encodedKey, encodedValue] of Object.entries(object)) {
    if (resolveCompactKey(data, encodedKey) === keyName) {
      return resolveCompactValue(data, encodedValue);
    }
  }

  return undefined;
}

function resolveCompactKey(data, key) {
  const ref = /^_(\d+)$/.exec(key);
  return ref ? data[Number(ref[1])] : key;
}

function resolveCompactValue(data, value) {
  if (typeof value === "number") {
    return value >= 0 ? data[value] : undefined;
  }
  return value;
}

function decodeEscapedJson(text) {
  return text
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, '"');
}

function collectMessageObjects(text, out) {
  const roleRegex = /"role"\s*:\s*"(user|assistant|tool)"[\s\S]{0,8000}?(?=("role"\s*:\s*"(?:user|assistant|tool)")|$)/g;
  let match;

  while ((match = roleRegex.exec(text))) {
    const chunk = match[0];
    const role = match[1];
    const parts = [...chunk.matchAll(/"parts"\s*:\s*\[\s*"([\s\S]*?)"\s*\]/g)]
      .map((part) => safeJsonString(part[1]))
      .filter(Boolean);
    const textValue = safeJsonString(chunk.match(/"text"\s*:\s*"([\s\S]*?)"/)?.[1] || "");
    const content = parts.join("\n\n") || textValue;

    if (content) {
      out.push({ role, content });
    }
  }
}

function safeJsonString(value) {
  if (!value) return "";
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`).trim();
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }
}

function extractText(item) {
  if (typeof item.content === "string") return cleanText(item.content);
  if (typeof item.text === "string") return cleanText(item.text);
  if (Array.isArray(item.content?.parts)) return cleanText(item.content.parts.join("\n\n"));
  if (Array.isArray(item.parts)) return cleanText(item.parts.join("\n\n"));
  return "";
}

function normalizeRole(role) {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "";
}

function dedupeMessages(messages) {
  const seen = new Set();
  return messages.filter((message) => {
    const key = `${message.role}:${message.text.slice(0, 240)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePlainText(input) {
  const text = cleanText(input);
  if (!text) return [];

  const markers = /(User|You|Human|Prompt|ChatGPT|Assistant|AI)\s*:\s*/gi;
  const hits = [...text.matchAll(markers)];
  if (hits.length >= 2) {
    const messages = hits.map((hit, index) => {
      const next = hits[index + 1]?.index ?? text.length;
      const roleLabel = hit[1].toLowerCase();
      const role = /chatgpt|assistant|ai/.test(roleLabel) ? "assistant" : "user";
      return {
        role,
        text: cleanText(text.slice(hit.index + hit[0].length, next))
      };
    });
    return pairMessages(messages);
  }

  const blocks = text.split(/\n{2,}/).map(cleanText).filter(Boolean);
  const pairs = [];
  for (let index = 0; index < blocks.length; index += 2) {
    if (blocks[index] && blocks[index + 1]) {
      pairs.push({ prompt: blocks[index], reply: blocks[index + 1] });
    }
  }
  return pairs;
}

function pairMessages(messages) {
  const pairs = [];
  let pendingPrompt = "";

  for (const message of messages) {
    if (message.role === "user") {
      pendingPrompt = message.text;
    } else if (message.role === "assistant" && pendingPrompt) {
      pairs.push({ prompt: pendingPrompt, reply: message.text });
      pendingPrompt = "";
    }
  }

  return pairs;
}

function cleanText(text) {
  return String(text || "")
    .replace(/url([^]+)([^]+)/g, "[$1]($2)")
    .replace(/cite([^]+)/g, "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function loadPairs(pairs, title, sourceUrl) {
  state.pairs = pairs;
  state.sourceTitle = title || "ChatGPT shared chat";
  state.sourceUrl = sourceUrl || "";
  render();

  if (!pairs.length) {
    setStatus("I could not find prompt-reply pairs. Try copying the visible conversation text into the paste box.", "warn");
  } else {
    setStatus(`Loaded ${pairs.length} prompt-reply ${pairs.length === 1 ? "pair" : "pairs"}.`);
  }
}

function render() {
  els.docTitle.textContent = state.pairs.length ? state.sourceTitle : "No chat loaded";
  els.downloadBtn.disabled = state.pairs.length === 0;
  els.tocList.innerHTML = "";
  els.previewList.innerHTML = "";

  if (!state.pairs.length) {
    els.previewList.innerHTML = `
      <div class="empty">
        <h3>Paste a chat or fetch a public share link.</h3>
        <p>The DOCX will include a clickable table of contents linking to every prompt-reply pair.</p>
      </div>`;
    return;
  }

  state.pairs.forEach((pair, index) => {
    const label = makePairTitle(pair.prompt, index);
    const tocItem = document.createElement("li");
    tocItem.innerHTML = `<a href="#pair-${index + 1}">${escapeHtml(label)}</a>`;
    els.tocList.append(tocItem);

    const article = document.createElement("article");
    article.className = "pair";
    article.id = `pair-${index + 1}`;
    article.innerHTML = `
      <div class="pairTop">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <h3>${escapeHtml(label)}</h3>
      </div>
      <div class="message prompt"><strong>Prompt</strong><div class="formatted">${formatPreview(pair.prompt)}</div></div>
      <div class="message reply"><strong>Reply</strong><div class="formatted">${formatPreview(pair.reply)}</div></div>
    `;
    els.previewList.append(article);
  });
}

function makePairTitle(prompt, index) {
  const firstLine = cleanText(prompt).split("\n")[0] || `Prompt ${index + 1}`;
  return `${index + 1}. ${firstLine.slice(0, 90)}${firstLine.length > 90 ? "..." : ""}`;
}

function formatPreview(text) {
  return renderMarkdownHtml(text);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function setBusy(isBusy) {
  els.fetchBtn.disabled = isBusy;
  els.parseBtn.disabled = isBusy;
}

function setStatus(message, type = "") {
  els.status.textContent = message;
  els.status.dataset.type = type;
}

function clearAll() {
  els.shareUrl.value = "";
  els.rawInput.value = "";
  state.pairs = [];
  state.sourceTitle = "ChatGPT shared chat";
  state.sourceUrl = "";
  render();
  setStatus("Ready.");
}

async function downloadDocx() {
  if (!state.pairs.length) return;
  setStatus("Building DOCX...");
  const blob = await createDocx(state);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(state.sourceTitle)}.docx`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("DOCX downloaded with linked table of contents.");
}

function slugify(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "chatgpt-chat";
}

async function createDocx({ pairs, sourceTitle, sourceUrl }) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.folder("_rels").file(".rels", packageRelsXml());
  zip.folder("docProps").file("core.xml", coreXml(sourceTitle));
  zip.folder("docProps").file("app.xml", appXml());
  zip.folder("word").file("document.xml", documentXml({ pairs, sourceTitle, sourceUrl }));
  zip.folder("word").folder("_rels").file("document.xml.rels", documentRelsXml());
  zip.folder("word").file("styles.xml", stylesXml());
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}

function documentXml({ pairs, sourceTitle, sourceUrl }) {
  const body = [];
  body.push(heading(sourceTitle, 1));
  if (sourceUrl) body.push(paragraph([textRun("Source: "), textRun(sourceUrl, { color: "4a6f5d" })]));
  body.push(heading("Table of Contents", 1));

  pairs.forEach((pair, index) => {
    const anchor = `pair_${index + 1}`;
    body.push(hyperlinkParagraph(makePairTitle(pair.prompt, index), anchor));
  });

  pairs.forEach((pair, index) => {
    const bookmark = `pair_${index + 1}`;
    body.push(bookmarkedHeading(makePairTitle(pair.prompt, index), bookmark, index + 1));
    body.push(heading("Prompt", 2));
    body.push(...markdownToWordBlocks(pair.prompt));
    body.push(heading("Reply", 2));
    body.push(...markdownToWordBlocks(pair.reply));
  });

  body.push(`<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`);

  return xmlEnvelope(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}</w:body></w:document>`);
}

function parseMarkdownBlocks(value) {
  const lines = cleanText(value).split("\n");
  const blocks = [];
  let paragraphLines = [];
  let codeLines = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraphLines.length) {
      blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
      paragraphLines = [];
    }
  };

  const flushCode = () => {
    blocks.push({ type: "code", text: codeLines.join("\n") });
    codeLines = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: "heading", level: Math.min(3, headingMatch[1].length), text: headingMatch[2].trim() });
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      blocks.push({ type: "quote", text: quoteMatch[1].trim() });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({ type: "bullet", text: bulletMatch[1].trim() });
      continue;
    }

    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      blocks.push({ type: "number", text: numberedMatch[1].trim() });
      continue;
    }

    paragraphLines.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();
  return blocks;
}

function renderMarkdownHtml(value) {
  return parseMarkdownBlocks(value).map((block) => {
    if (block.type === "rule") return "<hr>";
    const content = inlineMarkdownHtml(block.text);
    if (block.type === "heading") return `<h${block.level}>${content}</h${block.level}>`;
    if (block.type === "bullet") return `<ul><li>${content}</li></ul>`;
    if (block.type === "number") return `<ol><li>${content}</li></ol>`;
    if (block.type === "quote") return `<blockquote>${content}</blockquote>`;
    if (block.type === "code") return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    return `<p>${content.replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

function inlineMarkdownHtml(value) {
  const tokens = parseInlineMarkdown(value);
  return tokens.map((token) => {
    const text = escapeHtml(token.text);
    if (token.type === "bold") return `<strong>${text}</strong>`;
    if (token.type === "italic") return `<em>${text}</em>`;
    if (token.type === "code") return `<code>${text}</code>`;
    if (token.type === "link") return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noreferrer">${text}</a>`;
    return text;
  }).join("");
}

function parseInlineMarkdown(value) {
  const tokens = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: value.slice(lastIndex, match.index) });
    }

    const raw = match[0];
    const link = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (raw.startsWith("**")) tokens.push({ type: "bold", text: raw.slice(2, -2) });
    else if (raw.startsWith("`")) tokens.push({ type: "code", text: raw.slice(1, -1) });
    else if (link) tokens.push({ type: "link", text: link[1], href: link[2] });
    else if (raw.startsWith("*")) tokens.push({ type: "italic", text: raw.slice(1, -1) });

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    tokens.push({ type: "text", text: value.slice(lastIndex) });
  }

  return tokens;
}

function markdownToWordBlocks(value) {
  return parseMarkdownBlocks(value).map((block) => {
    if (block.type === "rule") return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="d8d6ca"/></w:pBdr><w:spacing w:before="160" w:after="160"/></w:pPr></w:p>`;
    if (block.type === "heading") return heading(block.text, block.level);
    if (block.type === "bullet") return paragraph([textRun("• "), ...inlineWordRuns(block.text)], "ListParagraph");
    if (block.type === "number") return paragraph([textRun("1. "), ...inlineWordRuns(block.text)], "ListParagraph");
    if (block.type === "quote") return paragraph(inlineWordRuns(block.text), "Quote");
    if (block.type === "code") return paragraph([textRun(block.text, { font: "Aptos Mono", size: 18 })], "CodeBlock");
    return paragraph(inlineWordRuns(block.text));
  });
}

function inlineWordRuns(value) {
  return parseInlineMarkdown(value).map((token) => {
    if (token.type === "bold") return textRun(token.text, { bold: true });
    if (token.type === "italic") return textRun(token.text, { italic: true });
    if (token.type === "code") return textRun(token.text, { font: "Aptos Mono", shading: "eeeeee" });
    if (token.type === "link") return textRun(token.text, { color: "2f6f55", underline: true });
    return textRun(token.text);
  });
}

function heading(value, level) {
  return paragraph([textRun(value, { bold: true, size: level === 1 ? 32 : 24 })], `Heading${level}`);
}

function bookmarkedHeading(value, bookmark, id) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="${id}" w:name="${bookmark}"/>${textRun(value, { bold: true, size: 28 })}<w:bookmarkEnd w:id="${id}"/></w:p>`;
}

function hyperlinkParagraph(value, anchor) {
  return `<w:p><w:pPr><w:pStyle w:val="TOCLink"/></w:pPr><w:hyperlink w:anchor="${anchor}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${xml(value)}</w:t></w:r></w:hyperlink></w:p>`;
}

function paragraph(runs, style = "") {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

function textRun(value, options = {}) {
  const props = [];
  if (options.bold) props.push("<w:b/>");
  if (options.italic) props.push("<w:i/>");
  if (options.underline) props.push(`<w:u w:val="single"/>`);
  if (options.size) props.push(`<w:sz w:val="${options.size}"/>`);
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`);
  if (options.font) props.push(`<w:rFonts w:ascii="${xml(options.font)}" w:hAnsi="${xml(options.font)}"/>`);
  if (options.shading) props.push(`<w:shd w:fill="${options.shading}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}${String(value).split("\n").map((line, index) => `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${xml(line)}</w:t>`).join("")}</w:r>`;
}

function xml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[char]);
}

function xmlEnvelope(content) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`;
}

function contentTypesXml() {
  return xmlEnvelope(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
}

function packageRelsXml() {
  return xmlEnvelope(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
}

function documentRelsXml() {
  return xmlEnvelope(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
}

function coreXml(title) {
  const now = new Date().toISOString();
  return xmlEnvelope(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Chat DOCX</dc:creator><cp:lastModifiedBy>Chat DOCX</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
}

function appXml() {
  return xmlEnvelope(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chat DOCX</Application></Properties>`);
}

function stylesXml() {
  return xmlEnvelope(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="360" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="260" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420" w:hanging="240"/><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/><w:pBdr><w:left w:val="single" w:sz="8" w:space="12" w:color="c85f37"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="120"/><w:shd w:fill="f1f1ec"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos Mono" w:hAnsi="Aptos Mono"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOCLink"><w:name w:val="TOC Link"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2f6f55"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`);
}
