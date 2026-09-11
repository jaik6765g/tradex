import '@walletconnect/react-native-compat';
import 'react-native-get-random-values';

import React from 'react';
import { Platform, View } from 'react-native';

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  AppKitProvider as WebAppKitProvider,
} from '@reown/appkit/react';

import {
  AppKitProvider as NativeAppKitProvider,
  AppKit as NativeAppKit,
} from '@reown/appkit-react-native';

import MobileContainer from '../src/shared/components/layout/MobileContainer';
import { appKit } from '../src/wallet/config/wallet';
import { webWalletConfig } from '../src/wallet/config/webWallet';
import { WalletProvider } from '../src/wallet/context/WalletContext';

function AppContent() {
  return (
    <WalletProvider>
      {Platform.OS === 'web' ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#F3F4F6',
          }}
        >
          <MobileContainer>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
          </MobileContainer>
        </View>
      ) : (
        <MobileContainer>
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          />
        </MobileContainer>
      )}
    </WalletProvider>
  );
}

export default function RootLayout() {
  if (Platform.OS === 'web') {
    return (
      <SafeAreaProvider>
        <WebAppKitProvider {...webWalletConfig}>
          <AppContent />
        </WebAppKitProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NativeAppKitProvider instance={appKit}>
        <AppContent />
        <NativeAppKit />
      </NativeAppKitProvider>
    </SafeAreaProvider>
  );
}
