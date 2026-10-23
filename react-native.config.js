module.exports = {
  dependencies: {
    // @react-native-firebase/app-check's native module eagerly calls
    // FirebaseAppCheck.getInstance() in its own constructor at React Native
    // module-registration time (createNativeModules -> NativeRNFBTurboAppCheck.<init>)
    // — independent of any JS code calling into it. With no Firebase project
    // registered yet (no google-services.json/GoogleService-Info.plist), that
    // throws and crashes app startup before any JS runs, so disabling the JS call
    // in App.tsx/appCheckService.ts alone can't prevent it — the native module
    // itself must not be autolinked. Package stays in package.json (so JS/TS still
    // resolves it) — this only excludes it from the native build. Re-enable by
    // deleting this file (or just this entry) once the Firebase apps are
    // registered and a real google-services.json/GoogleService-Info.plist are in
    // place, then do a clean rebuild (`expo prebuild --clean`).
    '@react-native-firebase/app-check': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
