import { useLayoutEffect, useState } from 'react';
import { Search } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  typography,
  states,
  EmptyState,
  SkeletonRow,
  ButtonPrimary,
  InputField,
} from '@components/design-system';
import { ContactAvatar } from '@components/shared/ContactAvatar';
import { useSelectableContacts } from '@hooks/useSelectableContacts';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { resolveContactOnTap } from '@services/contactSyncService';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';
import type { Contact } from '@app-types/chat';

export function SelectContactScreen({ navigation }: RootScreenProps<'SelectContact'>) {
  const styles = useStyles(makeStyles);
  const { contacts, loading } = useSelectableContacts();
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [query, setQuery] = useState('');
  const gamebar = useGamebarStats();

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: 'Contacts',
      headerProps: {
        actions: [
          {
            key: 'search',
            label: 'Search contacts',
            icon: Search,
            active: searchVisible,
            onPress: () => setSearchVisible((v) => !v),
          },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, gamebar, searchVisible]);

  const filtered =
    searchVisible && query.trim()
      ? contacts.filter((c) => {
          const q = query.trim().toLowerCase();
          const name = (c.CONTACT_NAME ?? c.PHONEBOOK_CONTACT_NAME ?? '').toLowerCase();
          const phone = String(c.CONTACT_NUMBER ?? '');
          return name.includes(q) || phone.includes(q.replace(/\D/g, '') || q);
        })
      : contacts;

  const handlePress = async (contact: Contact) => {
    if (resolvingId !== null) return;
    setResolvingId(contact._ID);
    try {
      const result = await resolveContactOnTap(contact);
      if (result.outcome === 'chat') {
        navigation.navigate('ChatDetail', {
          chatRoomJid: result.jid,
          title: contact.CONTACT_NAME ?? contact.PHONEBOOK_CONTACT_NAME ?? result.jid,
          isGroup: false,
        });
      } else {
        navigation.navigate('ContactProfile', {
          name: contact.CONTACT_NAME ?? contact.PHONEBOOK_CONTACT_NAME,
          phone: contact.CONTACT_NUMBER,
        });
      }
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.createGroupWrap}>
        <ButtonPrimary
          label="Create group"
          onPress={() => navigation.navigate('SelectGroupMembers', {})}
        />
      </View>

      {searchVisible && (
        <View style={styles.searchWrap}>
          <InputField
            icon={Search}
            placeholder="Search by name or phone"
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
        </View>
      )}

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query.trim() ? 'No matches' : 'No contacts found'}
          description={
            query.trim()
              ? `Nothing matches "${query.trim()}". Try a different name or number.`
              : "We couldn't find any contacts on your phone."
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item._ID)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handlePress(item)}
              disabled={resolvingId !== null}
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
                {item.CONTACT_NUMBER != null && (
                  <Text style={[typography.bodyMd, styles.number]} numberOfLines={1}>
                    {item.CONTACT_NUMBER}
                  </Text>
                )}
              </View>
              {resolvingId === item._ID && <ActivityIndicator size="small" />}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    createGroupWrap: { paddingHorizontal: spacing.marginMobile, paddingVertical: spacing.sm },
    searchWrap: { paddingHorizontal: spacing.marginMobile, paddingVertical: spacing.sm },
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
    number: { color: colors.onSurfaceVariant, marginTop: 2 },
  });
