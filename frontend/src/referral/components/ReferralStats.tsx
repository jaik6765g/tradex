import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ReferralStatsData } from '../types/referral';
import { formatReferralNumber, formatTDX } from '../services/referral';

type Props = {
  stats: ReferralStatsData;
};

export default function ReferralStats({ stats }: Props) {
  return (
    <View style={styles.card}>
      <Stat
        icon="people"
        iconColor="#7C3AED"
        title="Total Network"
        value={formatReferralNumber(stats.totalNetwork)}
      />

      <View style={styles.divider} />

      <Stat
        icon="person"
        iconColor="#16A34A"
        title="Total Active"
        value={formatReferralNumber(stats.totalActive)}
      />

      <View style={styles.divider} />

      <Stat
        icon="logo-bitcoin"
        iconColor="#F59E0B"
        title="Total Earned"
        value={formatTDX(stats.totalEarned)}
      />
    </View>
  );
}

function Stat({
  icon,
  iconColor,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  value: string;
}) {
  return (
    <View style={styles.stat}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: `${iconColor}15` },
        ]}
      >
        <Ionicons
          name={icon}
          size={22}
          color={iconColor}
        />
      </View>

      <View style={styles.statContent}>
        <Text style={styles.statTitle}>{title}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  stat: {
    flex: 1,
    alignItems: 'center',
  },

  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  statContent: {
    alignItems: 'center',
  },

  statTitle: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 4,
  },

  value: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
  },

  divider: {
    width: 1,
    height: 54,
    backgroundColor: '#E5E7EB',
  },
});
