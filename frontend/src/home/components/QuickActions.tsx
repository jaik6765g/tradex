import React from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Headset,
  UserCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const actions = [
  {
    title: 'Add Funds',
    icon: ArrowDownCircle,
    route: '/deposit',
    yellow: true,
  },
  {
    title: 'Withdraw',
    icon: ArrowUpCircle,
    route: '/withdraw',
    yellow: true,
  },
  {
    title: 'Help Center',
    icon: Headset,
    route: '/profile',
    yellow: false,
  },
  {
    title: 'My Account',
    icon: UserCircle,
    route: '/profile',
    yellow: false,
  },
];

export default function QuickActions() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[125px] rounded-[20px] border border-[#E7E9EE] bg-white flex items-center py-4">
      {actions.map((item, index) => {
        const Icon = item.icon;

        return (
          <React.Fragment key={item.title}>
            <button
              className="flex-1 flex flex-col items-center justify-center hover:bg-[#F8FAFC] transition rounded-xl py-2"
              onClick={() => navigate(item.route)}
            >
              <Icon
                size={40}
                color={item.yellow ? '#F5B800' : '#111827'}
              />

              <span className="mt-2 text-[13px] font-bold text-[#344054]">
                {item.title}
              </span>
            </button>

            {index !== actions.length - 1 && (
              <div className="w-px h-[52px] bg-[#E7E9EE]" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
