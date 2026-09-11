import React from 'react';
import {
  House,
  Store,
  ArrowLeftRight,
  UsersRound,
  UserRound,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

type Props = {
  activeTab?: 'Home' | 'Market' | 'Trade' | 'Referral' | 'Profile';
};

export default function BottomNav({ activeTab }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    {
      label: 'Home',
      icon: House,
      path: '/',
    },
    {
      label: 'Market',
      icon: Store,
      path: '/marketplace',
    },
    {
      label: 'Trade',
      icon: ArrowLeftRight,
      path: '/trade',
    },
    {
      label: 'Referral',
      icon: UsersRound,
      path: '/referral',
    },
    {
      label: 'Profile',
      icon: UserRound,
      path: '/profile',
    },
  ];

  // Automatically detect active tab from URL
  const getActiveTab = () => {
    if (activeTab) {
      return activeTab;
    }

    if (location.pathname === '/') {
      return 'Home';
    }

    if (location.pathname.startsWith('/marketplace')) {
      return 'Market';
    }

    if (location.pathname.startsWith('/trade')) {
      return 'Trade';
    }

    if (location.pathname.startsWith('/referral')) {
      return 'Referral';
    }

    if (location.pathname.startsWith('/profile')) {
      return 'Profile';
    }

    return 'Home';
  };

  const currentTab = getActiveTab();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <nav
        className="
          relative
          mx-auto
          flex
          h-[56px]
          w-full
          max-w-[720px]
          items-center
          justify-around
          rounded-t-[20px]
          border-t
          border-slate-200/50
          bg-white/95
          backdrop-blur-sm
          px-1
          shadow-[0_-2px_20px_rgba(15,23,42,0.04)]
        "
      >
        {items.map((item) => {
          const active = currentTab === item.label;
          const Icon = item.icon;
          const isTrade = item.label === 'Trade';

          /* =========================================
             TRADE - CENTER FLOATING BUTTON
          ========================================= */

          if (isTrade) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => navigate(item.path)}
                aria-label="Trade"
                className="
                  relative
                  flex
                  h-full
                  min-w-[50px]
                  flex-1
                  max-w-[90px]
                  flex-col
                  items-center
                  justify-center
                  outline-none
                  group
                "
              >
                {/* Outer Ring */}
                <div
                  className={`
                    absolute
                    -top-[16px]
                    flex
                    h-[46px]
                    w-[46px]
                    items-center
                    justify-center
                    rounded-full
                    border-[2.5px]
                    border-white
                    transition-all
                    duration-300
                    ease-out
                    ${
                      active
                        ? 'bg-indigo-500 shadow-[0_4px_15px_rgba(99,102,241,0.25)] scale-100'
                        : 'bg-indigo-400 shadow-[0_2px_10px_rgba(99,102,241,0.15)] scale-95'
                    }
                  `}
                >
                  {/* Inner Circle */}
                  <div
                    className={`
                      flex
                      h-[38px]
                      w-[38px]
                      items-center
                      justify-center
                      rounded-full
                      transition-all
                      duration-300
                      ${
                        active
                          ? 'bg-indigo-500'
                          : 'bg-indigo-400'
                      }
                    `}
                  >
                    <ArrowLeftRight
                      size={18}
                      strokeWidth={2.2}
                      className="text-white"
                    />
                  </div>
                </div>

                {/* Trade Label */}
                <span
                  className={`
                    mt-5
                    text-[9px]
                    font-medium
                    tracking-wide
                    transition-all
                    duration-200
                    ${
                      active
                        ? 'text-indigo-600'
                        : 'text-slate-400'
                    }
                  `}
                >
                  Trade
                </span>
              </button>
            );
          }

          /* =========================================
             NORMAL NAVIGATION ITEMS
          ========================================= */

          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              className="
                relative
                flex
                h-[48px]
                min-w-[48px]
                flex-1
                max-w-[90px]
                flex-col
                items-center
                justify-center
                rounded-xl
                outline-none
                transition-all
                duration-200
                hover:bg-slate-50/60
              "
            >
              {/* Active Background */}
              {active && (
                <div
                  className="
                    absolute
                    inset-x-1
                    inset-y-1
                    rounded-xl
                    bg-indigo-50/80
                    shadow-[0_1px_6px_rgba(99,102,241,0.06)]
                  "
                />
              )}

              {/* Icon */}
              <div
                className={`
                  relative
                  z-10
                  flex
                  h-5
                  w-5
                  items-center
                  justify-center
                  transition-all
                  duration-200
                  ${
                    active
                      ? 'text-indigo-600'
                      : 'text-slate-400'
                  }
                `}
              >
                <Icon
                  size={18}
                  strokeWidth={active ? 2.2 : 1.8}
                />
              </div>

              {/* Label */}
              <span
                className={`
                  relative
                  z-10
                  mt-0.5
                  text-[8px]
                  leading-3
                  tracking-wide
                  transition-all
                  duration-200
                  ${
                    active
                      ? 'font-semibold text-indigo-600'
                      : 'font-medium text-slate-400'
                  }
                `}
              >
                {item.label}
              </span>

              {/* Active Dot */}
              {active && (
                <span
                  className="
                    absolute
                    bottom-0.5
                    z-20
                    h-0.5
                    w-0.5
                    rounded-full
                    bg-indigo-500
                  "
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}