import React from 'react';
import {
  Grid2x2,
  Gamepad2,
  Hexagon,
  Pickaxe,
  Gift,
} from 'lucide-react';

export type CategoryValue = 'All' | 'Games' | 'NFTs' | 'Tokens' | 'Rewards';

const categories: { label: CategoryValue; icon: typeof Grid2x2 }[] = [
  { label: 'All', icon: Grid2x2 },
  { label: 'Games', icon: Gamepad2 },
  { label: 'NFTs', icon: Hexagon },
  { label: 'Tokens', icon: Pickaxe },
  { label: 'Rewards', icon: Gift },
];

interface CategoryTabsProps {
  activeCategory: CategoryValue;
  onCategoryChange: (category: CategoryValue) => void;
}

export default function CategoryTabs({
  activeCategory,
  onCategoryChange,
}: CategoryTabsProps) {
  return (
    <div className="flex justify-between mx-5 mb-4">
      {categories.map(({ label, icon: Icon }) => {
        const isActive = activeCategory === label;

        return (
          <button
            key={label}
            onClick={() => onCategoryChange(label)}
            className="flex-1 flex flex-col items-center gap-1.5 relative"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                isActive
                  ? 'bg-[#2A190D] border border-[#8F4817] scale-110 shadow-[0_2px_10px_rgba(255,122,24,0.18)]'
                  : 'bg-[#1B1917] border border-transparent hover:bg-[#292B33]'
              }`}
            >
              <Icon
                size={24}
                color={isActive ? '#FF7A18' : '#70737E'}
              />
            </div>

            <span
              className={`text-[11px] transition-colors ${
                isActive
                  ? 'text-[#F5F5F7] font-bold'
                  : 'text-[#70737E] font-medium'
              }`}
            >
              {label}
            </span>

            {isActive && (
              <span className="w-5 h-0.5 bg-[#FF7A18] rounded-full mt-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
