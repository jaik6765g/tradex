// src/marketplace/games/lotto/utils/ballAssets.js
//
// LOTTO ball artwork (frontend/assets/lotto/*.webp) keyed by result symbol.
// File naming: ball_0 = "0", ball_01 … ball_09 = "1" … "9", ball_a … ball_f = "A" … "F".
//
// Vite resolves these relative imports into emitted asset URLs at build time,
// so the same module works in dev and in the production bundle.

import ball0 from '../../../../../assets/lotto/ball_0.webp';
import ball1 from '../../../../../assets/lotto/ball_01.webp';
import ball2 from '../../../../../assets/lotto/ball_02.webp';
import ball3 from '../../../../../assets/lotto/ball_03.webp';
import ball4 from '../../../../../assets/lotto/ball_04.webp';
import ball5 from '../../../../../assets/lotto/ball_05.webp';
import ball6 from '../../../../../assets/lotto/ball_06.webp';
import ball7 from '../../../../../assets/lotto/ball_07.webp';
import ball8 from '../../../../../assets/lotto/ball_08.webp';
import ball9 from '../../../../../assets/lotto/ball_09.webp';
import ballA from '../../../../../assets/lotto/ball_a.webp';
import ballB from '../../../../../assets/lotto/ball_b.webp';
import ballC from '../../../../../assets/lotto/ball_c.webp';
import ballD from '../../../../../assets/lotto/ball_d.webp';
import ballE from '../../../../../assets/lotto/ball_e.webp';
import ballF from '../../../../../assets/lotto/ball_f.webp';

/** All 16 symbols (0–9, A–F) → ball artwork URL. */
export const LOTTO_BALLS = {
  '0': ball0,
  '1': ball1,
  '2': ball2,
  '3': ball3,
  '4': ball4,
  '5': ball5,
  '6': ball6,
  '7': ball7,
  '8': ball8,
  '9': ball9,
  A: ballA,
  B: ballB,
  C: ballC,
  D: ballD,
  E: ballE,
  F: ballF,
};

/** Ball artwork for a symbol; returns null for anything unsupported. */
export const getBallImage = (value) => {
  const key = String(value ?? '').trim().toUpperCase();
  return LOTTO_BALLS[key] ?? null;
};

export default LOTTO_BALLS;