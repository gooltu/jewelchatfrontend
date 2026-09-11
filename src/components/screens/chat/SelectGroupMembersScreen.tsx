import { useLayoutEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  typography,
  states,
  IconButton,
  EmptyState,
  SkeletonRow,
  Toast,
} from '@components/design-system';
import { ContactAvatar } from '@components/shared/ContactAvatar';
import { useSelectableContacts, isActive } from '@hooks/useSelectableContacts';
import { useGroupMembers } from '@hooks/useGroupMembers';
import * as chatService from '@services/chatService';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';
import type { Contact } from '@app-types/chat';

/**
 * Two modes off one route (see RootStackParamList.SelectGroupMembers):
 * `create` (default) proceeds to CreateGroupDetails once at least one
 * contact is selected. `add` (from GroupInfoScreen's "Add members") instead
 * invites each selection into an already-existing room directly and pops
 * back — no name step needed, the room already has one.
 */
export function SelectGroupMembersScreen({ navigation, route }: RootScreenProps<'SelectGroupMembers'>) {
  const styles = useStyles(makeStyles);
  const params = route.params ?? {};
  const isAddMode = params.mode === 'add';
  const existingGroupJid = isAddMode ? params.existingGroupJid : null;

  const { contacts, loading } = useSelectableContacts();
  const { members: existingMembers } = useGroupMembers(existingGroupJid);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingMemberJids = useMemo(
    () => new Set(existingMembers.map((member) => member.MEMBER_JID)),
    [existingMembers],
  );
  const selectableContacts = useMemo(
    () => contacts.filter((c) => isActive(c) && !(c.JID && existingMemberJids.has(c.JID))),
    [contacts, existingMemberJids],
  );

  const toggle = (contact: Contact) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contact._ID)) next.delete(contact._ID);
      else next.add(contact._ID);
      return next;
    });
  };

  const handleNext = async () => {
    const chosen = selectableContacts.filter((c) => selected.has(c._ID) && c.JID);
    if (chosen.length === 0 || submitting) return;

    if (!isAddMode) {
      navigation.navigate('CreateGroupDetails', {
        members: chosen.map((c) => ({
          jid: c.JID as string,
          name: c.CONTACT_NAME ?? c.PHONEBOOK_CONTACT_NAME ?? (c.JID as string),
        })),
      });
      return;
    }

    if (!existingGroupJid) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const contact of chosen) {
        await chatService.inviteMember(existingGroupJid, contact.JID as string);
      }
      navigation.goBack();
    } catch {
      setError('Could not add members. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: isAddMode ? 'Add members' : 'New Group',
      headerProps: {
        actions: [
          {
            key: 'next',
            label: isAddMode ? 'Add' : 'Next',
            icon: Check,
            disabled: selected.size === 0 || submitting,
            onPress: () => void handleNext(),
          },
        ],
      },
    };
    navigation.setOptions(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isAddMode, selected, submitting, selectableContacts]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : selectableContacts.length === 0 ? (
        <EmptyState
          title="No contacts available"
          description={
            isAddMode
              ? 'Everyone in your contacts is already in this group.'
              : "You don't have any active contacts to add yet."
          }
        />
      ) : (
        <FlatList
          data={selectableContacts}
          keyExtractor={(item) => String(item._ID)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSelected = selected.has(item._ID);
            return (
              <Pressable
                onPress={() => toggle(item)}
                style={({ pressed }) => [styles.row, pressed && { opacity: states.pressedOpacity }]}
              >
                <ContactAvatar
                  jid={item.JID}
                  name={item.CONTACT_NAME ?? item.PHONEBOOK_CONTACT_NAME}
                />
                <View style={styles.rowBody}>
                  <Text style={[typography.headlineMd, styles.name]} numberOfLines={1}>
                    {item.CONTACT_NAME ?? item.PHONEBOOK_CONTACT_NAME ?? 'Unknown'}
                  </Text>
                </View>
                <IconButton icon={Check} active={isSelected} onPress={() => toggle(item)} />
              </Pressable>
            );
          }}
        />
      )}

      {error ? (
        <View style={styles.toastWrap}>
          <Toast variant="error" title="Couldn't add members" description={error} persist />
        </View>
      ) : null}
      {submitting && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" />
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    list: { flex: 1 },
    listContent: { paddingBottom: spacing.lg },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.marginMobile,
      paddingVertical: spacing.sm,
      gap: spacing.sm + 2,
      minHeight: 44,
    },
    rowBody: { flex: 1, justifyContent: 'center' },
    name: { color: colors.onSurface },
    toastWrap: { paddingHorizontal: spacing.marginMobile, paddingBottom: spacing.sm },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.backdrop,
    },
  });
