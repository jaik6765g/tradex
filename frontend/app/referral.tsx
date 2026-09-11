import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Header from '../src/shared/components/layout/Header';
import BottomNav from '../src/shared/components/layout/BottomNav';

import ReferralBanner from '../src/referral/components/ReferralBanner';
import ReferralStats from '../src/referral/components/ReferralStats';
import ReferralTypeTabs from '../src/referral/components/ReferralTypeTabs';
import ReferralStructure from '../src/referral/components/ReferralStructure';
import ReferralBottomSummary from '../src/referral/components/ReferralBottomSummary';
import ShareBottomSheet from '../src/referral/components/ShareBottomSheet';

import { ReferralType } from '../src/referral/types/referral';
import { generateReferralLink } from '../src/referral/services/referral';

export default function ReferralScreen() {
  const [activeType, setActiveType] =
    useState<ReferralType>('game');

  const [shareVisible, setShareVisible] =
    useState(false);

  // Temporary UI data.
  // Later these values will come from backend/API.
  const stats = {
    totalNetwork: 0,
    totalActive: 0,
    totalEarned: 0,
  };

  const referralLink = generateReferralLink();

  const handleCopy = () => {
    Alert.alert(
      'Referral Link',
      'Referral link copied successfully.'
    );
  };

  const handleShare = () => {
    setShareVisible(true);
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
    >
      <Header />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <ReferralBanner
          referralLink={referralLink}
          onCopy={handleCopy}
          onShare={handleShare}
        />

        <ReferralStats stats={stats} />

        <ReferralTypeTabs
          activeType={activeType}
          onChange={setActiveType}
        />

        <ReferralStructure
          type={activeType}
        />

        <ReferralBottomSummary
          totalNetwork={stats.totalNetwork}
          totalActive={stats.totalActive}
          totalEarned={stats.totalEarned}
        />

        <View style={styles.bottomSpace} />
      </ScrollView>

      <BottomNav activeTab="Referral" />

      <ShareBottomSheet
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },

  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 110,
  },

  bottomSpace: {
    height: 10,
  },
});
