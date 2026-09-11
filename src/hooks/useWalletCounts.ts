import { useAppSelector } from '@store/hooks';

export interface WalletCounts {
  diamonds: number;
  coins: number;
}

/** Profile tab's diamond/coin counts: game.jewels[0].count (diamonds), game.jewels[1].count (coins). */
export function useWalletCounts(): WalletCounts {
  const jewels = useAppSelector((state) => state.game.jewels);
  return {
    diamonds: jewels?.find((j) => j.jeweltype_id === 0)?.count ?? 0,
    coins: jewels?.find((j) => j.jeweltype_id === 1)?.count ?? 0,
  };
}
