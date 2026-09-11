import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function ShareBottomSheet({
  visible,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
      >
        <Pressable
          style={styles.sheet}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />

          <Text style={styles.title}>
            Share Referral Link
          </Text>

          <Text style={styles.subtitle}>
            Invite your friends to TradeX
          </Text>

          <View style={styles.options}>
            <ShareOption
              icon="logo-whatsapp"
              color="#22C55E"
              title="WhatsApp"
            />

            <ShareOption
              icon="paper-plane"
              color="#229ED9"
              title="Telegram"
            />

            <ShareOption
              icon="share-social"
              color="#F59E0B"
              title="Other"
            />
          </View>

          <Pressable
            style={styles.cancel}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>
              Cancel
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ShareOption({
  icon,
  color,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
}) {
  return (
    <Pressable style={styles.option}>
      <View
        style={[
          styles.optionIcon,
          { backgroundColor: color },
        ]}
      >
        <Ionicons
          name={icon}
          size={24}
          color="#FFFFFF"
        />
      </View>

      <Text style={styles.optionText}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },

  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
  },

  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 20,
  },

  title: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },

  subtitle: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 5,
  },

  options: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginTop: 25,
  },

  option: {
    alignItems: 'center',
  },

  optionIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },

  optionText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 7,
  },

  cancel: {
    height: 48,
    borderRadius: 13,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },

  cancelText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
});
