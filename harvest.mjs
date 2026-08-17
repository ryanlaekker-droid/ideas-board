// Ground Truth harvester — free version, no API keys of any kind.
//
// Reads search terms from keywords.txt, takes the next 8 in the rotation,
// queries GitHub / Hacker News / Reddit / arXiv, and writes ideas.json for
// the page to read. Nothing here costs money.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const OUT = "ideas.json";
const TERMS_FILE = "keywords.txt";
const PER_RUN = 8;          // how many search terms to use each run
const KEEP = 400;           // how many findings to keep on the board
const UA = "ground-truth-ideas-board/1.0";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const id = url => createHash("sha1").update(url).digest("hex").slice(0, 12);
const clip = (s, n) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/* ----------------------------------------------------------------- sources */
async function github(q) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=6`;
  const headers = { "user-agent": UA, accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
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
  return (j.hits || []).filter(h => h.url && h.points >= 5).map(h => ({
    id: id(h.url), source: "hn", url: h.url,
    title: clip(h.title, 120), summary: "",
    stat: `${h.points} points · ${new Date(h.created_at).getFullYear()}`,
    tags: [q]
  }));
}

// Crossref abstracts arrive as JATS XML; strip the tags out.
function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function papers(q) {
  const params = new URLSearchParams({
    "query.bibliographic": q,
    filter: "from-pub-date:2018-01-01,type:journal-article",
    rows: "5",
    select: "DOI,title,abstract,container-title,published,is-referenced-by-count"
  });
  const r = await fetch(`https://api.crossref.org/works?${params}`, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`crossref ${r.status}`);
  const j = await r.json();
  return (j.message?.items || []).map(w => {
    if (!w.DOI) return null;
    const link = `https://doi.org/${w.DOI}`;
    const year = w.published?.["date-parts"]?.[0]?.[0] ?? "—";
    const journal = (w["container-title"] || [])[0] || "journal article";
    return {
      id: id(link), source: "crossref", url: link,
      title: clip((w.title || [])[0], 120),
      summary: clip(stripTags(w.abstract), 220),
      stat: `${clip(journal, 40)} · ${year} · ${w["is-referenced-by-count"] ?? 0} cites`,
      tags: [q]
    };
  }).filter(i => i && i.title);
}

/* -------------------------------------------------------------------- main */
async function main() {
  const pool = (await readFile(TERMS_FILE, "utf8"))
    .split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));
  if (!pool.length) throw new Error(`${TERMS_FILE} has no search terms in it`);

  let prev = { items: [], cursor: 0 };
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch { }
  prev.items = (prev.items || [])
    .filter(i => !i.demo)                 // clear shipped samples
    .filter(i => !["arxiv", "openalex"].includes(i.source));  // clear the bad paper runs
  const cursor = Number(prev.cursor) || 0;

  // take the next PER_RUN terms, wrapping around the end of the list
  const keywords = Array.from({ length: Math.min(PER_RUN, pool.length) },
    (_, i) => pool[(cursor + i) % pool.length]);
  console.log(`terms ${cursor}-${cursor + keywords.length - 1} of ${pool.length}:`);
  console.log("  " + keywords.join(" | "));

  const found = [];
  for (const q of keywords) {
    for (const [name, fn] of [["github", github], ["hn", hn], ["papers", papers]]) {
      try { found.push(...await fn(q)); }
      catch (e) { console.warn(`  ${name} "${q}" - ${e.message}`); }
      await sleep(1200);   // stay well inside every rate limit
    }
  }

  // merge duplicate findings, then drop anything already on the board
  const byId = new Map();
  for (const it of found) {
    const hit = byId.get(it.id);
    if (hit) hit.tags = [...new Set([...hit.tags, ...it.tags])];
    else byId.set(it.id, it);
  }
  const seen = new Set(prev.items.map(i => i.id));
  const fresh = [...byId.values()].filter(i => !seen.has(i.id));
  fresh.forEach(i => i.found = new Date().toISOString());
  console.log(`${found.length} results -> ${fresh.length} new`);

  await writeFile(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    keywords,
    cursor: (cursor + keywords.length) % pool.length,
    items: [...fresh, ...prev.items].slice(0, KEEP)
  }, null, 1));
  console.log("done");
}

main().catch(e => { console.error(e); process.exit(1); });
