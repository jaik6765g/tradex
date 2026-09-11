// src/marketplace/components/AssetList.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import AssetListItem from './AssetListItem';

type AssetItem = {
  id: number | string;
  icon: string;
  name: string;
  subtitle: string;
  price: number;
  usdPrice: number;
  change: number;
  type: string;
  isGame?: boolean;
  comingSoon?: boolean;
};

const mockAssets: AssetItem[] = [
  {
    id: 1,
    icon: '🪖',
    name: 'Cyber Warrior #8721',
    subtitle: 'NFT Collection',
    price: 125.50,
    usdPrice: 24.50,
    change: 12.45,
    type: 'nft',
  },
  {
    id: 2,
    icon: '🗡️',
    name: 'Dragon Slayer Axe',
    subtitle: 'Game Item',
    price: 85.20,
    usdPrice: 16.80,
    change: 8.32,
    type: 'item',
  },
  {
    id: 3,
    icon: '🔺',
    name: 'TDX Token',
    subtitle: 'Token',
    price: 1.25,
    usdPrice: 0.24,
    change: 5.18,
    type: 'token',
  },
  {
    id: 4,
    icon: '🌲',
    name: 'Mystic Land',
    subtitle: 'Game Asset',
    price: 320.00,
    usdPrice: 63.20,
    change: -3.21,
    type: 'asset',
  },
  {
    id: 5,
    icon: '📦',
    name: 'Legendary Chest',
    subtitle: 'Game Item',
    price: 45.75,
    usdPrice: 9.10,
    change: 2.10,
    type: 'item',
  },
];

// ✅ Lotto Game Asset — active, playable
const lottoGameAsset: AssetItem = {
  id: 'lotto-game',
  icon: '🎟️',
  name: 'Lotto Win',
  subtitle: '🎯 Win up to 15× your bet',
  price: 0,
  usdPrice: 0,
  change: 0,
  type: 'game',
  isGame: true,
};

// ✅ Upcoming games — coming soon
const COMING_SOON_GAMES: AssetItem[] = [
  { id: 'mega-millions', icon: '💎', name: 'Mega Millions', subtitle: 'Crypto jackpot game', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'dice-roll', icon: '🎲', name: 'Dice Roll', subtitle: 'Roll & win TDX', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'roulette', icon: '🎡', name: 'TDX Roulette', subtitle: 'Classic roulette wheel', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'blackjack', icon: '🃏', name: 'Blackjack 21', subtitle: 'Beat the dealer', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'plinko', icon: '🔴', name: 'Plinko Drop', subtitle: 'Drop & multiply', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'mines', icon: '💣', name: 'Minesweeper', subtitle: 'Find the gems', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'keno', icon: '🎱', name: 'Keno Lucky', subtitle: 'Pick your lucky numbers', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'crash', icon: '🚀', name: 'Crash Rocket', subtitle: 'Cash out before blast', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'poker', icon: '♠️', name: 'Video Poker', subtitle: '5-card TDX poker', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
  { id: 'scratch', icon: '🎫', name: 'Scratch & Win', subtitle: 'Scratch cards for TDX', price: 0, usdPrice: 0, change: 0, type: 'game', isGame: true, comingSoon: true },
];

type CategoryValue = 'All' | 'Games' | 'NFTs' | 'Tokens' | 'Rewards';

// Map each asset type to its category bucket
function assetCategory(item: AssetItem): CategoryValue {
  if (item.type === 'game') return 'Games';
  if (item.type === 'nft') return 'NFTs';
  if (item.type === 'token' || item.type === 'asset') return 'Tokens';
  if (item.type === 'item') return 'Rewards';
  return 'All';
}

export default function AssetList({ category = 'All' }: { category?: CategoryValue }) {
  const navigate = useNavigate();

  // Active Lotto first, then NFT/item/token assets, then coming-soon games
  const allAssets: AssetItem[] = [lottoGameAsset, ...mockAssets, ...COMING_SOON_GAMES];

  // Apply category filter
  const filteredAssets =
    category === 'All'
      ? allAssets
      : allAssets.filter((item) => assetCategory(item) === category);

  return (
    <div className="bg-white mx-5 p-4 rounded-2xl border border-[#F3F4F6] mb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#F9FAFB]">
        <div className="flex-1 text-[13px] font-semibold text-[#6B7280]">
          {category === 'All' ? 'Asset' : category}
        </div>

        <div className="flex items-center justify-end w-[152px]">
          <div className="w-24 text-right text-[13px] font-semibold text-[#6B7280]">
            Floor Price
          </div>

          <div className="w-16 text-right text-[13px] font-semibold text-[#6B7280]">
            24H Change
          </div>
        </div>
      </div>

      {/* Render List */}
      {filteredAssets.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[#9CA3AF]">No items in this category yet.</p>
        </div>
      ) : (
        filteredAssets.map((item, index) => (
        <React.Fragment key={item.id}>
          {/* Section divider before coming-soon games (only in All/Games) */}
          {item.comingSoon && index > 0 && (category === 'All' || category === 'Games') && filteredAssets[index - 1]?.comingSoon === false && (
            <div className="flex items-center gap-2 pt-4 pb-2">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-violet-500">
                🎮 More Games — Coming Soon
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
            </div>
          )}
          <AssetListItem
            {...item}
            onPlayGame={() => {
              if (item.isGame && !item.comingSoon) {
                navigate('/lotto');
              }
            }}
          />
        </React.Fragment>
      ))
      )}
    </div>
  );
}