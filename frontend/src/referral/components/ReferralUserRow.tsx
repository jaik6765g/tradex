import React from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  userId: string;
  percentage: number;
  earned: number;
  active: boolean;
};

export default function ReferralUserRow({
  userId,
  percentage,
  earned,
  active,
}: Props) {
  return (
    <View style={styles.container}>

      <View style={styles.avatar}>
        <Ionicons
          name="person"
          size={19}
          color="#FFFFFF"
        />
      </View>

      <View style={styles.userInfo}>
        <View style={styles.userTop}>
          <Text style={styles.userId}>
            {userId}
          </Text>

          <View
            style={[
              styles.status,
              {
                backgroundColor: active
                  ? '#10251A'
                  : '#1B1917',
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: active
                    ? '#4ADE80'
                    : '#A1A4AE',
                },
              ]}
            />

            <Text
              style={[
                styles.statusText,
                {
                  color: active
                    ? '#15803D'
                    : '#70737E',
                },
              ]}
            >
              {active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>

        <Text style={styles.userLabel}>
          Referral ID
        </Text>
      </View>

      <View style={styles.percentBox}>
        <Text style={styles.percent}>
          {percentage}%
        </Text>

        <Text style={styles.percentLabel}>
          Reward
        </Text>
      </View>

      <View style={styles.earnedBox}>
        <Text style={styles.earned}>
          +{earned.toFixed(2)}
        </Text>

        <Text style={styles.tdx}>
          TDX
        </Text>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 68,
    borderRadius: 14,
    backgroundColor: '#111217',
    borderWidth: 1,
    borderColor: '#292B33',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#211810',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  userInfo: {
    flex: 1,
    minWidth: 0,
  },

  userTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  userId: {
    color: '#A1A4AE',
    fontSize: 12,
    fontWeight: '800',
  },

  userLabel: {
    color: '#A1A4AE',
    fontSize: 9,
    marginTop: 2,
  },

  status: {
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },

  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },

  statusText: {
    fontSize: 8,
    fontWeight: '700',
  },

  percentBox: {
    width: 48,
    alignItems: 'center',
  },

  percent: {
    color: '#C99752',
    fontSize: 13,
    fontWeight: '900',
  },

  percentLabel: {
    color: '#A1A4AE',
    fontSize: 8,
    marginTop: 1,
  },

  earnedBox: {
    width: 76,
    alignItems: 'flex-end',
  },

  earned: {
    color: '#4ADE80',
    fontSize: 13,
    fontWeight: '900',
  },

  tdx: {
    color: '#70737E',
    fontSize: 8,
    marginTop: 1,
  },
});
