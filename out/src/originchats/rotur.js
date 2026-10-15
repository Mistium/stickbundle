// Rotur sign-in through rotur-sdk, and the validators that prove that
// identity to one OriginChats connection.
//
// With a Rotur app ID (built in with ROTUR_APP_ID=app_… ./scripts/build.sh)
// the login button uses Sign in with Rotur: the app has to list this site's
// origin as a redirect URI at rotur.dev/me/developer. Without one it uses the
// SDK's rotur.dev/auth flow, which hands back a token scoped to making
// validators.

import { Rotur, performAuth } from "rotur-sdk";
import { getProfile, getRoturToken, setProfile, setRoturToken } from "./storage.js";

// Replaced at build time by `--define`; empty means no app is registered.
const APP_ID = typeof __ROTUR_APP_ID__ !== "undefined" ? __ROTUR_APP_ID__ : "";
const PERMISSIONS = ["validators:generate"];

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
