import { useLayoutEffect, useState } from 'react';
import { User } from 'lucide-react-native';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  ButtonPrimary,
  Toast,
  spacing,
} from '@components/design-system';
import { useAppSelector } from '@store/hooks';
import { useAvatarSource } from '@hooks/useAvatarSource';
import { setTransientBackgroundExpected } from '@hooks/useAppState';
import * as profilePicService from '@services/profilePicService';
import { checkMediaCaps } from '@media/mediaUploadService';
import type { RootScreenProps } from '@navigation/types';

const AVATAR_SIZE = 200;

/**
 * Pushed from the Profile tab's avatar tap. Simple foreground action, no
 * offline-queue machinery (unlike chat messages, there's no peer to send
 * to) — a failed upload just toasts and leaves the user to tap "Change
 * Photo" again, no retry queue.
 */
export function EditProfilePictureScreen({ navigation }: RootScreenProps<'EditProfilePicture'>) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const myJid = useAppSelector((state) => state.auth.jid);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ variant: 'success' | 'warning'; message: string } | null>(null);
  // Bumped on successful upload to force useAvatarSource to re-resolve —
  // myJid itself doesn't change, only the underlying photo does, so the
  // hook's own jid-change detection wouldn't otherwise re-trigger it.
  const [refreshKey, setRefreshKey] = useState(0);
  const avatarSource = useAvatarSource(myJid, refreshKey);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Profile Picture' });
  }, [navigation]);

  const handleChangePhoto = async () => {
    // The picker launches a separate Activity on Android, genuinely
    // pausing this one — see useAppState.ts's setTransientBackgroundExpected
    // doc comment for why that must not trigger a chat-session reset.
    setTransientBackgroundExpected(true);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
    } finally {
      setTransientBackgroundExpected(false);
    }
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    const capCheck = checkMediaCaps(asset);
    if (!capCheck.ok) {
      setToast({ variant: 'warning', message: capCheck.reason ?? "That photo can't be used." });
      return;
    }

    setUploading(true);
    try {
      await profilePicService.uploadMyProfilePic(asset);
      setRefreshKey((key) => key + 1);
      setToast({ variant: 'success', message: 'Profile picture updated.' });
    } catch (error) {
      if (__DEV__) console.log('[EditProfilePictureScreen] upload failed:', error);
      setToast({ variant: 'warning', message: "Couldn't upload that photo — try again." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.content}>
        <View style={styles.avatarWrap}>
          {avatarSource ? (
            <Image source={avatarSource} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarImage, styles.placeholder]}>
              <User size={72} strokeWidth={1.5} color={colors.onSurfaceVariant} />
            </View>
          )}
          {uploading ? (
            <View style={styles.spinnerOverlay}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          ) : null}
        </View>

        <ButtonPrimary label="Change Photo" onPress={() => void handleChangePhoto()} disabled={uploading} />
      </View>

      {toast ? (
        <View style={styles.toastWrap}>
          <Toast variant={toast.variant} title={toast.message} onDismiss={() => setToast(null)} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl, padding: spacing.xl },
    avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    avatarImage: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: colors.surfaceContainerHigh,
    },
    placeholder: { alignItems: 'center', justifyContent: 'center' },
    spinnerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    toastWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing.gutterChat,
      paddingTop: spacing.sm,
    },
  });
