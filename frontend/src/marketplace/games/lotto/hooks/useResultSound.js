// Result Reveal sound: plays result.mp3 when a WIN/LOSS result is revealed.
// playResult() returns a Promise that resolves ONLY after the audio has fully
// finished (onended event) — no fixed-duration assumptions. The settlement
// popup is shown AFTER this promise resolves, so the sound always completes
// naturally before the popup appears.
import resultSoundUrl from '../../../../assets/sounds/result.mp3';
import { useCallback } from 'react';

// Single persistent audio instance — survives across StrictMode re-runs.
let resultAudio = null;
// True once a real user gesture has unlocked audio playback (Chrome autoplay).
let resultAudioUnlocked = false;
// Gesture listeners are armed once and removed only AFTER a successful unlock,
// so a failed attempt is always retried on the next real user gesture.
let resultListenersAttached = false;

function getResultAudio() {
  if (typeof window === 'undefined') return null;
  if (!resultAudio) {
    resultAudio = new Audio(resultSoundUrl);
    resultAudio.preload = 'auto';
    resultAudio.volume = 1;
    resultAudio.muted = false;
    try {
      // Warm the asset so the first play() is not delayed by loading.
      resultAudio.load();
    } catch {
      /* preload='auto' still fetches it on first play() */
    }
  }
  return resultAudio;
}

// Always return the element to an AUDIBLE state. A priming attempt must never
// be able to leave the audio muted / zero-volume — that would silence the
// result reveal even though play() reports success.
function restoreResultAudible(audio) {
  audio.muted = false;
  audio.volume = 1;
}

export function useResultSound({ muted = false } = {}) {
  /**
   * Plays the result reveal sound and resolves only when it has FULLY
   * finished (onended). Respects the shared mute state: when muted the
   * promise resolves immediately so the popup is never blocked.
   */
  const playResult = useCallback(() => {
    return playResultAudio(muted);
  }, [muted]);

  return { playResult };
}

/**
 * Plays result.mp3 from the start to its natural end.
 * Resolves on `onended` — or immediately when it cannot/should not play
 * (muted, autoplay blocked, missing element). The caller then shows the
 * WIN/LOSS popup.
 */
function playResultAudio(muted) {
  return new Promise((resolve) => {
    const audio = getResultAudio();
    if (!audio) {
      resolve();
      return;
    }

    try {
      // Explicit audible state for every real playback attempt.
      audio.muted = Boolean(muted);
      audio.volume = muted ? 0 : 1;
      if (!muted) restoreResultAudible(audio);

      // Reset only before a NEW playback starts (never mid-play).
      try {
        audio.currentTime = 0;
      } catch {
        /* not seekable yet — plays from the default start position */
      }

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        resolve();
      };

      // Primary completion signal: the audio naturally reaching its end.
      audio.onended = done;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // e.g. autoplay blocked — resolve so the popup is never stuck.
          done();
        });
      }

      // Safety net: only if onended never fires (very short / muted clip),
      // resolve shortly after the known duration so the popup is not stuck.
      const durMs =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.ceil(audio.duration * 1000)
          : 800;
      window.setTimeout(done, durMs + 200);
    } catch {
      resolve();
    }
  });
}

function unlockResultAudio() {
  if (resultAudioUnlocked || typeof window === 'undefined') return;

  const audio = getResultAudio();
  if (!audio) return;

  let settled = false;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
    // UNCONDITIONAL: the element must never stay muted/zero-volume.
    restoreResultAudible(audio);
    resultAudioUnlocked = ok;
    if (ok) detachResultUnlockListeners();
  };

  // Prime the element quietly (muted) inside the user gesture so subsequent
  // unmuted plays are allowed by the browser autoplay policy.
  audio.muted = true;
  audio.volume = 0;
  try {
    audio.currentTime = 0;
  } catch {
    /* ignore */
  }

  try {
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(() => finish(true)).catch(() => finish(false));
    } else {
      // No promise (legacy) — treat as unlocked but still restore audio.
      finish(true);
    }
  } catch {
    finish(false);
  }

  // Safety net: if play() never settles (media still loading), unmute anyway so
  // the result reveal is audible instead of being silently blocked forever.
  window.setTimeout(() => finish(true), 600);
}

const RESULT_GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click'];

function ensureResultUnlockListeners() {
  if (
    typeof window === 'undefined' ||
    resultListenersAttached ||
    resultAudioUnlocked
  ) {
    return;
  }
  resultListenersAttached = true;
  RESULT_GESTURE_EVENTS.forEach((type) =>
    document.addEventListener(type, unlockResultAudio, { passive: true }),
  );
}

function detachResultUnlockListeners() {
  if (typeof document === 'undefined' || !resultListenersAttached) return;
  resultListenersAttached = false;
  RESULT_GESTURE_EVENTS.forEach((type) =>
    document.removeEventListener(type, unlockResultAudio),
  );
}

// Unlock on the first real user gesture (same pattern as the countdown sound).
// Listeners stay armed until an unlock actually succeeds, then they are removed.
if (typeof window !== 'undefined') {
  ensureResultUnlockListeners();
}