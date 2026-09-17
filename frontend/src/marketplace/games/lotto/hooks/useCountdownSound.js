// Countdown sound: plays countdown.mp3 once per second during the final 5 seconds.
// Uses a persistent HTML5 <audio> instance (never recreated per tick) with a
// resilient user-gesture unlock for browser autoplay.
// StrictMode / re-render / poll-safe via per-second playback tracking.
// No console diagnostics.
import countdownSoundUrl from '../../../../assets/sounds/countdown.mp3';
import { useEffect, useRef, useState, useCallback } from 'react';

const STORAGE_KEY = "lotto_countdown_sound_muted";

// Single persistent audio instance — survives across StrictMode re-runs.
let sharedAudio = null;
// True once a real user gesture has unlocked audio playback (Chrome autoplay).
let audioUnlocked = false;
// Gesture listeners are armed once and removed only AFTER a successful unlock,
// so a failed attempt is always retried on the next real user gesture.
let listenersAttached = false;

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click'];

function getSharedAudio() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudio) {
    sharedAudio = new Audio(countdownSoundUrl);
    sharedAudio.preload = 'auto';
    sharedAudio.volume = 1;
    sharedAudio.muted = false;
    try {
      // Warm the asset so the first play() is not delayed by loading.
      sharedAudio.load();
    } catch {
      /* preload='auto' still fetches it on first play() */
    }
  }
  return sharedAudio;
}

// Always return the element to an AUDIBLE state. A priming attempt must never
// be able to leave the audio muted / zero-volume — that would silence the real
// countdown ticks even though play() reports success.
function restoreAudible(audio) {
  audio.muted = false;
  audio.volume = 1;
}

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useCountdownSound(remainingSeconds, { phase = "COUNTDOWN", enabled = true } = {}) {
  const [muted, setMuted] = useState(readMuted);
  // Tracks the last whole-second value we already played a sound for, so 500ms
  // ticks / re-renders / StrictMode double-invoke never double-play.
  const lastPlayedRef = useRef(null);

  useEffect(() => {
    if (!enabled || muted) return;
    if (phase !== "COUNTDOWN" && phase !== "DRAWING") {
      lastPlayedRef.current = null;
      return;
    }

    const sec = Math.max(0, Math.floor(Number.isFinite(remainingSeconds) ? remainingSeconds : 0));

    // Play countdown sound for seconds 5, 4, 3, 2, 1 — never at 0.
    if (sec >= 1 && sec <= 5) {
      if (lastPlayedRef.current !== sec) {
        lastPlayedRef.current = sec;
        playCountdownSound(sec, muted);
      }
    } else {
      lastPlayedRef.current = null;
    }
  }, [remainingSeconds, phase, enabled, muted]);

  // Reset playback tracking whenever a new round (non-expiring) begins.
  useEffect(() => {
    if (remainingSeconds > 5) {
      lastPlayedRef.current = null;
    }
  }, [remainingSeconds]);

  // Unlock audio on a real user gesture (Chrome autoplay policy). No fake
  // clicks — the unlock always runs inside an actual gesture. Listeners stay
  // armed until an unlock actually succeeds, then they are removed.
  useEffect(() => {
    ensureUnlockListeners();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { muted, toggleMute };
}

function playCountdownSound(second, muted) {
  try {
    const audio = getSharedAudio();
    if (!audio) return;

    // Explicit audible state for every real playback attempt.
    audio.muted = Boolean(muted);
    audio.volume = muted ? 0 : 1;
    if (!muted) restoreAudible(audio);

    // Reset to start and play from a clean state.
    try {
      audio.currentTime = 0;
    } catch {
      /* not seekable yet — plays from the default start position */
    }

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      // Autoplay may be blocked before the first real user gesture; the
      // rejection is swallowed here because playback is retried once
      // unlockCountdownAudio() has primed the element.
      playPromise.catch(() => {
        /* autoplay blocked / playback failed — retried on the next tick or gesture */
      });
    }
  } catch {
    /* play() threw synchronously — next tick retries; nothing to do */
  }
}

function unlockCountdownAudio() {
  if (audioUnlocked || typeof window === 'undefined') return;

  const audio = getSharedAudio();
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
    restoreAudible(audio);
    audioUnlocked = ok;
    if (ok) detachUnlockListeners();
  };

  // Prime the element quietly (muted) so a real play() happens inside the
  // user gesture — allowing subsequent unmuted plays (autoplay policy).
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
  // the next tick is audible instead of being silently blocked forever.
  window.setTimeout(() => finish(true), 600);
}

function ensureUnlockListeners() {
  if (typeof window === 'undefined' || listenersAttached || audioUnlocked) return;
  listenersAttached = true;
  GESTURE_EVENTS.forEach((type) =>
    document.addEventListener(type, unlockCountdownAudio, { passive: true }),
  );
}

function detachUnlockListeners() {
  if (typeof document === 'undefined' || !listenersAttached) return;
  listenersAttached = false;
  GESTURE_EVENTS.forEach((type) =>
    document.removeEventListener(type, unlockCountdownAudio),
  );
}

// Arm the unlock as soon as this module loads (same pattern as the result
// sound) so the very first user interaction primes audible playback.
if (typeof window !== 'undefined') ensureUnlockListeners();

export function getSoundMutedInitial() {
  return readMuted();
}
