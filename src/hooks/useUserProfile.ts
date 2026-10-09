import { useCallback, useEffect, useState } from 'react';
import { getUserProfile, type UserProfileInfo, type UserProfileJewel } from '@gameserver/getUserProfileApi';

interface UseUserProfileResult {
  user: UserProfileInfo | null;
  jewels: UserProfileJewel[];
  loading: boolean;
}

export function useUserProfile(userId: number | null): UseUserProfileResult {
  const [user, setUser] = useState<UserProfileInfo | null>(null);
  const [jewels, setJewels] = useState<UserProfileJewel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (userId === null) {
      setUser(null);
      setJewels([]);
      setLoading(false);
      return;
    }
    const result = await getUserProfile(userId);
    setUser(result?.user ?? null);
    setJewels(result?.jewels ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    // Backend fetch — an external-system call, not derivable from
    // props/state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { user, jewels, loading };
}
