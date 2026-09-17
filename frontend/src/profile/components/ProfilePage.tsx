import React from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Header from '../../shared/components/layout/Header';
import BottomNav from '../../shared/components/layout/BottomNav';

import ProfileHero from './ProfileHero';
import WalletSection from './WalletSection';
import ProfileQuickActions from './ProfileQuickActions';
import ProfileActivity from './ProfileActivity';
import ProfileMenu from './ProfileMenu';

export default function ProfilePage() {
  return (
    <SafeAreaView style={styles.container}>

      <Header />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >

        <ProfileHero />

        <WalletSection />

        <ProfileQuickActions />

        <ProfileActivity />

        <ProfileMenu />

      </ScrollView>

      <BottomNav activeTab="Profile" />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#111217',
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 110,
  },

});
