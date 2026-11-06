// If something in Ember throws while drawing, show what happened (with a way to report it) instead of a blank page.
import { Component, useState } from 'react';
import { TriangleAlert, RotateCw, Bug, Copy, Check } from 'lucide-react';

const REPORT_URL = '/bug-report';

function CrashScreen({ error, info }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const details = [
    `Ember crash - ${new Date().toISOString()}`,
    `Page: ${location.pathname}${location.hash}`,
    `Browser: ${navigator.userAgent}`,
    '',
    String(error?.stack || error?.message || error),
    info?.componentStack ? `\nComponents:${info.componentStack.split('\n').slice(0, 12).join('\n')}` : '',
  ].join('\n');
  return (
    <div className="vc-crash" role="alert">
      <div className="vc-crash-box">
        <TriangleAlert size={34} className="vc-crash-ico" />
        <h2>Ember crashed</h2>
        <p>Something went wrong while showing this page. Reloading usually fixes it.</p>
        <p>If it keeps happening (or you can make it happen again), it's probably a bug - please report it on the <a href={REPORT_URL} target="_blank" rel="noopener noreferrer">Nookara bug report form</a> and paste the details below.</p>
        <div className="vc-crash-btns">
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}><RotateCw size={15} /> Reload</button>
          <a className="btn btn-surface" href={REPORT_URL} target="_blank" rel="noopener noreferrer"><Bug size={15} /> Report a bug</a>
          <button type="button" className="btn btn-surface" onClick={() => setOpen(o => !o)}>{open ? 'Hide details' : 'Show details'}</button>
        </div>
        {open && (
          <div className="vc-crash-details">
            <button type="button" className="btn btn-surface btn-sm" onClick={() => navigator.clipboard?.writeText(details).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy details</>}
            </button>
            <pre>{details}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export class CrashGuard extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ info }); console.error('[bonfire] crashed:', error, info?.componentStack); }
  render() { return this.state.error ? <CrashScreen error={this.state.error} info={this.state.info} /> : this.props.children; }
}
