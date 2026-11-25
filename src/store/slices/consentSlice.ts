import { createSlice } from '@reduxjs/toolkit';

/**
 * Persisted record of in-app disclosures the user has accepted. Google
 * Play's User Data policy requires a prominent disclosure, with an
 * affirmative tap, before the app collects contacts. The OS permission
 * dialog alone doesn't count. See contactSyncService.syncPhonebook.
 */
interface ConsentSliceState {
  contactsDisclosureAccepted: boolean;
}

const initialState: ConsentSliceState = { contactsDisclosureAccepted: false };

const consentSlice = createSlice({
  name: 'consent',
  initialState,
  reducers: {
    contactsDisclosureAccepted(state) {
      state.contactsDisclosureAccepted = true;
    },
  },
});

export const { contactsDisclosureAccepted } = consentSlice.actions;
export default consentSlice.reducer;
