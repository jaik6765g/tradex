import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  referralLink: string;
  onCopy: () => void;
  onShare: () => void;
};

export default function ReferralLinkCard({
  referralLink,
  onCopy,
  onShare,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Your Referral Link</Text>
          <Text style={styles.subtitle}>
            Share your link and invite new users
          </Text>
        </View>

        <Ionicons
          name="link-outline"
          size={24}
          color="#FF8F3D"
        />
      </View>

      <View style={styles.linkRow}>
        <Text
          style={styles.link}
          numberOfLines={1}
        >
          {referralLink || 'Loading...'}
        </Text>

        <Pressable
          style={styles.copy}
          onPress={onCopy}
          disabled={!referralLink}
        >
          <Ionicons
            name="copy-outline"
            size={19}
            color="#292B33"
          />
        </Pressable>
      </View>

      <Pressable
        style={styles.share}
        onPress={onShare}
        disabled={!referralLink}
      >
        <Ionicons
          name="share-social-outline"
          size={18}
          color="#292B33"
        />

        <Text style={styles.shareText}>
          Share Referral Link
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#15161C',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#292B33',
    padding: 16,
    marginBottom: 14,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 13,
  },

  title: {
    color: '#A1A4AE',
    fontSize: 17,
    fontWeight: '800',
  },

  subtitle: {
    color: '#70737E',
    fontSize: 12,
    marginTop: 4,
  },

  linkRow: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#292B33',
    backgroundColor: '#15161C',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },

  link: {
    flex: 1,
    paddingHorizontal: 12,
    color: '#70737E',
    fontSize: 13,
  },

  copy: {
    width: 48,
    height: 48,
    backgroundColor: '#FF7A18',
    alignItems: 'center',
    justifyContent: 'center',
  },

  share: {
    height: 42,
    marginTop: 10,
    borderRadius: 11,
    backgroundColor: '#2A190D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    opacity: 1,
  },

  shareText: {
    color: '#A1A4AE',
    fontWeight: '700',
    fontSize: 13,
  },
});