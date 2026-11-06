import { useEffect, useState } from 'react';

// a server's picture; when it can't be loaded the initials stay, so a rail icon is never an empty square
export function ServerIcon({ src, name }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  const initials = String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return src && !bad ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : initials;
}
