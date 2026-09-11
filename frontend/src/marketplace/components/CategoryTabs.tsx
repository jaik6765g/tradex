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
                  ? 'bg-[#FEF3C7] scale-110 shadow-md shadow-amber-200/50'
                  : 'bg-[#F3F4F6] hover:bg-[#E5E7EB]'
              }`}
            >
              <Icon
                size={24}
                color={isActive ? '#FBBF24' : '#1E293B'}
              />
            </div>

            <span
              className={`text-[11px] transition-colors ${
                isActive
                  ? 'text-[#111827] font-bold'
                  : 'text-[#6B7280] font-medium'
              }`}
            >
              {label}
            </span>

            {isActive && (
              <span className="w-5 h-0.5 bg-[#FBBF24] rounded-full mt-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
