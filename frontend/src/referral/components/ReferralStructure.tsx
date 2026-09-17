// ============================================================
// REFERRAL STRUCTURE (PREMIUM DARK THEME)
// ============================================================

import React, { useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import ReferralUserRow from './ReferralUserRow';

import {
  REFERRAL_COLORS,
  getReferralLevels,
} from '../constants/referralLevels';

import { ReferralType } from '../types/referral';

if (
    Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  type: ReferralType;
};

// ============================================================
// DEMO DATA HELPER (Remove when API connected)
// ============================================================

function getDemoUsers(
    level: number,
    percentage: number,
) {
  const counts = [3, 2, 2, 1, 1, 1];
  const count = counts[level - 1] ?? 0;

  return Array.from(
      { length: count },
      (_, index) => ({
        userId: `TX-${level}${String(index + 1).padStart(4, '0')}`,
        level,
        percentage,
        earned: (level * 17.35) + (index * 11.25),
        active: index !== count - 1,
      }),
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function ReferralStructure({
                                            type,
                                          }: Props) {
  const levels = getReferralLevels(type);

  const [expandedLevel, setExpandedLevel] = useState<number | null>(1);

  const toggleLevel = (level: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedLevel(expandedLevel === level ? null : level);
  };

  const totalNetworkEarnings = levels.reduce(
      (sum, level) =>
          sum +
          getDemoUsers(level.level, level.percentage).reduce(
              (s, u) => s + u.earned,
              0,
          ),
      0,
  );

  return (
      <View style={styles.card}>
        {/* Ambient Glows */}
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>
              Referral Network
            </Text>

            <Text style={styles.subtitle}>
              6-level earning structure
            </Text>
          </View>

          <View style={styles.levelBadge}>
            <Ionicons
                name="git-network-outline"
                size={15}
                color="#FF8F3D"
            />

            <Text style={styles.levelBadgeText}>
              6 Levels
            </Text>
          </View>
        </View>

        {/* Root Node - YOU */}
        <View style={styles.rootNode}>
          <View style={styles.rootGlow} />
          <View style={styles.rootCard}>
            <View style={styles.rootAvatar}>
              <Ionicons name="person" size={25} color="#FFFFFF" />
            </View>

            <View style={styles.rootInfo}>
              <Text style={styles.rootLabel}>Your Network</Text>
              <Text style={styles.rootId}>TX-00001</Text>
            </View>

            <View style={styles.rootEarnings}>
              <Text style={styles.rootEarnedLabel}>Total Earned</Text>
              <Text style={styles.rootEarnedValue}>
                +{totalNetworkEarnings.toFixed(2)} TDX
              </Text>
            </View>
          </View>
        </View>

        {/* Tree Line */}
        <View style={styles.treeLine} />

        {/* Levels */}
        {levels.map((level, index) => {
          const color = REFERRAL_COLORS[index];
          const expanded = expandedLevel === level.level;

          const users = getDemoUsers(level.level, level.percentage);
          const totalEarned = users.reduce((sum, user) => sum + user.earned, 0);

          return (
              <View key={level.level} style={styles.levelContainer}>
                {/* Level Header */}
                <Pressable
                    onPress={() => toggleLevel(level.level)}
                    style={[
                      styles.levelHeader,
                      expanded && {
                        borderColor: `${color}55`,
                        backgroundColor: `${color}08`,
                      },
                    ]}
                >
                  <View
                      style={[
                        styles.levelIcon,
                        { backgroundColor: `${color}18` },
                      ]}
                  >
                    <Text style={[styles.levelNumber, { color }]}>
                      {level.level}
                    </Text>
                  </View>

                  <View style={styles.levelInfo}>
                    <Text style={styles.levelTitle}>
                      Level {level.level}
                    </Text>

                    <Text style={styles.levelMeta}>
                      {level.direct
                          ? 'Direct referrals'
                          : 'Indirect referrals'}
                    </Text>
                  </View>

                  <View style={styles.levelStats}>
                    <Text style={[styles.percentage, { color }]}>
                      {level.percentage}%
                    </Text>

                    <Text style={styles.memberCount}>
                      {users.length} users
                    </Text>
                  </View>

                  <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color="#70737E"
                  />
                </Pressable>

                {/* Expanded Users Tree */}
                {expanded && (
                    <View style={styles.usersContainer}>
                      {/* Earnings Summary */}
                      <View style={styles.earningSummary}>
                        <View>
                          <Text style={styles.summaryLabel}>
                            Level Earnings
                          </Text>

                          <Text style={[styles.summaryValue, { color }]}>
                            +{totalEarned.toFixed(2)} TDX
                          </Text>
                        </View>

                        <View style={styles.summaryRight}>
                          <Text style={styles.summaryLabel}>
                            Commission
                          </Text>

                          <Text style={styles.summaryCommission}>
                            {level.percentage}%
                          </Text>
                        </View>
                      </View>

                      {/* User Rows */}
                      {users.length === 0 ? (
                          <View style={styles.empty}>
                            <Ionicons
                                name="people-outline"
                                size={25}
                                color="#34343E"
                            />

                            <Text style={styles.emptyText}>
                              No referrals in this level yet
                            </Text>
                          </View>
                      ) : (
                          users.map((user) => (
                              <ReferralUserRow
                                  key={user.userId}
                                  userId={user.userId}
                                  percentage={user.percentage}
                                  earned={user.earned}
                                  active={user.active}
                              />
                          ))
                      )}
                    </View>
                )}
              </View>
          );
        })}
      </View>
  );
}

// ============================================================
// STYLES (PREMIUM DARK)
// ============================================================

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#211810',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },

  glowTop: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,122,24,0.05)',
    top: -50,
    right: -50,
  },

  glowBottom: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,122,24,0.03)',
    bottom: -30,
    left: -30,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },

  title: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '900',
  },

  subtitle: {
    color: '#70737E',
    fontSize: 11,
    marginTop: 3,
  },

  levelBadge: {
    backgroundColor: 'rgba(255,122,24,0.1)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,122,24,0.2)',
  },

  levelBadgeText: {
    color: '#FF7A18',
    fontSize: 10,
    fontWeight: '800',
  },

  rootNode: {
    alignItems: 'center',
    marginBottom: 8,
    position: 'relative',
  },

  rootGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,122,24,0.06)',
    top: -20,
  },

  rootCard: {
    width: '100%',
    backgroundColor: '#211810',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,122,24,0.2)',
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#FF7A18',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },

  rootAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#34261C',
    alignItems: 'center',
    justifyContent: 'center',
  },

  rootInfo: {
    flex: 1,
    marginLeft: 11,
  },

  rootLabel: {
    color: '#34343E',
    fontSize: 10,
  },

  rootId: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3,
  },

  rootEarnings: {
    alignItems: 'flex-end',
  },

  rootEarnedLabel: {
    color: '#A1A4AE',
    fontSize: 9,
  },

  rootEarnedValue: {
    color: '#FF7A18',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 3,
  },

  treeLine: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'center',
  },

  levelContainer: {
    marginBottom: 8,
  },

  levelHeader: {
    minHeight: 66,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#211810',
  },

  levelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  levelNumber: {
    fontSize: 15,
    fontWeight: '900',
  },

  levelInfo: {
    flex: 1,
    marginLeft: 10,
  },

  levelTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },

  levelMeta: {
    color: '#A1A4AE',
    fontSize: 9,
    marginTop: 3,
  },

  levelStats: {
    alignItems: 'flex-end',
    marginRight: 9,
  },

  percentage: {
    fontSize: 15,
    fontWeight: '900',
  },

  memberCount: {
    color: '#A1A4AE',
    fontSize: 9,
    marginTop: 2,
  },

  usersContainer: {
    marginTop: 5,
    marginLeft: 18,
    paddingLeft: 14,
    borderLeftWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  earningSummary: {
    minHeight: 55,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  summaryLabel: {
    color: '#70737E',
    fontSize: 9,
  },

  summaryValue: {
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },

  summaryRight: {
    alignItems: 'flex-end',
  },

  summaryCommission: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },

  empty: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyText: {
    color: '#A1A4AE',
    fontSize: 11,
    marginTop: 5,
  },
});