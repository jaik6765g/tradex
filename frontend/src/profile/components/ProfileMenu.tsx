import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Headphones,
  Info,
  Loader2,
  Settings,
  User,
  Shield,
  Gift,
  Award,
  LogOut,
} from 'lucide-react';
import { useWalletContext } from '../../wallet/context/WalletContext';

const menus = [
  {
    id: 'profile',
    title: 'My Profile',
    subtitle: 'View and edit your profile',
    icon: User,
    color: '#C99752',
    bg: '#211810',
    route: '/my-profile',
  },
  {
    id: 'referral',
    title: 'Referral Program',
    subtitle: 'Earn rewards by inviting friends',
    icon: Gift,
    color: '#FF8F3D',
    bg: '#2A190D',
    route: '/referral',
  },
  {
    id: 'achievements',
    title: 'Achievements',
    subtitle: 'Track your trading milestones',
    icon: Award,
    color: '#34D399',
    bg: '#10251A',
    route: '/achievements',
  },
  {
    id: 'security',
    title: 'Security Settings',
    subtitle: 'Manage your account security',
    icon: Shield,
    color: '#C99752',
    bg: '#211810',
    route: '/security',
  },
  {
    id: 'settings',
    title: 'Settings',
    subtitle: 'Customize your experience',
    icon: Settings,
    color: '#70737E',
    bg: '#15161C',
    route: '/settings',
  },
  {
    id: 'help',
    title: 'Help & Support',
    subtitle: 'Get help and support',
    icon: Headphones,
    color: '#C99752',
    bg: '#211810',
    route: '/help',
  },
  {
    id: 'about',
    title: 'About TradeX',
    subtitle: 'Version 1.0.0',
    icon: Info,
    color: '#C99752',
    bg: '#211810',
    route: '/about',
  },
];

export default function ProfileMenu() {
  const navigate = useNavigate();
  const { logout, isAdmin } = useWalletContext();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const visibleMenus = isAdmin
    ? [
        {
          id: 'admin-dashboard',
          title: 'Admin Dashboard',
          subtitle: 'Risk, liquidity, and operations metrics',
          icon: Shield,
          color: '#0F766E',
          bg: '#10251A',
          route: '/admin',
        },
        ...menus,
      ]
    : menus;

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      // Full sign-out: clears auth session (Supabase + local token),
      // resets wallet state, and disconnects the wallet.
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="w-full rounded-2xl bg-[#15161C] border border-[#292B33] shadow-sm overflow-hidden">
      {/* Menu Items */}
      {visibleMenus.map((item, index) => {
        const Icon = item.icon;
        const isLast = index === visibleMenus.length - 1;

        return (
          <button
            key={item.id}
            onClick={() => navigate(item.route)}
            className={`
              flex items-center w-full px-4 py-3.5 text-left transition
              hover:bg-[#1B1917]
              ${!isLast ? 'border-b border-[#292B33]' : ''}
            `}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: item.bg }}
            >
              <Icon size={18} style={{ color: item.color }} />
            </div>

            <div className="ml-3 flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#F5F5F7]">
                {item.title}
              </div>
              <div className="text-[10px] text-[#70737E]">
                {item.subtitle}
              </div>
            </div>

            <ChevronRight size={16} className="text-[#70737E]" />
          </button>
        );
      })}

      {/* Logout - Separate with border */}
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="flex items-center w-full px-4 py-3.5 text-left border-t border-[#292B33] hover:bg-[#281313] transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <div className="w-9 h-9 rounded-xl bg-[#281313] flex items-center justify-center shrink-0">
          {isLoggingOut ? (
            <Loader2 size={18} className="text-red-500 animate-spin" />
          ) : (
            <LogOut size={18} className="text-red-500" />
          )}
        </div>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-sm font-semibold text-[#F87171]">
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </div>
          <div className="text-[10px] text-[#70737E]">Sign out of your account</div>
        </div>
        <ChevronRight size={16} className="text-[#70737E]" />
      </button>
    </div>
  );
}