import React from 'react';

import PromoCarousel from '../components/PromoCarousel';
import QuickActions from '../components/QuickActions';
import RecentActivity from '../components/RecentActivity';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F8FAFC]">

      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-4">
        <div className="space-y-4">
          <PromoCarousel />

          <QuickActions />

          <RecentActivity />
        </div>
      </main>

    </div>
  );
}
