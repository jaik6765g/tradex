// frontend/src/components/TradeTypesGrid.tsx

import React from 'react';
import { useNavigate } from 'react-router-dom';

import TradeTypeCard from './TradeTypeCard';

const tradeTypes = [
  // 1️⃣ Pulse Trade - Active
  {
    title: 'Pulse Trade',
    tag: 'LIVE',
    description: 'Trade with real-time price movements',
    image: '/assets/trade/pulse-trade.png',
    tagColor: '#34D399',
    tagBackground: '#10251A',
    route: '/pulse-trade',
    isComingSoon: false,
  },
  // 2️⃣ Bot Trade - Active
  {
    title: 'Bot Trade',
    tag: 'AUTOMATED',
    description: 'Automated trading with AI bots',
    image: '/assets/trade/bot-trade.png',
    tagColor: '#C99752',
    tagBackground: '#211810',
    route: '/bot-trade',
    isComingSoon: false,
  },
  // 3️⃣ Prediction - Coming Soon (80% transparent)
  {
    title: 'Prediction',
    tag: 'PREDICT',
    description: 'Predict price movements and win rewards',
    image: '/assets/trade/prediction-trade.png',
    tagColor: '#C99752',
    tagBackground: '#211810',
    route: '/prediction-trade',
    isComingSoon: true,
  },
  // 4️⃣ Pool Trade - Coming Soon (80% transparent)
  {
    title: 'Pool Trade',
    tag: 'POOL',
    description: 'Trade with pooled liquidity',
    image: '/assets/trade/pool-trade.png',
    tagColor: '#FF8F3D',
    tagBackground: '#2A190D',
    route: '/pool-trade',
    isComingSoon: true,
  },
];

export default function TradeTypesGrid() {
  const navigate = useNavigate();

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
      {tradeTypes.map((item) => (
        <TradeTypeCard
          key={item.title}
          title={item.title}
          tag={item.tag}
          description={item.description}
          image={item.image}
          tagColor={item.tagColor}
          tagBackground={item.tagBackground}
          onPress={() => navigate(item.route)}
          isComingSoon={item.isComingSoon}
        />
      ))}
    </div>
  );
}