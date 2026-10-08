import { Avatar } from '@components/design-system';
import { useAvatarSource } from '@hooks/useAvatarSource';
import { initialsFor } from '../../utils/initials';

interface ContactAvatarProps {
  jid: string | null;
  name: string | null;
  size?: number;
}

/**
 * useAvatarSource already guarantees "only a confirmed-loadable local
 * source, or undefined" (downloaded-and-cached-to-disk — see
 * profilePicService.ts), so there's no need for a manual overlay/fade-in/
 * onError dance here: the design system's Avatar already falls back to
 * initials whenever `source` is absent, which is exactly the `undefined`
 * case.
 */
export function ContactAvatar({ jid, name, size = 48 }: ContactAvatarProps) {
  const source = useAvatarSource(jid);
  return <Avatar source={source} initials={initialsFor(name)} size={size} />;
}
