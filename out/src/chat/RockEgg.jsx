import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './RockEgg.css';

const SOUND = '/assets/bonfire/the-rock-sus.wav';
const IMAGE = '/assets/bonfire/the-rock.png';
const randomWait = () => 60000 + Math.random() * 120000;

// Runs in Ember's shared web UI, including browsers and the desktop/Android shells.
export default function RockEgg({ enabled }) {
  const [phase, setPhase] = useState('hidden');

  useEffect(() => {
    // Older desktop builds have their own local timer. Turn it off so the shared
    // account setting remains the only source of Rock appearances.
    window.bonfireDesktop?.setRockEnabled?.(false)?.catch?.(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) { setPhase('hidden'); return undefined; }
    const audio = new Audio(SOUND);
    audio.preload = 'auto';
    const image = new Image();
    image.src = IMAGE;
    image.decode?.().catch(() => {});
    let stopped = false;
    let waitTimer = null;
    let showTimer = null;
    let fadeTimer = null;
    let hideTimer = null;
    let waitingForGesture = false;
    let playing = false;

    const clearGesture = () => {
      window.removeEventListener('pointerdown', retryAfterGesture);
      window.removeEventListener('keydown', retryAfterGesture);
      waitingForGesture = false;
    };
    const schedule = () => {
      if (!stopped) waitTimer = window.setTimeout(play, randomWait());
    };
    const retryAfterGesture = () => {
      clearGesture();
      if (!stopped) play();
    };
    const onEnded = () => {
      if (!stopped && playing) { playing = false; schedule(); }
    };
    const play = async () => {
      waitTimer = null;
      if (stopped) return;
      if (document.visibilityState === 'hidden') { schedule(); return; }
      audio.currentTime = 0;
      try {
        await audio.play();
      } catch {
        // Browser autoplay can be blocked after a reload. Resume the pending
        // surprise on the next tap or key press instead of flashing silently.
        if (!waitingForGesture && !stopped) {
          waitingForGesture = true;
          window.addEventListener('pointerdown', retryAfterGesture);
          window.addEventListener('keydown', retryAfterGesture);
        }
        return;
      }
      if (stopped) { audio.pause(); return; }
      playing = true;
      showTimer = window.setTimeout(() => setPhase('shown'), 2880);
      fadeTimer = window.setTimeout(() => setPhase('fading'), 3380);
      hideTimer = window.setTimeout(() => setPhase('hidden'), 3680);
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onEnded);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(waitTimer); clearTimeout(showTimer); clearTimeout(fadeTimer); clearTimeout(hideTimer);
      clearGesture();
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onEnded);
      audio.pause();
    };
  }, [enabled]);

  if (!enabled) return null;
  return createPortal(<div className={`bf-rock-egg ${phase}`} aria-hidden="true"><img src={IMAGE} alt="" /></div>, document.body);
}
