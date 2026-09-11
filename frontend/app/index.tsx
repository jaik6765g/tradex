import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import Header from '../src/shared/components/layout/Header';
import BottomNav from '../src/shared/components/layout/BottomNav';

import WalletCard from '../src/home/components/WalletCard';
import PromoCarousel from '../src/home/components/PromoCarousel';
import QuickActions from '../src/home/components/QuickActions';
import BalanceOverview from '../src/home/components/BalanceOverview';
import TdxWalletCard from '../src/home/components/TdxWalletCard';
import RecentActivity from '../src/home/components/RecentActivity';

export default function HomeScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.app}>
        <Header />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <WalletCard />
          <PromoCarousel />
          <QuickActions />
          <BalanceOverview />
          <TdxWalletCard />
          <RecentActivity />
        </ScrollView>

        <BottomNav />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },

  app: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 30,
    gap: 14,
  },
});
