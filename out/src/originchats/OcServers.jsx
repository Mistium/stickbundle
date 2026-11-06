// Add a server by address (or invite) and browse the public OriginChats
// directory. These replace Ember's add-a-server / discover dialogs, which
// expect an Ember instance at that address.
import { useEffect, useState } from "react";
import { Globe, Search, Server, Users, TriangleAlert } from "lucide-react";
import { apiFetch } from "../api.js";
import { Dialog } from "../chat/Dialogs.jsx";
import { errorText, go, loadServers, toast } from "../chat/store.js";

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || "").replace(/^https?:\/\//, "");
  }
}

export function OcAddServer({ url, invite, onClose }) {
  const [text, setText] = useState(url ? (invite ? `${url}/${invite}` : url) : invite || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async (ev) => {
    ev?.preventDefault?.();
    const target = text.trim();
    if (!target) {
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await apiFetch(`/chat/join/${encodeURIComponent(target)}`, { method: "POST" });
      await loadServers();
      toast("Server added.", true);
      onClose?.();
      const sid = r?.server?.sid;
      if (sid) setTimeout(() => go({ kind: "server", sid }), 150);
    } catch (e) {
      setErr(errorText(e.message) || "Couldn't add that server.");
    }
    setBusy(false);
  };

  return (
    <Dialog
      title="Add a server"
      sub="Enter an OriginChats server's address, or paste an invite link. Your Rotur account is used on servers that accept it; others ask for their own account."
      onClose={onClose}
    >
      {(close) => (
        <form onSubmit={add}>
          <label className="vc-field">
            <span>Server address or invite</span>
            <div className="vc-row">
              <input
                className="form-input"
                autoFocus
                placeholder="chats.example.com or https://originchats.com/invite/…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={!text.trim() || busy}>
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
          </label>
          {err && (
            <p className="vc-err">
              <TriangleAlert size={14} /> {err}
            </p>
          )}
          <div className="vc-dialog-btns">
            <span className="grow" />
            <button type="button" className="btn btn-surface" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function OcDiscover({ onClose }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => {
    setErr("");
    apiFetch("/chat/discover")
      .then((d) => setList(d.servers || []))
      .catch((e) => {
        setErr(errorText(e.message) || "Couldn't load the directory.");
        setList([]);
      });
  };
  useEffect(load, []);

  const add = async (s) => {
    setBusy(s.url);
    try {
      const r = await apiFetch(`/chat/join/${encodeURIComponent(s.url)}`, { method: "POST" });
      await loadServers();
      toast(`Added ${s.name || hostOf(s.url)}.`, true);
      onClose?.();
      if (r?.server?.sid) setTimeout(() => go({ kind: "server", sid: r.server.sid }), 150);
    } catch (e) {
      toast(errorText(e.message) || "Couldn't add that server.");
    }
    setBusy("");
  };

  const query = q.trim().toLowerCase();
  const shown = (list || []).filter(
    (s) => !query || String(s.name || "").toLowerCase().includes(query) || String(s.url || "").toLowerCase().includes(query),
  );

  return (
    <Dialog
      title="Discover"
      sub="Public OriginChats servers. Each is run by its own community; adding one shows how it signs you in."
      onClose={onClose}
      wide
    >
      <label className="vc-search">
        <Search size={15} />
        <input autoFocus placeholder="Search by name or address" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {err && (
        <p className="vc-err">
          <TriangleAlert size={14} /> {err}
        </p>
      )}
      {!list && !err && (
        <div className="vc-loading">
          <i />
          <i />
          <i />
        </div>
      )}
      <div className="vc-disc-grid">
        {shown.map((s) => (
          <div key={s.url} className="vc-disc-card vl-rise">
            <div className="vc-disc-banner" />
            <span className="vc-srv-ico lg">
              {s.icon ? <img src={s.icon} alt="" /> : <Server size={22} />}
            </span>
            <div className="vc-disc-body">
              <b>{s.name || hostOf(s.url)}</b>
              <small className="vc-disc-host">
                <Globe size={11} /> {hostOf(s.url)}
              </small>
              <p>{s.description || "No description."}</p>
              <div className="vc-disc-foot">
                <span>
                  <Users size={13} /> {Number(s.member_count) || 0} member{Number(s.member_count) === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className={`btn ${s.joined ? "btn-surface" : "btn-primary"}`}
                  disabled={!!busy}
                  onClick={() => add(s)}
                >
                  {busy === s.url ? "Adding…" : s.joined ? "Add again" : "Add server"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {list && !shown.length && !err && <div className="vc-empty-note">{query ? "No servers match that." : "No servers are listed yet."}</div>}
    </Dialog>
  );
}
