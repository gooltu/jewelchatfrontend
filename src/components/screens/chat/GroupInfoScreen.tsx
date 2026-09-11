import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Crown, ShieldMinus, ShieldPlus, UserMinus, UserPlus } from 'lucide-react-native';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  typography,
  IconButton,
  InputField,
  ButtonPrimary,
  ButtonGhost,
  Toast,
} from '@components/design-system';
import { ContactAvatar } from '@components/shared/ContactAvatar';
import { useGroupMembers } from '@hooks/useGroupMembers';
import { useSelectableContacts } from '@hooks/useSelectableContacts';
import { useAppSelector } from '@store/hooks';
import * as chatService from '@services/chatService';
import { resolveGroupMemberDisplayName } from '@services/identityService';
import type { RootScreenProps } from '@navigation/types';
import type { GroupMember } from '@app-types/chat';

export function GroupInfoScreen({ navigation, route }: RootScreenProps<'GroupInfo'>) {
  const { chatRoomJid, title } = route.params;
  const styles = useStyles(makeStyles);
  const myJid = useAppSelector((state) => state.auth.jid);
  const { members } = useGroupMembers(chatRoomJid);
  const { contacts } = useSelectableContacts();

  const [roomName, setRoomName] = useState(title);
  const [nameDraft, setNameDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameByJid = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts) {
      if (contact.JID && (contact.CONTACT_NAME || contact.PHONEBOOK_CONTACT_NAME)) {
        map.set(contact.JID, contact.CONTACT_NAME ?? contact.PHONEBOOK_CONTACT_NAME ?? '');
      }
    }
    return map;
  }, [contacts]);

  // Members with no local Contact match (never 1-1 contacted) resolve via
  // the game server instead of ever falling back to a raw JID — see
  // services/identityService.ts. Shrinks to a no-op once everything's
  // resolved, since each pass only requests what's still missing.
  const [resolvedNames, setResolvedNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const unresolved = members
      .map((m) => m.MEMBER_JID)
      .filter((jid): jid is string => !!jid && jid !== myJid && !nameByJid.has(jid) && !resolvedNames.has(jid));
    if (unresolved.length === 0) return;

    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        unresolved.map(async (jid) => [jid, await resolveGroupMemberDisplayName(jid)] as const),
      );
      if (cancelled) return;
      setResolvedNames((prev) => {
        const next = new Map(prev);
        for (const [jid, name] of entries) next.set(jid, name);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [members, nameByJid, resolvedNames, myJid]);

  const isOwner = members.some((m) => m.MEMBER_JID === myJid && m.AFFILIATION === 'owner');

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Group Info' });
  }, [navigation]);

  const runAction = async (action: () => Promise<void>, failureMessage: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === roomName) return;
    void runAction(async () => {
      await chatService.renameGroup(chatRoomJid, trimmed);
      setRoomName(trimmed);
    }, "Couldn't rename the group. Check your connection and try again.");
  };

  const handlePromote = (memberJid: string) =>
    void runAction(
      () => chatService.promoteMember(chatRoomJid, memberJid),
      "Couldn't promote this member. Check your connection and try again.",
    );
  const handleDemote = (memberJid: string) =>
    void runAction(
      () => chatService.demoteMember(chatRoomJid, memberJid),
      "Couldn't demote this member. Check your connection and try again.",
    );
  const handleRemove = (memberJid: string) =>
    void runAction(
      () => chatService.removeMember(chatRoomJid, memberJid),
      "Couldn't remove this member. Check your connection and try again.",
    );

  const handleLeave = () =>
    void runAction(async () => {
      if (!myJid) return;
      await chatService.leaveGroup(chatRoomJid, myJid);
      navigation.popToTop();
    }, "Couldn't leave the group. Check your connection and try again.");

  const handleDestroy = () =>
    void runAction(async () => {
      await chatService.destroyGroup(chatRoomJid);
      navigation.popToTop();
    }, "Couldn't delete the group. Check your connection and try again.");

  const renderMember = ({ item }: { item: GroupMember }) => {
    const jid = item.MEMBER_JID ?? '';
    const isSelf = jid === myJid;
    const name = isSelf ? 'myself' : nameByJid.get(jid) ?? resolvedNames.get(jid) ?? jid;
    const isMemberOwner = item.AFFILIATION === 'owner';

    return (
      <View style={styles.memberRow}>
        <ContactAvatar jid={jid} name={name} />
        <View style={styles.memberBody}>
          <Text style={[typography.headlineMd, styles.memberName]} numberOfLines={1}>
            {name}
          </Text>
          {isMemberOwner && (
            <View style={styles.ownerBadge}>
              <Crown size={12} color={styles.ownerBadgeText.color} />
              <Text style={styles.ownerBadgeText}>Owner</Text>
            </View>
          )}
        </View>
        {isOwner && !isSelf && (
          <View style={styles.memberActions}>
            <IconButton
              icon={isMemberOwner ? ShieldMinus : ShieldPlus}
              onPress={() => (isMemberOwner ? handleDemote(jid) : handlePromote(jid))}
              disabled={busy}
            />
            <IconButton icon={UserMinus} onPress={() => handleRemove(jid)} disabled={busy} />
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Group name</Text>
        {isOwner ? (
          <View style={styles.renameRow}>
            <View style={styles.renameInput}>
              <InputField value={nameDraft} onChangeText={setNameDraft} />
            </View>
            <ButtonPrimary label="Save" onPress={handleRename} disabled={busy || !nameDraft.trim() || nameDraft.trim() === roomName} />
          </View>
        ) : (
          <Text style={[typography.headlineMd, styles.roomName]}>{roomName}</Text>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.membersHeader}>
          <Text style={styles.sectionTitle}>{members.length} member{members.length === 1 ? '' : 's'}</Text>
          {isOwner && (
            <IconButton
              icon={UserPlus}
              onPress={() => navigation.navigate('SelectGroupMembers', { mode: 'add', existingGroupJid: chatRoomJid })}
            />
          )}
        </View>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => String(item._ID)}
        renderItem={renderMember}
        contentContainerStyle={styles.listContent}
      />

      <View style={styles.footer}>
        <ButtonGhost label="Leave group" onPress={handleLeave} disabled={busy} />
        {isOwner && <ButtonGhost label="Delete group" onPress={handleDestroy} disabled={busy} />}
      </View>

      {error ? (
        <View style={styles.toastWrap}>
          <Toast variant="error" title="Something went wrong" description={error} persist />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    sectionTitle: { ...typography.labelLg, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
    roomName: { color: colors.onSurface },
    renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    renameInput: { flex: 1 },
    membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingVertical: spacing.sm,
      minHeight: 44,
    },
    memberBody: { flex: 1, justifyContent: 'center', gap: 2 },
    memberName: { color: colors.onSurface },
    ownerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ownerBadgeText: { ...typography.labelSm, color: colors.onSurfaceVariant },
    memberActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    footer: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
    },
    toastWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  });
