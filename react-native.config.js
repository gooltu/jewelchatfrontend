// JC_NO_FIREBASE=1 keeps the Firebase native modules out of autolinking (see
// app.config.ts). Without this, app-check's Android module calls
// FirebaseAppCheck.getInstance() at registration time and crashes on startup
// when no Firebase config was built in. Unset, autolinking is unchanged.
const noFirebase = process.env.JC_NO_FIREBASE === '1';

module.exports = {
  dependencies: noFirebase
    ? {
        '@react-native-firebase/app': { platforms: { ios: null, android: null } },
        '@react-native-firebase/app-check': { platforms: { ios: null, android: null } },
      }
    : {},
};
