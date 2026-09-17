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
  },
  {
    title: 'Withdraw',
    icon: ArrowUpCircle,
    route: '/withdraw',
  },
  {
    title: 'Help Center',
    icon: Headset,
    route: '/profile',
  },
  {
    title: 'My Account',
    icon: UserCircle,
    route: '/profile',
  },
];

export default function QuickActions() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[125px] rounded-[20px] border border-[#292B33] bg-[#15161C] flex items-center py-4">
      {actions.map((item, index) => {
        const Icon = item.icon;

        return (
          <React.Fragment key={item.title}>
            <button
              className="flex-1 flex flex-col items-center justify-center gap-2 hover:bg-[#111217] transition rounded-xl py-2"
              onClick={() => navigate(item.route)}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FF7A18]/10">
                <Icon size={22} className="text-[#FF8F3D]" />
              </span>

              <span className="text-[12px] font-bold text-[#E4E5E8]">
                {item.title}
              </span>
            </button>

            {index !== actions.length - 1 && (
              <div className="w-px h-10 bg-[#292B33]" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
