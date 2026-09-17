import React from 'react';
import ProfileHero from '../components/ProfileHero';
import WalletSection from '../components/WalletSection';
import ProfileActivity from '../components/ProfileActivity';
import ProfileMenu from '../components/ProfileMenu';

export default function Profile() {
  return (
    <div className="min-h-screen bg-[#111217] pb-28">

      <main className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <div className="space-y-4">
          <ProfileHero />
          <WalletSection />
          <ProfileActivity />
          <ProfileMenu />
        </div>
      </main>
    </div>
  );
}
