// The few Rotur calls the client needs: who the account key belongs to, and
// validators that prove that identity to one OriginChats connection.

const ROTUR_API = "https://api.rotur.dev";

async function roturRequest(method, path, token, body) {
  const res = await fetch(`${ROTUR_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `rotur_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// The signed-in account, trimmed to what the UI shows.
async function roturMe(token) {
  const me = await roturRequest("GET", "/v2/me", token);
  const username = me.username || me.name;
  if (!username) {
    throw new Error("rotur_no_account");
  }
  return {
    id: String(me["sys.id"] || me.id || username),
    username,
    pfp: me.pfp || `https://avatars.rotur.dev/${encodeURIComponent(username)}`,
    banner: `https://avatars.rotur.dev/.banners/${encodeURIComponent(username)}`,
    bio: me.bio || "",
  };
}

async function roturValidator(token, key) {
  const data = await roturRequest("POST", "/v2/validators", token, { key });
  if (!data || !data.validator) {
    throw new Error("rotur_no_validator");
  }
  return data.validator;
}

const roturAvatar = (username) =>
  `https://avatars.rotur.dev/${encodeURIComponent(username)}`;

export { roturAvatar, roturMe, roturValidator };
