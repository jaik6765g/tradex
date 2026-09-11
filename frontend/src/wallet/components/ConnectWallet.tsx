import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { useWallet } from '../context/WalletContext';

export default function ConnectWallet() {
  const {
    isConnected,
    address,
    openWallet,
  } = useWallet();

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={openWallet}
      activeOpacity={0.8}
    >
      <Ionicons
        name={
          isConnected
            ? 'checkmark-circle'
            : 'wallet-outline'
        }
        size={19}
        color="#FFFFFF"
      />

      <Text style={styles.text}>
        {isConnected
          ? shortAddress
          : 'Connect Wallet'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  text: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
