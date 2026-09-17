import React, { useState } from 'react';


import MarketBanner from '../components/MarketBanner';
import SearchBar from '../components/SearchBar';
import CategoryTabs from '../components/CategoryTabs';
import SortTabs from '../components/SortTabs';
import AssetList from '../components/AssetList';
import PromoCard from '../components/PromoCard';

export default function Marketplace() {
  const [activeCategory, setActiveCategory] = useState<
    'All' | 'Games' | 'NFTs' | 'Tokens' | 'Rewards'
  >('All');

  return (
    <div className="min-h-screen bg-[#111217]">

      <main className="mx-auto w-full max-w-[1200px] px-0 pb-28 pt-4">
        <MarketBanner />

        <SearchBar />

        <CategoryTabs
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />

        <SortTabs />

        <AssetList category={activeCategory} />

        <PromoCard />
      </main>
    </div>
  );
}
