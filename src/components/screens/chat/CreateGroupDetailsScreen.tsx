import { useLayoutEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  typography,
  InputField,
  ButtonPrimary,
  Toast,
} from '@components/design-system';
import { useAppSelector } from '@store/hooks';
import * as chatService from '@services/chatService';
import type { RootScreenProps } from '@navigation/types';

export function CreateGroupDetailsScreen({ navigation, route }: RootScreenProps<'CreateGroupDetails'>) {
  const { members } = route.params;
  const styles = useStyles(makeStyles);
  const myJid = useAppSelector((state) => state.auth.jid);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'New Group' });
  }, [navigation]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || !myJid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { roomJid } = await chatService.createGroup({
        name: trimmed,
        memberJids: members.map((m) => m.jid),
        myJid,
      });
      navigation.popToTop();
      navigation.navigate('ChatDetail', { chatRoomJid: roomJid, title: trimmed, isGroup: true });
    } catch {
      setError('Could not create the group. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={[typography.labelLg, styles.label]}>Group name</Text>
          <InputField placeholder="e.g. Weekend Trip" value={name} onChangeText={setName} autoFocus />

          <Text style={[typography.labelLg, styles.label, styles.membersLabel]}>
            {members.length} member{members.length === 1 ? '' : 's'}
          </Text>
          <Text style={[typography.bodyMd, styles.membersList]} numberOfLines={3}>
            {members.map((m) => m.name).join(', ')}
          </Text>

          <View style={styles.createButton}>
            <ButtonPrimary
              label="Create"
              onPress={() => void handleCreate()}
              disabled={!name.trim() || submitting}
            />
          </View>

          {error ? (
            <View style={styles.toastWrap}>
              <Toast variant="error" title="Couldn't create group" description={error} persist />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    flex: { flex: 1 },
    content: { padding: spacing.lg },
    label: { color: colors.onSurfaceVariant, marginBottom: spacing.xs },
    membersLabel: { marginTop: spacing.lg },
    membersList: { color: colors.onSurface },
    createButton: { marginTop: spacing.xl },
    toastWrap: { marginTop: spacing.md },
  });
