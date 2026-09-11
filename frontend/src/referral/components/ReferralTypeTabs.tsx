import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ReferralType } from '../types/referral';

type Props = {
  activeType: ReferralType;
  onChange: (type: ReferralType) => void;
};

const tabs = [
  {
    id: 'game' as ReferralType,
    title: 'Game Referral',
    subtitle: 'Earn from Game',
    icon: 'game-controller',
    color: '#7C3AED',
  },
  {
    id: 'trade' as ReferralType,
    title: 'Trade Referral',
    subtitle: 'Earn from Trade',
    icon: 'stats-chart',
    color: '#2563EB',
  },
  {
    id: 'bot' as ReferralType,
    title: 'Bot Referral',
    subtitle: 'Earn from Bot',
    icon: 'hardware-chip',
    color: '#F59E0B',
  },
];

export default function ReferralTypeTabs({
  activeType,
  onChange,
}: Props) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = activeType === tab.id;

        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[
              styles.tab,
              active && styles.activeTab,
            ]}
          >
            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor: `${tab.color}15`,
                },
              ]}
            >
              <Ionicons
                name={tab.icon as any}
                size={23}
                color={tab.color}
              />
            </View>

            <View style={styles.text}>
              <Text style={styles.title}>
                {tab.title}
              </Text>

              <Text style={styles.subtitle}>
                {tab.subtitle}
              </Text>
            </View>

            {active && <View style={styles.activeLine} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 14,
  },

  tab: {
    flex: 1,
    minHeight: 105,
    paddingHorizontal: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  activeTab: {
    backgroundColor: '#FFFDF7',
  },

  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  text: {
    alignItems: 'center',
  },

  title: {
    color: '#111827',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },

  subtitle: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 3,
  },

  activeLine: {
    position: 'absolute',
    bottom: 0,
    width: 42,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#F59E0B',
  },
});
