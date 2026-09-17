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
        iconColor="#C99752"
        title="Total Network"
        value={formatReferralNumber(stats.totalNetwork)}
      />

      <View style={styles.divider} />

      <Stat
        icon="person"
        iconColor="#4ADE80"
        title="Total Active"
        value={formatReferralNumber(stats.totalActive)}
      />

      <View style={styles.divider} />

      <Stat
        icon="logo-bitcoin"
        iconColor="#FF8F3D"
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
    backgroundColor: '#15161C',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#292B33',
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
    color: '#70737E',
    fontSize: 12,
    marginBottom: 4,
  },

  value: {
    color: '#A1A4AE',
    fontSize: 18,
    fontWeight: '900',
  },

  divider: {
    width: 1,
    height: 54,
    backgroundColor: '#292B33',
  },
});
