// iOS 27 traps at launch (EXC_BREAKPOINT in
// UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption) for any app
// built with its SDK that hasn't adopted the UIScene lifecycle. Expo SDK 57's
// AppDelegate template still creates its UIWindow in
// application(_:didFinishLaunchingWithOptions:), so this plugin:
//   1. declares a single-scene UIApplicationSceneManifest in Info.plist, and
//   2. moves window creation into a SceneDelegate (appended to AppDelegate.swift,
//      so no Xcode project edits are needed). AppDelegate still builds the React
//      Native factory; the scene starts React Native in a scene-backed window.
// Drop this once the Expo template adopts scenes itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const WINDOW_START = /window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)/;

const SCENE_DELEGATE = `
// Added by plugins/withIosSceneLifecycle.js — see that file.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: appDelegate.sceneLaunchOptions)
    if let url = connectionOptions.urlContexts.first?.url {
      _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withIosSceneLifecycle: expected a Swift AppDelegate');
    }
    if (src.includes('class SceneDelegate')) return cfg;
    if (!WINDOW_START.test(src)) {
      throw new Error('withIosSceneLifecycle: AppDelegate window setup not found; update the plugin for the new template');
    }
    src = src.replace(WINDOW_START, '// The window is created by SceneDelegate (withIosSceneLifecycle).\n    sceneLaunchOptions = launchOptions');
    src = src.replace(
      'var reactNativeFactory: RCTReactNativeFactory?',
      'var reactNativeFactory: RCTReactNativeFactory?\n  var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?',
    );
    cfg.modResults.contents = src + SCENE_DELEGATE;
    return cfg;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

module.exports = (config) => withSceneManifest(withSceneAppDelegate(config));
