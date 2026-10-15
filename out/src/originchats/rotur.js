// Rotur sign-in through rotur-sdk, and the validators that prove that
// identity to one OriginChats connection.
//
// With a Rotur app ID (built in with ROTUR_APP_ID=app_… ./scripts/build.sh)
// the login button uses Sign in with Rotur: the app has to list this site's
// origin as a redirect URI at rotur.dev/me/developer. Without one it uses the
// SDK's rotur.dev/auth flow, which hands back a token scoped to making
// validators.

import { Rotur, iconToSvg, performAuth } from "rotur-sdk";
import { getProfile, getRoturToken, setProfile, setRoturToken } from "./storage.js";

// Replaced at build time by `--define`; empty means no app is registered.
const APP_ID = typeof __ROTUR_APP_ID__ !== "undefined" ? __ROTUR_APP_ID__ : "";
// validators:generate signs you in to servers; signing:private lets the SDK
// sign your messages with your Rotur identity key.
const PERMISSIONS = ["validators:generate", "signing:private"];

let client = null;

function roturClient() {
  if (client) {
    return client;
  }
  if (APP_ID) {
    // Also finishes a full-page sign-in that just came back from Rotur.
    client = new Rotur({ app: APP_ID, permissions: PERMISSIONS });
  } else {
    const token = getRoturToken();
    client = token ? new Rotur({ token }) : null;
  }
  return client;
}

function toProfile(u) {
  const username = u.username || u.name;
  return {
    kind: "rotur",
    id: String(u.id || u["sys.id"] || username),
    username,
    pfp: u.avatar || u.pfp || roturAvatar(username),
    banner: `https://avatars.rotur.dev/.banners/${encodeURIComponent(username)}`,
    bio: u.bio || "",
  };
}

// Opens Rotur's sign-in window. Call it from a click so the popup isn't blocked.
async function signInWithRotur({ signal } = {}) {
  let profile;
  if (APP_ID) {
    profile = toProfile(await roturClient().signIn({ signal }));
  } else {
    const { token } = await performAuth({ requires: PERMISSIONS, signal });
    setRoturToken(token);
    client = new Rotur({ token });
    profile = toProfile(await client.me.get());
  }
  setProfile(profile);
  return profile;
}

// Advanced: sign in with an account key pasted by hand.
async function signInWithKey(token) {
  const c = new Rotur({ token });
  const profile = toProfile(await c.me.get());
  setRoturToken(token);
  client = c;
  setProfile(profile);
  return profile;
}

// The Rotur account this browser is signed in as, or null.
function roturAccount() {
  const p = getProfile();
  return p && p.kind === "rotur" ? p.username : null;
}

async function roturValidator(key) {
  const c = roturClient();
  if (!c) {
    throw Object.assign(new Error("Not signed in to Rotur"), { status: 401 });
  }
  const { validator } = await c.validators.generate(key);
  if (!validator) {
    throw new Error("rotur_no_validator");
  }
  return validator;
}

async function roturSignOut() {
  const c = client || (APP_ID ? roturClient() : null);
  client = null;
  setRoturToken(null);
  if (c && APP_ID) {
    await c.signOut().catch(() => {});
  }
}

const roturAvatar = (username) =>
  `https://avatars.rotur.dev/${encodeURIComponent(username)}`;

const roturUsesApp = () => !!APP_ID;

export {
  roturAccount,
  roturAvatar,
  roturClient,
  roturSignOut,
  roturUsesApp,
  roturValidator,
  signInWithKey,
  signInWithRotur,
};

// ---------------------------------------------------------------- profiles

const profileCache = new Map(); // lowercased username -> { at, promise }

// A Rotur profile (GET /v2/users/<name>, public), cached for five minutes.
// Resolves to null when there's no such account.
function roturProfile(username) {
  const key = String(username || "").toLowerCase();
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < 300000) {
    return hit.promise;
  }
  const promise = fetch(`https://api.rotur.dev/v2/users/${encodeURIComponent(username)}?include_posts=0`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => (p && p.username ? p : null))
    .catch(() => {
      profileCache.delete(key);
      return null;
    });
  profileCache.set(key, { at: Date.now(), promise });
  return promise;
}

// Rotur's Discord-style activities as Velora's activity cards.
const ACTIVITY_TYPES = { 0: "playing", 1: "streaming", 2: "listening", 3: "watching", 4: "custom", 5: "competing" };

function roturActivities(status) {
  const list = (status && Array.isArray(status.activities) && status.activities) || [];
  const now = Date.now();
  return list.map((a) => {
    const media = a.media || {};
    const ts = a.timestamps || {};
    const spotify = a.application_id === "spotify" || a.id === "spotify";
    const start = Number(ts.start || media.start || a.start_time) || undefined;
    const end = Number(ts.end || media.end) || undefined;
    const assets = a.assets || {};
    return {
      type: ACTIVITY_TYPES[a.type] || (typeof a.type === "string" ? a.type : "playing"),
      app: spotify ? "Spotify" : (a.application && a.application.name) || undefined,
      name: spotify ? media.title || a.details || a.name : a.name || (a.application && a.application.name) || "",
      details: spotify ? (media.artist ? `by ${media.artist}` : a.state) : a.details,
      state: spotify ? (media.album ? `on ${media.album}` : undefined) : a.state,
      image: assets.large_image || a.image || undefined,
      url: a.url || (a.application && a.application.url) || undefined,
      since: start,
      duration: start && end ? end - start : undefined,
      progress: start && end ? Math.max(0, now - start) : undefined,
      progress_at: start && end ? now : undefined,
      platform: a.platform,
    };
  });
}

// Rotur badges are drawn in Rotur's icon language; the SDK turns them into SVG.
function badgeIcon(icon) {
  try {
    // The official client's scale: icons drawn at 2x in a 40-unit box.
    const svg = iconToSvg(String(icon || ""), { size: 2, viewSize: 20 });
    return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  } catch {
    return null;
  }
}

// The fields Velora's profile cards read, from a Rotur profile.
function roturToVelora(p) {
  const theme = p.theme || {};
  return {
    id: p.id,
    username: p.username,
    display_name: p.display_name && p.display_name !== p.username ? p.display_name : null,
    pfp_url: p.pfp || roturAvatar(p.username),
    banner_url: p.banner || null,
    bio: p.bio || "",
    pronouns: p.pronouns || "",
    created_at: Number(p.created) || null,
    private: !!p.private,
    color: /^#[0-9a-f]{6}$/i.test(theme.accent || "") ? theme.accent : null,
    rank: null,
    followers: p.followers,
    following: p.following,
    subscription: p.subscription && p.subscription !== "Free" ? p.subscription : null,
    badges: (Array.isArray(p.badges) ? p.badges : [])
      .map((b) => ({ name: b.name || b.id, description: b.description, icon_url: badgeIcon(b.icon) }))
      .filter((b) => b.icon_url),
    connections: (Array.isArray(p.connections) ? p.connections : []).map((c) => ({
      provider: c.provider,
      name: c.username,
      url: c.profile_url,
    })),
    activities: roturActivities(p.status),
    presence: p.status && p.status.presence,
    custom: (p.status && p.status.status) || null,
  };
}

export { roturActivities, roturProfile, roturToVelora };
