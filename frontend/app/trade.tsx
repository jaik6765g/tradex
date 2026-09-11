import React from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Header from '../src/shared/components/layout/Header';
import BottomNav from '../src/shared/components/layout/BottomNav';

import TradeHero from '../src/trade/components/TradeHero';
import TradeTypesGrid from '../src/trade/components/TradeTypesGrid';
import TradeOverview from '../src/trade/components/TradeOverview';

export default function TradeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      
      <Header />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >

        <TradeHero />

        <TradeTypesGrid />

        <TradeOverview />

      </ScrollView>

      <BottomNav activeTab="Trade" />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 110,
    gap: 14,
  },
});
