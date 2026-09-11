import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Headphones,
  Info,
  Settings,
  User,
  Shield,
  Gift,
  Award,
  LogOut,  // ✅ Added LogOut
} from 'lucide-react';
import { useWalletContext } from '../../wallet/context/WalletContext';

const menus = [
  {
    id: 'profile',
    title: 'My Profile',
    subtitle: 'View and edit your profile',
    icon: User,
    color: '#7C3AED',
    bg: '#F5F3FF',
    route: '/profile',
  },
  {
    id: 'referral',
    title: 'Referral Program',
    subtitle: 'Earn rewards by inviting friends',
    icon: Gift,
    color: '#F59E0B',
    bg: '#FFFBEB',
    route: '/referral',
  },
  {
    id: 'achievements',
    title: 'Achievements',
    subtitle: 'Track your trading milestones',
    icon: Award,
    color: '#10B981',
    bg: '#ECFDF5',
    route: '/achievements',
  },
  {
    id: 'security',
    title: 'Security Settings',
    subtitle: 'Manage your account security',
    icon: Shield,
    color: '#3B82F6',
    bg: '#EFF6FF',
    route: '/security',
  },
  {
    id: 'settings',
    title: 'Settings',
    subtitle: 'Customize your experience',
    icon: Settings,
    color: '#6B7280',
    bg: '#F9FAFB',
    route: '/settings',
  },
  {
    id: 'help',
    title: 'Help & Support',
    subtitle: 'Get help and support',
    icon: Headphones,
    color: '#7C3AED',
    bg: '#F5F3FF',
    route: '/help',
  },
  {
    id: 'about',
    title: 'About TradeX',
    subtitle: 'Version 1.0.0',
    icon: Info,
    color: '#2563EB',
    bg: '#EFF6FF',
    route: '/about',
  },
];

export default function ProfileMenu() {
  const navigate = useNavigate();
  const { disconnectWallet, isAdmin } = useWalletContext();

  const visibleMenus = isAdmin
    ? [
        {
          id: 'admin-dashboard',
          title: 'Admin Dashboard',
          subtitle: 'Risk, liquidity, and operations metrics',
          icon: Shield,
          color: '#0F766E',
          bg: '#CCFBF1',
          route: '/admin',
        },
        ...menus,
      ]
    : menus;

  const handleLogout = async () => {
    try {
      await disconnectWallet();
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="w-full rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
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
              hover:bg-gray-50
              ${!isLast ? 'border-b border-gray-100' : ''}
            `}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: item.bg }}
            >
              <Icon size={18} style={{ color: item.color }} />
            </div>

            <div className="ml-3 flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">
                {item.title}
              </div>
              <div className="text-[10px] text-gray-400">
                {item.subtitle}
              </div>
            </div>

            <ChevronRight size={16} className="text-gray-300" />
          </button>
        );
      })}

      {/* Logout - Separate with border */}
      <button
        onClick={handleLogout}
        className="flex items-center w-full px-4 py-3.5 text-left border-t border-gray-100 hover:bg-red-50 transition"
      >
        <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
          <LogOut size={18} className="text-red-500" />
        </div>
        <div className="ml-3 flex-1 min-w-0">
          <div className="text-sm font-semibold text-red-600">Logout</div>
          <div className="text-[10px] text-gray-400">Disconnect your wallet</div>
        </div>
        <ChevronRight size={16} className="text-gray-300" />
      </button>
    </div>
  );
}