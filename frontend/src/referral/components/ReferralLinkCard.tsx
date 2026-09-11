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
          color="#F59E0B"
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
            color="#111827"
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
          color="#111827"
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
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 14,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 13,
  },

  title: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
  },

  subtitle: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
  },

  linkRow: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },

  link: {
    flex: 1,
    paddingHorizontal: 12,
    color: '#374151',
    fontSize: 13,
  },

  copy: {
    width: 48,
    height: 48,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
  },

  share: {
    height: 42,
    marginTop: 10,
    borderRadius: 11,
    backgroundColor: '#FFF7E0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    opacity: 1,
  },

  shareText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 13,
  },
});