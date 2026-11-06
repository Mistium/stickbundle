import { useEffect, useState } from 'react';
import { SHORT, COMMIT, isRelease, commitUrl, repoUrl, repoInfo, copyrightLine } from '../version.js';

export default function AboutBonfire() {
  const desktop = !!window.bonfireDesktop?.isDesktop;
  const [installed, setInstalled] = useState(null);
  const [release, setRelease] = useState(null);
  const [repo, setRepo] = useState(undefined); // undefined: asking GitHub, null: couldn't tell
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    if (desktop && typeof window.bonfireDesktop?.info === 'function') {
      Promise.resolve().then(() => window.bonfireDesktop.info()).then(info => {
        if (live && typeof info?.version === 'string') setInstalled(info.version);
      }).catch(() => { if (live) setInstalled('Unavailable'); });
    }
    fetch('/bonfire/latest.json', { signal: controller.signal, cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('Release unavailable'); return r.json(); })
      .then(info => { if (live && typeof info?.version === 'string') setRelease(info.version); })
      .catch(() => {});
    repoInfo().then(i => { if (live) setRepo(i); });
    return () => { live = false; controller.abort(); };
  }, [desktop]);
  return <div className="card">
    <div className="card-header"><span className="card-title">Ember</span></div>
    <div className="card-body cs-rows">
      <p className="cs-note">Nookara’s home for servers, channels, direct messages and friends.</p>
      <p className="cs-note">Ember is an open chat protocol: anyone can write an Ember client and use Ember servers. This app is the one the Nookara ecosystem uses.</p>
      <div className="cs-row"><div className="cs-text"><b>Created by</b><span>Ikelene</span></div></div>
      {desktop && <div className="cs-row"><div className="cs-text"><b>Installed desktop version</b><span>{installed || 'Checking…'}</span></div></div>}
      <div className="cs-row"><div className="cs-text"><b>Web build</b><span>{isRelease ? <a href={commitUrl(COMMIT)} target="_blank" rel="noopener noreferrer"><code>{SHORT}</code></a> : 'Development'}</span></div></div>
      {release && <div className="cs-row"><div className="cs-text"><b>Latest desktop release</b><span>{release}</span></div></div>}
      <div className="cs-row"><div className="cs-text"><b>Website</b><span><a href="https://nookara.cc" target="_blank" rel="noopener noreferrer">nookara.cc</a></span></div></div>
      <div className="cs-row"><div className="cs-text"><b>Copyright</b>
        {repo === undefined ? <span>Checking…</span> : <>
          <span>{copyrightLine(repo) || 'Copyright and license could not be loaded right now.'}</span>
          {repo?.license && <span>Licensed under {repo.license}.</span>}
        </>}
        <span><a href={repo?.url || repoUrl} target="_blank" rel="noopener noreferrer">Source and license on GitHub</a></span></div></div>
      <div className="cs-row"><div className="cs-text"><b>Sound credits</b><span>The AOL and Playstation message sounds belong to their respective owners (AOL and Sony Interactive Entertainment). They are not part of Ember and are not covered by Ember’s license or copyright.</span></div></div>
      <div className="cs-row"><div className="cs-text"><b>Built with</b><span>React, Lucide and Vite. The desktop app uses Electron.</span></div></div>
    </div>
  </div>;
}
