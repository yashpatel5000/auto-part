import { Router } from "express";
import connectDB from "../../../db.js";

const router = Router();
const COLLECTIONS = ["rrr-parts", "shopify-parts"];
const PAGE_SIZE = 50;

let db;
const getDB = async () => {
  if (!db) db = await connectDB();
  return db;
};

router.get("/db-view", async (req, res) => {
  try {
    const database = await getDB();
    const collection = COLLECTIONS.includes(req.query.collection)
      ? req.query.collection
      : COLLECTIONS[0];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const search = req.query.search?.trim() || "";

    const filter = search
      ? { $or: [{ id: isNaN(search) ? undefined : parseInt(search) }, { name: { $regex: search, $options: "i" } }, { manufacturer_code: { $regex: search, $options: "i" } }].filter(Boolean) }
      : {};

    const total = await database.collection(collection).countDocuments(filter);
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const docs = await database
      .collection(collection)
      .find(filter)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray();

    const keys = docs.length
      ? [...new Set(docs.flatMap((d) => Object.keys(d)))]
      : [];

    const truncate = (val, max = 60) => {
      if (val === null || val === undefined) return "";
      if (Array.isArray(val)) return `[Array(${val.length})]`;
      if (typeof val === "object") return JSON.stringify(val).slice(0, max);
      const str = String(val);
      return str.length > max ? str.slice(0, max - 1) + "…" : str;
    };

    const escape = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const pageUrl = (p) => {
      const params = new URLSearchParams({ collection, page: p, search });
      return `/db-view?${params}`;
    };

    const paginationBtns = () => {
      const btns = [];
      const prev = page > 1 ? `<a href="${pageUrl(page - 1)}" class="btn">← Prev</a>` : `<span class="btn disabled">← Prev</span>`;
      const next = page < totalPages ? `<a href="${pageUrl(page + 1)}" class="btn">Next →</a>` : `<span class="btn disabled">Next →</span>`;

      let start = Math.max(1, page - 2);
      let end = Math.min(totalPages, page + 2);
      if (end - start < 4) {
        start = Math.max(1, end - 4);
        end = Math.min(totalPages, start + 4);
      }

      btns.push(prev);
      if (start > 1) btns.push(`<a href="${pageUrl(1)}" class="btn">1</a>`, start > 2 ? `<span class="ellipsis">…</span>` : "");
      for (let i = start; i <= end; i++) {
        btns.push(`<a href="${pageUrl(i)}" class="btn${i === page ? " active" : ""}">${i}</a>`);
      }
      if (end < totalPages) btns.push(end < totalPages - 1 ? `<span class="ellipsis">…</span>` : "", `<a href="${pageUrl(totalPages)}" class="btn">${totalPages}</a>`);
      btns.push(next);
      return btns.join(" ");
    };

    const collectionTabs = COLLECTIONS.map(
      (c) => `<a href="/db-view?collection=${c}&page=1&search=${encodeURIComponent(search)}" class="tab${c === collection ? " active" : ""}">${c}</a>`
    ).join("");

    const tableRows = docs
      .map(
        (doc) =>
          `<tr>${keys.map((k) => `<td title="${escape(doc[k])}">${escape(truncate(doc[k]))}</td>`).join("")}</tr>`
      )
      .join("");

    const tableHeaders = keys.map((k) => `<th>${escape(k)}</th>`).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DB Viewer</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    header { background: #1e293b; padding: 16px 24px; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    header h1 { font-size: 1.25rem; font-weight: 700; color: #38bdf8; }
    .badge { background: #0ea5e9; color: #fff; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; }
    .tabs { display: flex; gap: 8px; padding: 16px 24px 0; }
    .tab { padding: 8px 18px; border-radius: 8px 8px 0 0; background: #1e293b; color: #94a3b8; text-decoration: none; font-size: 0.875rem; border: 1px solid #334155; border-bottom: none; }
    .tab.active { background: #0f172a; color: #38bdf8; border-color: #38bdf8; }
    .toolbar { padding: 12px 24px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .toolbar form { display: flex; gap: 8px; }
    .toolbar input { padding: 6px 12px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; width: 260px; }
    .toolbar button { padding: 6px 14px; border-radius: 6px; border: none; background: #0ea5e9; color: #fff; cursor: pointer; font-size: 0.875rem; }
    .toolbar button:hover { background: #38bdf8; }
    .info { margin-left: auto; font-size: 0.8rem; color: #64748b; }
    .table-wrap { overflow-x: auto; padding: 0 24px 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin-top: 0; }
    thead { position: sticky; top: 0; background: #1e293b; z-index: 10; }
    th { padding: 10px 12px; text-align: left; color: #38bdf8; font-weight: 600; border-bottom: 2px solid #334155; white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    tr:hover td { background: #1e293b; }
    tr:nth-child(even) td { background: #111827; }
    tr:nth-child(even):hover td { background: #1e293b; }
    .pagination { display: flex; align-items: center; gap: 6px; padding: 16px 24px; flex-wrap: wrap; }
    .btn { padding: 6px 12px; border-radius: 6px; background: #1e293b; color: #94a3b8; text-decoration: none; font-size: 0.8rem; border: 1px solid #334155; }
    .btn.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
    .btn.disabled { opacity: 0.4; pointer-events: none; }
    .btn:hover:not(.disabled):not(.active) { background: #334155; color: #e2e8f0; }
    .ellipsis { color: #475569; padding: 0 4px; }
    .empty { padding: 40px 24px; text-align: center; color: #475569; }
  </style>
</head>
<body>
  <header>
    <h1>🗄️ DB Viewer</h1>
    <span class="badge">${escape(collection)}</span>
    <span class="badge" style="background:#334155;color:#94a3b8">${total.toLocaleString()} docs</span>
  </header>

  <div class="tabs">${collectionTabs}</div>

  <div class="toolbar">
    <form method="GET" action="/db-view">
      <input type="hidden" name="collection" value="${escape(collection)}"/>
      <input type="hidden" name="page" value="1"/>
      <input type="text" name="search" placeholder="Search by name / code / id…" value="${escape(search)}"/>
      <button type="submit">Search</button>
      ${search ? `<a href="/db-view?collection=${escape(collection)}" class="btn">Clear</a>` : ""}
    </form>
    <span class="info">Page ${page} of ${totalPages} &nbsp;|&nbsp; Showing ${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}</span>
  </div>

  <div class="pagination">${paginationBtns()}</div>

  <div class="table-wrap">
    ${
      docs.length
        ? `<table><thead><tr>${tableHeaders}</tr></thead><tbody>${tableRows}</tbody></table>`
        : `<div class="empty">No documents found${search ? ` for "${escape(search)}"` : ""}.</div>`
    }
  </div>

  <div class="pagination">${paginationBtns()}</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre style="color:red">Error: ${err.message}\n${err.stack}</pre>`);
  }
});

export default router;
