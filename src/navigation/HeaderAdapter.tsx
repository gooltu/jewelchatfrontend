import { Header } from '@components/design-system';
import type { HeaderExtraProps } from './types';

interface HeaderAdapterProps {
  options: { title?: string; headerProps?: HeaderExtraProps };
  back?: { title?: string } | undefined;
  navigation: { goBack: () => void };
}

/** Shared `screenOptions.header` renderer for both the root stack and the tab
 * navigator — renders the design system's `Header` from whatever `options`/
 * `back`/`navigation` the calling navigator passes in. Screens supply the rest
 * of `Header`'s props (subtitle/avatar/actions/gamebar/onTitlePress/...) via
 * the `headerProps` option (see `types.ts`), set through `navigation.setOptions`.
 * Matches NocturnalFlowRN's HeaderAdapter.tsx. */
export function renderHeader({ options, back, navigation }: HeaderAdapterProps) {
  return (
    <Header
      title={options.title ?? ''}
      onBack={back ? () => navigation.goBack() : undefined}
      {...options.headerProps}
    />
  );
}
