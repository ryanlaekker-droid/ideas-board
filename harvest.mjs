// Ground Truth harvester.
// Runs in GitHub Actions. Claude proposes search terms, we query the free
// no-key APIs, Claude then tags the best results with a "possible build" angle,
// and the whole lot is written to data/ideas.json for the static page to read.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const OUT = "data/ideas.json";
const MODEL = "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;           // provided free by Actions
const UA = "ground-truth-ideas-board/1.0";
const KEEP = 400;                                     // max items retained on the board

const DOMAIN = `open-source tooling, models and data visualisation for
contaminated land assessment, geoenvironmental site investigation, soil and
groundwater contamination, fate-and-transport modelling, and environmental
data visualisation`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const id = url => createHash("sha1").update(url).digest("hex").slice(0, 12);
const clip = (s, n) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/* ------------------------------------------------------------------ Claude */
async function claude(prompt, maxTokens = 2000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = Math.min(...[clean.indexOf("["), clean.indexOf("{")].filter(i => i >= 0));
  return JSON.parse(clean.slice(start));
}

async function pickKeywords(previous) {
  const prompt = `You help scout ideas for buildable software tools in this domain:
${DOMAIN}

These search terms have been used on recent runs — propose genuinely different ones:
${previous.slice(0, 40).join(", ") || "(none yet)"}

Return exactly 8 search queries as a JSON array of strings. Each should be 2-5 words,
usable verbatim against GitHub code search and Hacker News. Mix:
- specific technical methods (e.g. a named model, algorithm or standard)
- practitioner pain points that software could remove
- adjacent fields whose tooling could transfer in

Respond with the JSON array only. No preamble, no markdown fences.`;
  return parseJSON(await claude(prompt, 500)).slice(0, 8);
}

async function addAngles(items) {
  const slice = items.slice(0, 45);
  const list = slice.map((it, i) =>
    `${i}. [${it.source}] ${it.title} — ${clip(it.summary, 160)}`).join("\n");
  const prompt = `Below are things found while scouting for buildable tool ideas in:
${DOMAIN}

${list}

For each numbered entry, write one sentence naming a concrete tool a competent
practitioner-developer could actually build off the back of it. Be specific about
what it would do — not "a platform for X". If an entry suggests nothing worth
building, set "angle" to null.

Return a JSON array of {"i": <number>, "angle": <string or null>}. JSON only.`;
  try {
    const angles = parseJSON(await claude(prompt, 4000));
    for (const a of angles) if (slice[a.i] && a.angle) slice[a.i].angle = a.angle;
  } catch (e) {
    console.warn("angle pass failed, continuing without:", e.message);
  }
  return items;
}

/* ----------------------------------------------------------------- sources */
async function github(q) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=6`;
  const headers = { "user-agent": UA, accept: "application/vnd.github+json" };
  if (GH_TOKEN) headers.authorization = `Bearer ${GH_TOKEN}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`github ${r.status}`);
  const j = await r.json();
  return (j.items || []).map(x => ({
    id: id(x.html_url), source: "github", url: x.html_url,
    title: x.full_name, summary: clip(x.description, 220),
    stat: `${x.stargazers_count.toLocaleString()} stars · ${x.language || "n/a"}`,
    tags: [q]
  }));
}

async function hn(q) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=6`;
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`hn ${r.status}`);
  const j = await r.json();
  return (j.hits || [])
    .filter(h => h.url && h.points >= 5)
    .map(h => ({
      id: id(h.url), source: "hn", url: h.url,
      title: clip(h.title, 120), summary: "",
      stat: `${h.points} points · ${new Date(h.created_at).getFullYear()}`,
      tags: [q]
    }));
}

async function reddit(q) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=year&limit=6`;
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`reddit ${r.status}`);
  const j = await r.json();
  return (j.data?.children || []).map(c => c.data).filter(d => d.score >= 3).map(d => ({
    id: id("https://reddit.com" + d.permalink), source: "reddit",
    url: "https://reddit.com" + d.permalink,
    title: clip(d.title, 120), summary: clip(d.selftext, 200),
    stat: `r/${d.subreddit} · ${d.score} · ${d.num_comments} comments`,
    tags: [q]
  }));
}

async function arxiv(q) {
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&sortBy=submittedDate&max_results=4`;
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`arxiv ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    const pick = t => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [, ""])[1].trim();
    const link = (e.match(/<id>([\s\S]*?)<\/id>/) || [, ""])[1].trim();
    if (!link) return null;
    return {
      id: id(link), source: "arxiv", url: link,
      title: clip(pick("title"), 120), summary: clip(pick("summary"), 220),
      stat: pick("published").slice(0, 10), tags: [q]
    };
  }).filter(Boolean);
}

/* -------------------------------------------------------------------- main */
async function main() {
  if (!KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  let prev = { items: [], keywordHistory: [] };
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch { }
  prev.items ||= []; prev.keywordHistory ||= [];
  prev.items = prev.items.filter(i => !i.demo);   // clear the shipped sample cards

  const keywords = await pickKeywords(prev.keywordHistory);
  console.log("keywords:", keywords.join(" | "));

  const found = [];
  for (const q of keywords) {
    for (const [name, fn] of [["github", github], ["hn", hn], ["reddit", reddit], ["arxiv", arxiv]]) {
      try { found.push(...await fn(q)); }
      catch (e) { console.warn(`  ${name} "${q}" — ${e.message}`); }
      await sleep(1200);   // stay well inside every rate limit
    }
  }

  // merge query tags for duplicates, drop anything already on the board
  const byId = new Map();
  for (const it of found) {
    const hit = byId.get(it.id);
    if (hit) { hit.tags = [...new Set([...hit.tags, ...it.tags])]; }
    else byId.set(it.id, it);
  }
  const seen = new Set(prev.items.map(i => i.id));
  let fresh = [...byId.values()].filter(i => !seen.has(i.id));
  console.log(`${found.length} raw → ${fresh.length} new`);

  if (fresh.length) fresh = await addAngles(fresh);
  fresh.forEach(i => i.found = new Date().toISOString());

  const items = [...fresh, ...prev.items].slice(0, KEEP);
  const keywordHistory = [...keywords, ...prev.keywordHistory].slice(0, 120);

  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    keywords, keywordHistory, items
  }, null, 1));
  console.log(`wrote ${items.length} items`);
}

main().catch(e => { console.error(e); process.exit(1); });
