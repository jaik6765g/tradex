// Countdown overlay shown during the final countdown (≤5s) and the result
// transition. Presents the remaining time casino-style with a scale-in / glow
// animation. Auto-dismisses after the transition and never blocks interaction.
//
// `embedded` (default false) confines the overlay to the nearest
// `position: relative` parent — the Lotto ball (Pick Numbers) card — so the
// countdown runs ONLY inside that card instead of over the whole screen.
import React, { useEffect, useRef, useState } from "react";

const CountdownOverlay = ({
  open,
  remainingSeconds,
  selectedNumbers = [],
  phase = "COUNTDOWN",
  embedded = false,
}) => {
  // Keep the last "live" second so the overlay doesn't flash blank between the
  // final tick and the result transition.
  const [displaySecond, setDisplaySecond] = useState(remainingSeconds);
  const [showResult, setShowResult] = useState(false);
  const autoHideTimer = useRef(null);

  useEffect(() => {
    if (!open) {
      setShowResult(false);
      return;
    }
    setDisplaySecond(remainingSeconds);
    if (phase === "DRAWING" || remainingSeconds <= 0) {
      setShowResult(true);
    }
  }, [open, remainingSeconds, phase]);

  // Auto-dismiss the result card shortly after it appears.
  useEffect(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    if (open && showResult) {
      autoHideTimer.current = window.setTimeout(() => {
        setShowResult(false);
      }, 1400);
    }
    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    };
  }, [open, showResult]);

  if (!open) return null;

  const safeNumbers = Array.isArray(selectedNumbers) ? selectedNumbers : [];
  const second = Math.max(0, Math.floor(Number.isFinite(displaySecond) ? displaySecond : 0));

  return (
    <div
      className={`countdown-overlay${embedded ? " countdown-overlay--embedded" : ""}`}
      role="dialog"
      aria-label="Countdown"
      aria-hidden={!open}
    >
      <div className="countdown-overlay__backdrop" />

      <div className="countdown-overlay__center">
        {!showResult ? (
          embedded ? (
            // Embedded (ball card) mode: reference-style BIG two-digit second
            // counter (e.g. `0 3`) filling the card. The header clock already
            // shows MM:SS, so the ball card only needs the final seconds.
            // NOTE: no `key` here — remounting the whole clock every second
            // made it zoom in again on each tick. Only the digit that actually
            // changes is re-keyed inside SecondsCells, so just that one pops.
            <SecondsCells seconds={second} />
          ) : (
            <div className="countdown-overlay__pulse" key={`tick-${second}`}>
              <span className="countdown-overlay__second">{String(second).padStart(2, "0")}</span>
              <span className="countdown-overlay__label">seconds left</span>
            </div>
          )
        ) : (
          <div className="countdown-overlay__result">
            <span className="countdown-overlay__result-label">Your Numbers</span>
            <div className="countdown-overlay__numbers">
              {safeNumbers.length > 0 ? (
                safeNumbers.map((n, i) => (
                  <span
                    key={`${n}-${i}`}
                    className="countdown-overlay__num"
                    style={{ animationDelay: `${i * 0.08}s` }}
                  >
                    {n}
                  </span>
                ))
              ) : (
                <span className="countdown-overlay__num countdown-overlay__num--empty">—</span>
              )}
            </div>
            <span className="countdown-overlay__result-status">Result pending…</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Big two-digit second counter for the ball (Pick Numbers) card — always two
// digits (00..59), so the countdown reads exactly like the reference overlay.
// Each cell's key carries its own digit, so ONLY the digit that changes
// re-mounts (and re-runs its pop animation) on a tick — the whole clock no
// longer zooms once per second.
const SecondsCells = ({ seconds }) => {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const secs = String(safeSeconds % 60).padStart(2, "0");
  const isFinal = safeSeconds <= 0;

  return (
    <div
      className={`countdown-overlay__clock${isFinal ? " countdown-overlay__clock--final" : ""}`}
      role="timer"
      aria-live="off"
      aria-label={`${safeSeconds} seconds remaining`}
    >
      {[secs[0], secs[1]].map((digit, index) => (
        <span key={`${index}-${digit}`} className="countdown-overlay__clock-cell">
          {digit}
        </span>
      ))}
    </div>
  );
};

export default CountdownOverlay;
