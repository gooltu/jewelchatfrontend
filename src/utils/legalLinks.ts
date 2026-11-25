import { Linking } from 'react-native';
import { env } from '@config/env';

/**
 * The public pages Google Play requires (privacy policy, terms, web account
 * deletion). They're served by ServerProjextX and open in the system browser.
 * Account deletion is request-based: the page records the request and an
 * admin processes it (ServerProjextX scripts/process-deletion.js).
 */
export type LegalLink = 'privacy' | 'terms' | 'deleteAccount';

const URLS: Record<LegalLink, string> = {
  privacy: env.privacyPolicyUrl,
  terms: env.termsUrl,
  deleteAccount: env.accountDeletionUrl,
};

export function openLegalLink(link: LegalLink): void {
  void Linking.openURL(URLS[link]).catch((error) => {
    if (__DEV__) console.log(`[legalLinks] could not open ${link}:`, error);
  });
}
