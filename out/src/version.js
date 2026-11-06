// Which build this is, which one GitHub says is newest, and which one the host (Velora) is serving right now.
// __EMBER_COMMIT__ / __EMBER_REPO__ are injected by vite.config.js at build time.
export const REPO = __EMBER_REPO__;
export const COMMIT = __EMBER_COMMIT__;
export const SHORT = COMMIT === 'dev' ? 'dev' : COMMIT.slice(0, 7);
export const isRelease = COMMIT !== 'dev';
export const repoUrl = `https://github.com/${REPO}`;
export const commitUrl = c => `${repoUrl}/commit/${c}`;

// short and full hashes of the same commit compare equal
export const sameCommit = (a, b) => !!a && !!b && a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

const timeout = ms => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

// newest commit on the repo's main branch, or null when GitHub can't be reached (offline, rate limited)
export async function latestCommit() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-store', signal: timeout(8000) });
    if (!r.ok) return null;
    const sha = (await r.text()).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

// the commit the site is serving right now (version.json sits next to the bundle), or null when it can't be read
export async function servedCommit() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store', signal: timeout(8000) });
    if (!r.ok) return null;
    const c = (await r.json())?.commit;
    return typeof c === 'string' && c !== 'dev' ? c : null;
  } catch { return null; }
}

const INFO_KEY = 'ember_repo_info';
const INFO_TTL = 24 * 60 * 60 * 1000;
const read = () => { try { return JSON.parse(localStorage.getItem(INFO_KEY)); } catch { return null; } };

// license + owner + first year, from GitHub's repo record. Cached for a day; an old cached copy is used when GitHub can't be reached.
// Resolves to { owner, license, since, url } or null when there has never been an answer.
export async function repoInfo() {
  const cached = read();
  if (cached && Date.now() - cached.at < INFO_TTL) return cached.info;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Accept: 'application/vnd.github+json' }, signal: timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const info = {
      owner: d.owner?.login || null,
      license: d.license ? (d.license.spdx_id && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : d.license.name) : null,
      since: d.created_at ? new Date(d.created_at).getUTCFullYear() : null,
      url: d.html_url || repoUrl,
    };
    try { localStorage.setItem(INFO_KEY, JSON.stringify({ at: Date.now(), info })); } catch { /* storage unavailable */ }
    return info;
  } catch { return cached?.info || null; }
}

// "© 2026 Ikelene" / "© 2026-2027 Ikelene"; null when there is not enough to say who owns it
export function copyrightLine(info, now = new Date().getFullYear()) {
  if (!info?.owner) return null;
  const since = info.since && info.since < now ? `${info.since}-${now}` : String(now);
  return `© ${since} ${info.owner}`;
}
