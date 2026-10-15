// Signature marks, as the official client shows them: nothing for a
// verified message, a warning for unsigned or forged ones, and "Unverified"
// when Rotur couldn't be reached to check.
const NOTICES = {
  unsigned: {
    title: "Unsigned message",
    text: "This server supports message signing, but this message wasn't signed, so it can't be verified as coming from its author.",
  },
  invalid: {
    title: "Signature warning",
    text: "This message's signature is invalid. The server may have changed it, or the author's client is broken.",
  },
};

function SigBadge({ m }) {
  const state = m && m.signed;
  if (state === "unavailable") {
    return (
      <span className="oc-sig-unverified" title="Rotur couldn't be reached to verify this signature.">
        Unverified
      </span>
    );
  }
  const notice = NOTICES[state];
  if (!notice) {
    return null;
  }
  const label = `${notice.title}: ${notice.text}`;
  return (
    <span className={`oc-sig oc-sig-${state}`} title={label} aria-label={label} role="img">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    </span>
  );
}

export { SigBadge };
