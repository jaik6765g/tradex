// frontend/src/marketplace/games/lotto/LottoPage.tsx
// Full-page wrapper for the Lotto game — renders within the standard App
// shell (Header + BottomNav visible), exactly like Home / Marketplace.
// The old dark modal takeover is gone; this is a real route (/lotto).

import React from 'react';
import { useNavigate } from 'react-router-dom';

import LottoGame from './LottoGame.jsx';

export default function LottoPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#111217]">
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-4">
        <div className="space-y-4">
          <LottoGame onBack={() => navigate('/marketplace')} />
        </div>
      </main>
    </div>
  );
}