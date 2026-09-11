import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

interface MobileContainerProps {
  children: React.ReactNode;
}

export default function MobileContainer({
  children,
}: MobileContainerProps) {
  const { width } = useWindowDimensions();

  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.outer}>
      <View
        style={[
          styles.app,
          isWeb && {
            width: Math.min(width, 430),
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    width: '100%',
    minHeight: '100%',
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
  },

  app: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFFFF',

    // Important for web
    overflow: 'hidden',
  },
});