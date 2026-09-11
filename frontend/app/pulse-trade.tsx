import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function PulseTradeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pulse Trade</Text>
      <Text style={styles.text}>
        Pulse Trade module coming next.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FB',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#101828',
  },
  text: {
    marginTop: 10,
    color: '#667085',
  },
});
