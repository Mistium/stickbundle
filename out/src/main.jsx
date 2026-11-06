import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './originchats/oc.css'
import Chat from './pages/Chat.jsx'
import { loadOfficialClients } from './chat/officialClients.js'
import { start } from './originchats/backend.js'
import { installSocket, deliver } from './originchats/ws.js'
import { ensureToken, hasIdentity } from './originchats/session.js'
import { OcLogin } from './originchats/OcLogin.jsx'
import { getState, patchState } from './chat/store.js'

// The in-page OriginChats bridge: the page is Ember's server. Install it
// before the app mounts so every REST call and the home socket go through it.
installSocket()
if (hasIdentity()) {
  ensureToken()
  start({
    emit: deliver,
    getState: () => getState(),
    setMe: me => patchState({ me }),
  })
}

function App() {
  const [signedIn, setSignedIn] = useState(() => hasIdentity())
  if (!signedIn) {
    return <OcLogin onDone={() => { setSignedIn(true); location.reload() }} />
  }
  return <Chat />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Official clients list (names + verified badges on a message's "sent from"
// chip): once at startup, cached. OriginChats has no such directory, so this
// quietly comes back empty.
setTimeout(() => { loadOfficialClients().catch(() => {}) }, 1500)
