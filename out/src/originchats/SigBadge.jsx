// Shows whether a message's signature checked out. Unsigned messages show
// nothing; "unavailable" means the key lookup failed, not that it's forged.
const TEXT = {
  verified: (u) => `Signed by ${u}'s Rotur key`,
  invalid: () => "This signature doesn't match the message",
  unavailable: () => "Couldn't check this signature right now",
  pending: () => "Checking signature…",
};

function SigBadge({ m }) {
  const state = m && m.signed;
  if (!state || !TEXT[state]) {
    return null;
  }
  const who = (m.author && m.author.username) || "the author";
  return (
    <span className={`oc-sig oc-sig-${state}`} title={TEXT[state](who)} aria-label={TEXT[state](who)}>
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path d="M8 1.2 2.5 3.4v4.2c0 3.4 2.3 6 5.5 7.2 3.2-1.2 5.5-3.8 5.5-7.2V3.4L8 1.2z" fill="currentColor" opacity=".18" />
        <path d="M8 1.2 2.5 3.4v4.2c0 3.4 2.3 6 5.5 7.2 3.2-1.2 5.5-3.8 5.5-7.2V3.4L8 1.2z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        {state === "verified" && <path d="m5.4 8.1 1.8 1.8 3.5-3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
        {state === "invalid" && <path d="M8 4.8v3.6M8 10.6v.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
        {(state === "unavailable" || state === "pending") && <path d="M6.2 6.4a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.7.5-.7 1v.4M8 11v.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
      </svg>
    </span>
  );
}

export { SigBadge };
