import { MessageCircle, User as ProfileIcon, Gamepad2 } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { NavigationBar, type NavTabItem } from '@components/design-system';
import type { TabParamList } from './types';

type TabKey = keyof TabParamList;

const TABS: NavTabItem<TabKey>[] = [
  { key: 'ChatsTab', label: 'Chats', icon: MessageCircle },
  { key: 'GameTab', label: 'Game', icon: Gamepad2 },
  { key: 'ProfileTab', label: 'Profile', icon: ProfileIcon },
];

/** Renders the design system's floating-capsule `NavigationBar` (a plain
 * `tabs`/`active`/`onChange` component, unaware of react-navigation) as a
 * `bottom-tabs` custom `tabBar` — matches NocturnalFlowRN's TabBarAdapter.
 * Full-screen views (ChatDetail, SelectContact, ContactProfile) are root-
 * stack pushes over the whole Tab.Navigator, not nested screens inside it,
 * so this never renders while one of them is open — no route-hiding logic
 * needed here. */
export function renderTabBar({ state, navigation }: BottomTabBarProps) {
  const active = state.routeNames[state.index] as TabKey;
  return (
    <NavigationBar tabs={TABS} active={active} onChange={(tab) => navigation.navigate(tab)} />
  );
}
