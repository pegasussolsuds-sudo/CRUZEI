import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, radius, typography } from '../theme';

export interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: number;
  isOnline?: boolean;
  isVerified?: boolean;
  isAnonymous?: boolean;
}

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  uri,
  name,
  size = 48,
  isOnline,
  isVerified,
  isAnonymous,
}: AvatarProps) {
  const dotSize = Math.max(8, Math.round(size * 0.22));
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.base,
          {
            width: size,
            height: size,
            borderRadius: radius.full,
            backgroundColor: isAnonymous ? colors.gray[200] : colors.gray[100],
          },
        ]}
      >
        {uri && !isAnonymous ? (
          <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.full }} />
        ) : (
          <Text style={[typography.h3, { color: colors.gray[600] }]}>{initials(name)}</Text>
        )}
      </View>
      {isOnline ? (
        <View
          style={[
            styles.online,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              right: 0,
              bottom: 0,
            },
          ]}
        />
      ) : null}
      {isVerified ? (
        <View
          style={[
            styles.verified,
            {
              width: dotSize + 4,
              height: dotSize + 4,
              borderRadius: (dotSize + 4) / 2,
              right: -2,
              top: -2,
            },
          ]}
        >
          <Text style={styles.verifiedCheck}>✓</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  online: { position: 'absolute', backgroundColor: colors.online, borderWidth: 2, borderColor: colors.surface },
  verified: { position: 'absolute', backgroundColor: colors.info, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  verifiedCheck: { color: colors.white, fontSize: 8, fontWeight: '800' },
});

export default Avatar;
