import { Header, subTestID, testIDSegment } from '@components/design-system';
import type { HeaderExtraProps } from './types';

interface HeaderAdapterProps {
  options: { title?: string; headerProps?: HeaderExtraProps };
  back?: { title?: string } | undefined;
  navigation: { goBack: () => void };
  route: { name: string };
}

/** Shared `screenOptions.header` renderer for both the root stack and the tab
 * navigator — renders the design system's `Header` from whatever `options`/
 * `back`/`navigation` the calling navigator passes in. Screens supply the rest
 * of `Header`'s props (subtitle/avatar/actions/gamebar/onIdentityPress/...) via
 * the `headerProps` option (see `types.ts`), set through `navigation.setOptions`.
 * Matches NocturnalFlowRN's HeaderAdapter.tsx. */
export function renderHeader({ options, back, navigation, route }: HeaderAdapterProps) {
  return (
    <Header
      title={options.title ?? ''}
      onBack={back ? () => navigation.goBack() : undefined}
      // `<route>.header` (e.g. `chat-detail.header.subtitle`) — every screen's
      // header gets a stable E2E id for free; a screen can still override it
      // through `headerProps.testID`.
      testID={subTestID(testIDSegment(route.name), 'header')}
      {...options.headerProps}
    />
  );
}
