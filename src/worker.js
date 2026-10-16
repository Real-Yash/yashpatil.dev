const json = (payload, status = 200) =>
  Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const STATS_ROW_ID = 1;
const TOKENMAXXING_URL = "https://tokenmaxxing.sh/real-yash";
// Heuristic: GitHub's languages API reports bytes of code, not lines.
// ~40 bytes/line is a middle-ground estimate; treated as an estimate, not a cloc count.
const BYTES_PER_LINE = 40;
// If cached stats are older than this, a request to /api/stats triggers a
// background refresh (cron remains the primary updater).
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;

const githubUser = (env) => env.GITHUB_USERNAME || "Real-Yash";

const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");

function fmtLoc(codeBytes) {
  const lines = Math.round(Number(codeBytes || 0) / BYTES_PER_LINE);
  if (lines >= 1_000_000) return `${(lines / 1_000_000).toFixed(2)}M`;
  if (lines >= 1000) return `${(lines / 1000).toFixed(1)}K`;
  return String(lines);
}

function monthLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---- D1 stat store (single row, id = 1) ----

async function readStats(env) {
  try {
    const row = await env.CONTACTS
      .prepare("SELECT payload, updated_at FROM site_stats WHERE id = ?")
      .bind(STATS_ROW_ID)
      .first();
    if (!row) return null;
    return { ...JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch (error) {
    console.error("readStats failed", error);
    return null;
  }
}

async function writeStats(env, stats) {
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify({ ...stats, updatedAt });
  await env.CONTACTS
    .prepare(
      "INSERT INTO site_stats (id, payload, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    )
    .bind(STATS_ROW_ID, payload, updatedAt)
    .run();
  return { ...stats, updatedAt };
}

function isStale(stats) {
  if (!stats?.updatedAt) return true;
  return Date.now() - new Date(stats.updatedAt).getTime() > STALE_AFTER_MS;
}

// ---- tokenmaxxing.sh (server-rendered page, no public API) ----

async function fetchTokenmaxxing() {
  const res = await fetch(TOKENMAXXING_URL, {
    headers: {
      "User-Agent": "yashpatil.dev-stats-worker",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`tokenmaxxing HTTP ${res.status}`);
  const html = await res.text();

  // Primary: <meta property="og:description" content="real-yash has spent $1,228 across 123 active days and 3.49B tokens.">
  let spend = html.match(/has spent\s+\$([\d,]+)/i)?.[1] || null;
  let tokens = html.match(/([\d.]+[BMK]?)\s+tokens/i)?.[1] || null;

  // Fallback: rendered stat cards ("Total spend" … "$1,228", "Total tokens" … "3.49B")
  if (!spend) {
    spend =
      html.match(/Total spend<[^>]*>\s*<[^>]*>\s*\$([\d,]+)/i)?.[1] ||
      html.match(/Total spend.*?\$([\d,]+)/is)?.[1] ||
      null;
  }
  if (!tokens) {
    tokens = html.match(/Total tokens.*?([\d.]+[BMK])/is)?.[1] || null;
  }
  if (!spend && !tokens) throw new Error("tokenmaxxing parse failed");
  return {
    ...(spend ? { spend: `$${spend}` } : {}),
    ...(tokens ? { tokens } : {}),
  };
}

// ---- GitHub ----

function ghHeaders(env) {
  const headers = {
    "User-Agent": "yashpatil.dev-stats-worker",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function ghJson(url, env) {
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    throw new Error("github rate limited");
  }
  if (!res.ok) throw new Error(`github HTTP ${res.status} for ${url}`);
  return res.json();
}

// All owned repos (private included when GITHUB_TOKEN is set), forks excluded
// so forked monsters like neovim/neovim don't pollute commits/LOC.
async function listOwnedRepos(env) {
  const user = githubUser(env);
  const base = env.GITHUB_TOKEN
    ? "https://api.github.com/user/repos?per_page=100&type=owner"
    : `https://api.github.com/users/${user}/repos?per_page=100&type=owner`;
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await ghJson(`${base}&page=${page}`, env);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork);
}

async function fetchGitHub(env) {
  const user = githubUser(env);
  const repos = await listOwnedRepos(env);

  const [perRepo, prsTotal] = await Promise.all([
    Promise.all(
      repos.map(async (repo) => {
        const full = repo.full_name;
        const [langs, contributors] = await Promise.all([
          ghJson(`https://api.github.com/repos/${full}/languages`, env).catch(() => ({})),
          ghJson(`https://api.github.com/repos/${full}/contributors?per_page=100`, env).catch(
            () => [],
          ),
        ]);
        const codeBytes = Object.values(langs).reduce(
          (sum, v) => sum + (Number(v) || 0),
          0,
        );
        const mine = Array.isArray(contributors)
          ? contributors.find(
              (c) => String(c.login || "").toLowerCase() === user.toLowerCase(),
            )
          : null;
        return {
          commits: Number(mine?.contributions) || 0,
          codeBytes,
          forks: Number(repo.forks_count) || 0,
        };
      }),
    ),
    ghJson(
      `https://api.github.com/search/issues?q=author:${user}+type:pr&per_page=1`,
      env,
    )
      .then((d) => Number(d.total_count) || 0)
      .catch(() => null),
  ]);

  const result = {
    repos: repos.length,
    commits: perRepo.reduce((s, r) => s + r.commits, 0),
    forks: perRepo.reduce((s, r) => s + r.forks, 0),
    codeBytes: perRepo.reduce((s, r) => s + r.codeBytes, 0),
  };
  if (prsTotal !== null) result.prs = prsTotal;
  return result;
}

// ---- orchestrator: merge fresh sources over previous, never blank on failure ----

async function updateStats(env) {
  const prev = await readStats(env);
  const [tm, gh] = await Promise.allSettled([fetchTokenmaxxing(), fetchGitHub(env)]);

  const next = { ...(prev || {}) };
  if (tm.status === "fulfilled") Object.assign(next, tm.value);
  else console.error(`tokenmaxxing update failed: ${tm.reason?.message || tm.reason}`);

  if (gh.status === "fulfilled") {
    const { repos, commits, prs, forks, codeBytes } = gh.value;
    next.repos = repos;
    next.commits = commits;
    if (prs !== undefined) next.prs = prs;
    next.forks = forks;
    next.codeBytes = codeBytes;
    next.loc = fmtLoc(codeBytes);
  } else {
    console.error(`github update failed: ${gh.reason?.message || gh.reason}`);
  }

  if (!next.tokens && next.repos === undefined) {
    // First run and everything failed: don't write an empty row.
    throw new Error("no stats available (all sources failed)");
  }
  next.month = monthLabel(new Date().toISOString());
  if (prev) {
    // Keep last-known values for any source that failed this run.
    for (const k of ["tokens", "spend", "repos", "commits", "prs", "forks", "loc", "codeBytes", "month"]) {
      if (next[k] === undefined && prev[k] !== undefined) next[k] = prev[k];
    }
  }
  return writeStats(env, next);
}

async function handleStats(request, env, ctx) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  let stats = await readStats(env);
  if (!stats) {
    try {
      stats = await updateStats(env);
    } catch (error) {
      console.error("initial stats build failed", error);
      return json({ error: "Stats are not ready yet. Try again shortly." }, 503);
    }
  } else if (isStale(stats)) {
    ctx?.waitUntil?.(updateStats(env).catch((e) => console.error("bg refresh failed", e)));
  }
  const { codeBytes: _drop, ...publicStats } = stats;
  return Response.json(publicStats, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}

async function handleContact(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const message = String(form.get("message") || "").trim();
    const honeypot = String(form.get("website") || "").trim();

    if (honeypot) return json({ ok: true });
    if (!name || !email || !message || name.length > 120 || email.length > 254 || message.length > 5000) {
      return json({ error: "Please provide a valid name, email address, and message." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Please provide a valid email address." }, 400);
    }

    await env.CONTACTS
      .prepare("INSERT INTO contact_messages (name, email, message, created_at) VALUES (?, ?, ?, ?)")
      .bind(name, email, message, new Date().toISOString())
      .run();

    return json({ ok: true, message: "Your note has been pinned. I’ll get back to you soon!" });
  } catch (error) {
    console.error("Contact form submission failed", error);
    return json({ error: "Unable to send your message right now. Please try again shortly." }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats") return handleStats(request, env, ctx);
    if (url.pathname === "/api/contact") return handleContact(request, env);
    return env.ASSETS.fetch(request);
  },

  // Cron trigger (see wrangler.jsonc `triggers.crons`): daily 00:00 UTC = 05:30 IST.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      updateStats(env).catch((error) => console.error("scheduled stats update failed", error)),
    );
  },
};
