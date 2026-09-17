import React, { useState } from 'react';

const tabs = [
  'Trending',
  'Top Gainers',
  'Top Sellers',
  'New Listed',
];

export default function SortTabs() {
  const [active, setActive] = useState('Trending');

  return (
    <div className="flex justify-between px-5 mb-4 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => setActive(tab)}
          className="shrink-0 mr-5"
        >
          <div
            className={`text-sm ${
              active === tab
                ? 'font-bold text-[#F5F5F7]'
                : 'font-medium text-[#A1A4AE]'
            }`}
          >
            {tab}
          </div>

          {active === tab && (
            <div className="w-6 h-0.5 bg-[#FF7A18] mt-1.5 rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}
