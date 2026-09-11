import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  totalNetwork: number;
  totalActive: number;
  totalEarned: number;
};

export default function ReferralBottomSummary({
  totalNetwork,
  totalActive,
  totalEarned,
}: Props) {
  return (
    <View style={styles.card}>
      <Summary
        title="Total Network"
        value={totalNetwork.toLocaleString()}
        icon="people"
        color="#7C3AED"
      />

      <View style={styles.divider} />

      <Summary
        title="Total Active"
        value={totalActive.toLocaleString()}
        icon="person"
        color="#16A34A"
      />

      <View style={styles.divider} />

      <Summary
        title="Total Earned"
        value={`${totalEarned.toLocaleString()} TDX`}
        icon="logo-bitcoin"
        color="#F59E0B"
      />
    </View>
  );
}

function Summary({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={styles.item}>
      <View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>

      <View
        style={[
          styles.icon,
          { backgroundColor: `${color}15` },
        ]}
      >
        <Ionicons
          name={icon}
          size={21}
          color={color}
        />
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
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  item: {
    flex: 1,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  title: {
    color: '#64748B',
    fontSize: 11,
    marginBottom: 4,
  },

  value: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
  },

  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  divider: {
    width: 1,
    height: 48,
    backgroundColor: '#E5E7EB',
  },
});
