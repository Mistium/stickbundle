// The OriginChats identity Ember boots with. Ember's web build expects a
// Velora token in localStorage; here the account is the Rotur (or first server)
// identity chosen on the OriginChats login screen, and the token is only a
// marker so apiFetch and the store consider the session open.

import { getProfile, setProfile, signOutIdentity } from "./storage.js";

const TOKEN_PREFIX = "originchats:";

export function profile() {
  return getProfile();
}

export function hasIdentity() {
  return !!getProfile();
}

// Make Ember's web client treat this OriginChats account as signed in.
export function ensureToken() {
  const p = getProfile();
  if (!p) {
    return false;
  }
  const name = String(p.username || "you");
  try {
    localStorage.setItem("bonfire_token", `${TOKEN_PREFIX}${p.id || name}`);
    localStorage.setItem("bonfire_user", name);
  } catch {
    // private mode: the app still works for this page load
  }
  return true;
}

// Ember's profile shapes (account + profile) for the OriginChats identity.
export function meForEmber(p = getProfile()) {
  if (!p) {
    return null;
  }
  return {
    account: {
      id: p.id != null ? String(p.id) : String(p.username || "you"),
      username: p.username || "you",
      rank: null,
      created: null,
      badges: [],
      onboarded: true,
    },
    profile: {
      pfp: p.pfp || null,
      color: null,
      banner: p.banner || null,
      bio: p.bio || "",
    },
    bio_limit: 0,
  };
}

export function setOcProfile(next) {
  setProfile(next);
  ensureToken();
}

// Ember's sign out / "log in again": forget the OriginChats identity and let
// the login screen decide what comes next. Servers stay in the list.
export function signOutOriginChats() {
  signOutIdentity();
  try {
    localStorage.removeItem("bonfire_token");
    localStorage.removeItem("bonfire_user");
    localStorage.removeItem("bonfire_me_cache_v2");
  } catch {
    // fine
  }
}
