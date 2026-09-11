import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Header from '../src/shared/components/layout/Header';
import SearchBar from '../src/marketplace/components/SearchBar';
import MarketBanner from '../src/marketplace/components/MarketBanner';
import CategoryTabs from '../src/marketplace/components/CategoryTabs';
import SortTabs from '../src/marketplace/components/SortTabs';
import AssetList from '../src/marketplace/components/AssetList';
import PromoCard from '../src/marketplace/components/PromoCard';
import BottomNav from '../src/shared/components/layout/BottomNav';

export default function MarketplaceScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Header />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <SearchBar />
        <MarketBanner />
        <CategoryTabs />
        <SortTabs />
        <AssetList />
        <PromoCard />
      </ScrollView>
      <BottomNav activeTab="Market" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { paddingBottom: 100 }
});
