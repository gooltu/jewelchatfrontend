import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Only the selected mode lives here. Actual color tokens, typography, and
 * the ThemeProvider/useTheme()/useThemeColors() hooks all come from
 * @nocturnalflow/design-system — this slice just remembers the user's
 * light/dark/system choice across app restarts.
 */
export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
}

const initialState: ThemeState = {
  mode: 'dark',
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeMode(state, action: PayloadAction<ThemeMode>) {
      state.mode = action.payload;
    },
  },
});

export const { setThemeMode } = themeSlice.actions;
export default themeSlice.reducer;
