import { useLayoutEffect, useState } from 'react';
import { Check } from 'lucide-react-native';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
} from '@components/design-system';
import { ContactAvatar } from '@components/shared/ContactAvatar';
import { useConversations } from '@hooks/useConversations';
import * as chatService from '@services/chatService';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';

/** Pushed from MessageActionSheet's "Forward" action. Multi-select target picker — reuses the same conversation list ChatListScreen renders, so groups are selectable too. */
export function ForwardMessageScreen({ navigation, route }: RootScreenProps<'ForwardMessage'>) {
  const { message } = route.params;
  const styles = useStyles(makeStyles);
  const { conversations, loading } = useConversations();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (jid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const handleForward = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await chatService.forwardMessage(message, Array.from(selected));
      navigation.goBack();
    } finally {
      setSubmitting(false);
    }
  };

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: `Forward${selected.size > 0 ? ` (${selected.size})` : ''}`,
      headerProps: {
        actions: [
          {
            key: 'forward',
            label: 'Forward',
            icon: Check,
            disabled: selected.size === 0 || submitting,
            onPress: () => void handleForward(),
          },
        ],
      },
    };
    navigation.setOptions(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, selected, submitting]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : conversations.length === 0 ? (
        <EmptyState title="No conversations" description="Start a conversation first to forward to it." />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item._ID)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if (!item.JID) return null;
            const jid = item.JID;
            const isSelected = selected.has(jid);
            const name = item.CONTACT_NAME ?? item.PHONEBOOK_CONTACT_NAME ?? 'Unknown User';
            return (
              <Pressable
                onPress={() => toggle(jid)}
                style={({ pressed }) => [styles.row, pressed && { opacity: states.pressedOpacity }]}
              >
                <ContactAvatar jid={jid} name={name} />
                <View style={styles.rowBody}>
                  <Text style={[typography.headlineMd, styles.name]} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <IconButton icon={Check} active={isSelected} onPress={() => toggle(jid)} />
              </Pressable>
            );
          }}
        />
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
  });
