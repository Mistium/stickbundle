// The "Careful - you have unsaved changes!" bar at the bottom of a settings page (styles: SettingsDialog.css .bf-pe-bar).
// useUnsaved tells the settings shell about unsaved changes (so leaving asks first, and the bar shakes) and gives the bar's state.
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

// changed: the page differs from what's saved; onDirty: the shell's (optional); returns [bar, flashSaved]
export function useUnsaved(changed, onDirty) {
  const [bar, setBar] = useState(''); // '' | 'shake' | 'saved'
  useEffect(() => { onDirty?.(changed, () => { setBar('shake'); setTimeout(() => setBar(''), 500); }); }, [changed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const flashSaved = () => { setBar('saved'); setTimeout(() => setBar(''), 1400); };
  return [bar, flashSaved];
}

// busy: saving right now; disabled: can't save yet (a field is invalid)
export function UnsavedBar({ changed, bar, busy, disabled, onReset, onSave }) {
  return (
    <div className={`bf-pe-bar${changed || bar === 'saved' ? ' on' : ''}${bar ? ` ${bar}` : ''}`} role="status">
      <span className="bf-pe-bar-text">{bar === 'saved' && !changed ? <><Check size={14} className="vc-inline-ico" /> Saved</> : 'Careful - you have unsaved changes!'}</span>
      {changed && <button type="button" className="bf-pe-bar-reset" onClick={onReset}>Reset</button>}
      {changed && <button type="button" className="btn btn-primary btn-sm" disabled={busy || disabled} onClick={onSave}>{busy ? 'Saving...' : 'Save changes'}</button>}
    </div>
  );
}
