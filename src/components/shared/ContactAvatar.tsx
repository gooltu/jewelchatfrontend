import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar } from '@components/design-system';
import { getProfilePicUrl } from '../../utils/profilePic';

interface ContactAvatarProps {
  jid: string | null;
  name: string | null;
  size?: number;
}

function initialsFor(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/**
 * The design system's Avatar only falls back to initials when `source` is
 * absent, not when it 404s (plain RN Image, no onError) — the S3 profile-pic
 * bucket isn't live yet, so every load fails today. This renders the
 * initials Avatar as the base layer and fades in the remote image only once
 * it has actually loaded, so a failed load just never appears instead of
 * showing a broken image.
 */
export function ContactAvatar({ jid, name, size = 48 }: ContactAvatarProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <View style={{ width: size, height: size }}>
      <Avatar initials={initialsFor(name)} size={size} />
      {!!jid && (
        <Image
          source={{ uri: getProfilePicUrl(jid) }}
          style={[styles.overlay, { borderRadius: size / 2, opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
          cachePolicy="memory-disk"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
