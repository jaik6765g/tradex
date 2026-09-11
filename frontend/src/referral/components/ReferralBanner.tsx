import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  referralLink: string;
  onCopy: () => void;
  onShare: () => void;
};

export default function ReferralBanner({
                                         referralLink,
                                         onCopy,
                                         onShare,
                                       }: Props) {
  return (
      <View style={styles.container}>
        {/* Subtle Glow Background */}
        <View style={styles.glowBackground} />

        <View style={styles.content}>
          <Text style={styles.title}>
            Refer <Text style={styles.yellow}>& Earn</Text>
          </Text>

          <Text style={styles.description}>
            Invite friends & earn TDX rewards
          </Text>

          <View style={styles.linkBox}>
            <Text
                style={styles.linkText}
                numberOfLines={1}
            >
              {referralLink}
            </Text>

            <Pressable
                style={styles.copyButton}
                onPress={onCopy}
            >
              <Ionicons
                  name="copy-outline"
                  size={16}
                  color="#111827"
              />
            </Pressable>
          </View>

          {/* Share Buttons - Compact Row */}
          <View style={styles.shareRow}>
            <Text style={styles.shareLabel}>Share via</Text>
            <Pressable
                style={[styles.shareButton, styles.whatsapp]}
                onPress={onShare}
            >
              <Ionicons
                  name="logo-whatsapp"
                  size={16}
                  color="#FFFFFF"
              />
            </Pressable>

            <Pressable
                style={[styles.shareButton, styles.telegram]}
                onPress={onShare}
            >
              <Ionicons
                  name="paper-plane"
                  size={15}
                  color="#FFFFFF"
              />
            </Pressable>

            <Pressable
                style={[styles.shareButton, styles.other]}
                onPress={onShare}
            >
              <Ionicons
                  name="share-outline"
                  size={16}
                  color="#FFFFFF"
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.giftArea}>
          <View style={styles.giftGlow}>
            <Ionicons
                name="gift"
                size={48}
                color="#FBBF24"
            />
          </View>
        </View>
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 140,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0D1B2A',
    flexDirection: 'row',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },

  glowBackground: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(251,191,36,0.08)',
    top: -40,
    right: -40,
  },

  content: {
    flex: 1.6,
    padding: 12,
    justifyContent: 'center',
  },

  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 3,
  },

  yellow: {
    color: '#FBBF24',
  },

  description: {
    color: '#D0D5DD',
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },

  linkBox: {
    height: 36,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.2)',
    borderRadius: 8,
    backgroundColor: 'rgba(16,28,45,0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 8,
  },

  linkText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 10,
    paddingHorizontal: 8,
  },

  copyButton: {
    width: 36,
    height: 36,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
  },

  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  shareLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
    marginRight: 2,
  },

  shareButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  whatsapp: {
    backgroundColor: '#22C55E',
  },

  telegram: {
    backgroundColor: '#229ED9',
  },

  other: {
    backgroundColor: '#475569',
  },

  giftArea: {
    flex: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 10,
  },

  giftGlow: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.2)',
  },
});