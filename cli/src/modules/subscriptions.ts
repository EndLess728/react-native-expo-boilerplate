import { join } from 'node:path';

import * as p from '@clack/prompts';

import { MODULES_DIR } from '../template.js';
import { pick } from '../versions.js';
import { mergeTranslations, wireNavigationRef, wrapAppChildren } from './shared.js';
import { CancelledError, type ModuleContext, type ModuleGenerator } from './types.js';

const DIR = join(MODULES_DIR, 'subscriptions');
const DEFAULT_ENTITLEMENT = 'premium';
const ENV_FILES = ['.env.development', '.env.staging', '.env.production'];
const KEY_IOS = 'EXPO_PUBLIC_REVENUECAT_API_KEY_IOS';
const KEY_ANDROID = 'EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID';

const JEST_MOCKS = `
// Subscriptions (added by \`create-expo-boilerplate add subscriptions\`).
// react-native-purchases needs native modules and ships untranspiled ESM. The
// enums are mocked whole, with the SDK's real values: a partial mock leaves
// codes \`undefined\`, so distinct \`switch\` cases collapse into the first one.
jest.mock('@gorhom/bottom-sheet', () => require('@gorhom/bottom-sheet/mock'));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  LOG_LEVEL: { DEBUG: 'DEBUG', ERROR: 'ERROR' },
  PURCHASES_ERROR_CODE: {
    UNKNOWN_ERROR: '0',
    PURCHASE_CANCELLED_ERROR: '1',
    STORE_PROBLEM_ERROR: '2',
    PURCHASE_NOT_ALLOWED_ERROR: '3',
    PURCHASE_INVALID_ERROR: '4',
    PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
    PRODUCT_ALREADY_PURCHASED_ERROR: '6',
    RECEIPT_ALREADY_IN_USE_ERROR: '7',
    INVALID_RECEIPT_ERROR: '8',
    MISSING_RECEIPT_FILE_ERROR: '9',
    NETWORK_ERROR: '10',
    INVALID_CREDENTIALS_ERROR: '11',
    UNEXPECTED_BACKEND_RESPONSE_ERROR: '12',
    RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: '13',
    INVALID_APP_USER_ID_ERROR: '14',
    OPERATION_ALREADY_IN_PROGRESS_ERROR: '15',
    UNKNOWN_BACKEND_ERROR: '16',
    INVALID_APPLE_SUBSCRIPTION_KEY_ERROR: '17',
    INELIGIBLE_ERROR: '18',
    INSUFFICIENT_PERMISSIONS_ERROR: '19',
    PAYMENT_PENDING_ERROR: '20',
    INVALID_SUBSCRIBER_ATTRIBUTES_ERROR: '21',
    LOG_OUT_ANONYMOUS_USER_ERROR: '22',
    CONFIGURATION_ERROR: '23',
    UNSUPPORTED_ERROR: '24',
    EMPTY_SUBSCRIBER_ATTRIBUTES_ERROR: '25',
    PRODUCT_DISCOUNT_MISSING_IDENTIFIER_ERROR: '26',
    PRODUCT_DISCOUNT_MISSING_SUBSCRIPTION_GROUP_IDENTIFIER_ERROR: '28',
    CUSTOMER_INFO_ERROR: '29',
    SYSTEM_INFO_ERROR: '30',
    BEGIN_REFUND_REQUEST_ERROR: '31',
    PRODUCT_REQUEST_TIMED_OUT_ERROR: '32',
    API_ENDPOINT_BLOCKED: '33',
    INVALID_PROMOTIONAL_OFFER_ERROR: '34',
    OFFLINE_CONNECTION_ERROR: '35',
    TEST_STORE_SIMULATED_PURCHASE_ERROR: '42',
  },
  PACKAGE_TYPE: {
    UNKNOWN: 'UNKNOWN',
    CUSTOM: 'CUSTOM',
    LIFETIME: 'LIFETIME',
    ANNUAL: 'ANNUAL',
    SIX_MONTH: 'SIX_MONTH',
    THREE_MONTH: 'THREE_MONTH',
    TWO_MONTH: 'TWO_MONTH',
    MONTHLY: 'MONTHLY',
    WEEKLY: 'WEEKLY',
  },
  INTRO_ELIGIBILITY_STATUS: {
    INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
    INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
    INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
    INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
  },
  STORE_REPLACEMENT_MODE: {
    WITHOUT_PRORATION: 'WITHOUT_PRORATION',
    WITH_TIME_PRORATION: 'WITH_TIME_PRORATION',
    CHARGE_FULL_PRICE: 'CHARGE_FULL_PRICE',
    CHARGE_PRORATED_PRICE: 'CHARGE_PRORATED_PRICE',
    DEFERRED: 'DEFERRED',
  },
  default: {
    addCustomerInfoUpdateListener: jest.fn(),
    checkTrialOrIntroductoryPriceEligibility: jest.fn().mockResolvedValue({}),
    configure: jest.fn(),
    getAppUserID: jest.fn().mockResolvedValue('mock-app-user-id'),
    getCustomerInfo: jest.fn().mockResolvedValue(null),
    getOfferings: jest.fn().mockResolvedValue({ current: null, all: {} }),
    invalidateCustomerInfoCache: jest.fn().mockResolvedValue(undefined),
    isAnonymous: jest.fn().mockResolvedValue(true),
    logIn: jest.fn().mockResolvedValue({ customerInfo: null, created: false }),
    logOut: jest.fn().mockResolvedValue(null),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo: null }),
    removeCustomerInfoUpdateListener: jest.fn(),
    restorePurchases: jest.fn().mockResolvedValue(null),
    setDisplayName: jest.fn().mockResolvedValue(undefined),
    setEmail: jest.fn().mockResolvedValue(undefined),
    setLogLevel: jest.fn(),
    syncPurchases: jest.fn().mockResolvedValue(undefined),
  },
}));
`;

async function ask(
  ctx: ModuleContext,
  flag: unknown,
  prompt: Parameters<typeof p.text>[0],
  fallback: string,
): Promise<string> {
  if (typeof flag === 'string') return flag.trim();
  if (!ctx.interactive) return fallback;
  const answer = await p.text(prompt);
  if (p.isCancel(answer)) throw new CancelledError();
  return (answer ?? '').trim();
}

const NO_QUOTES = /^[^'"`\\\n]*$/;

export const subscriptions: ModuleGenerator = {
  name: 'subscriptions',
  dir: 'subscription',
  description: 'In-app subscriptions (RevenueCat): paywall, premium gate, every store state',
  flags: [
    {
      flags: '--entitlement <id>',
      description: `subscriptions: RevenueCat entitlement id (default ${DEFAULT_ENTITLEMENT})`,
    },
    { flags: '--revenuecat-ios-key <key>', description: 'subscriptions: public SDK key (appl_…)' },
    {
      flags: '--revenuecat-android-key <key>',
      description: 'subscriptions: public SDK key (goog_…)',
    },
  ],

  async apply(ctx, flags) {
    const { files, pkg, stack, patch } = ctx;
    const ts = stack.language === 'ts';
    const ext = (rel: string) => (ts ? rel : rel.replace(/\.ts$/, '.js').replace(/\.tsx$/, '.jsx'));

    const entitlement = await ask(
      ctx,
      flags.entitlement,
      {
        message: 'RevenueCat entitlement identifier (RevenueCat → Product catalog → Entitlements)',
        initialValue: DEFAULT_ENTITLEMENT,
        validate: (v) =>
          !v?.trim() ? 'Required.' : NO_QUOTES.test(v) ? undefined : 'No quotes or backslashes.',
      },
      DEFAULT_ENTITLEMENT,
    );
    if (!entitlement || !NO_QUOTES.test(entitlement)) {
      throw new Error('--entitlement: a non-empty id without quotes or backslashes.');
    }
    const keyPrompt = (platform: string, prefix: string) => ({
      message: `RevenueCat ${platform} public SDK key (${prefix}…) — press Enter to skip and add it later`,
      validate: (v: string | undefined) =>
        !v?.trim() || /^[A-Za-z0-9_]+$/.test(v.trim()) ? undefined : 'Letters, digits and _ only.',
    });
    const iosKey = await ask(ctx, flags.revenuecatIosKey, keyPrompt('iOS', 'appl_'), '');
    const androidKey = await ask(
      ctx,
      flags.revenuecatAndroidKey,
      keyPrompt('Android', 'goog_'),
      '',
    );

    // ── Module files ─────────────────────────────────────────
    await files.overlay(join(DIR, 'files'));
    if (stack.navigation === 'react-navigation') {
      await files.remove('src/app'); // the Expo Router route file
      await files.overlay(join(DIR, 'overlays', 'react-navigation'));
    }
    if (stack.styling !== 'unistyles') {
      await files.overlay(join(DIR, 'overlays', 'styling', stack.styling));
    }
    await files.replace('src/subscription/config.ts', '__ENTITLEMENT_ID__', entitlement);

    pkg.addDeps(pick('react-native-purchases', '@gorhom/bottom-sheet'));
    await mergeTranslations(ctx, DIR);

    // ── Env: the RevenueCat keys ─────────────────────────────
    const envFile = patch.find('env.ts', 'env.js');
    const envMsg = `add optional \`${KEY_IOS}\` / \`${KEY_ANDROID}\` to the env schema and object in env.ts.`;
    await patch.insertAfter(
      envFile,
      /^ *EXPO_PUBLIC_API_URL: z\.string\(\)[^\n]*\n/m,
      `\n  // RevenueCat public SDK keys (optional — subscriptions stay off without them)\n  ${KEY_IOS}: z.string().optional(),\n  ${KEY_ANDROID}: z.string().optional(),\n`,
      envMsg,
    );
    await patch.insertAfter(
      envFile,
      /^ *EXPO_PUBLIC_API_URL: process\.env\.EXPO_PUBLIC_API_URL[^\n]*\n/m,
      `  ${KEY_IOS}: process.env.${KEY_IOS},\n  ${KEY_ANDROID}: process.env.${KEY_ANDROID},\n`,
      envMsg,
    );
    await patch.edit(
      '.env.example',
      (src) =>
        src.includes(KEY_IOS)
          ? src
          : `${src.trimEnd()}\n\n# RevenueCat public SDK keys (Project settings → API keys). Public by design.\n${KEY_IOS}=\n${KEY_ANDROID}=\n`,
      `add \`${KEY_IOS}=\` and \`${KEY_ANDROID}=\` to .env.example.`,
    );
    for (const rel of ENV_FILES) {
      if (!files.exists(rel)) continue;
      const src = await files.read(rel);
      if (src.includes(KEY_IOS)) continue;
      await files.write(
        rel,
        `${src.trimEnd()}\n\n# RevenueCat public SDK keys\n${KEY_IOS}=${iosKey}\n${KEY_ANDROID}=${androidKey}\n`,
      );
    }

    // ── Wiring ───────────────────────────────────────────────
    await wrapAppChildren(patch, 'SubscriptionRoot', '@/subscription');

    if (stack.navigation === 'expo-router') {
      await patch.insertAfter(
        patch.find('src/app/_layout.tsx', 'src/app/_layout.jsx'),
        /^ *<Stack\.Screen name="\(tabs\)" \/>\n/m,
        '        <Stack.Screen name="subscription" />\n',
        'register `<Stack.Screen name="subscription" />` inside the signed-in `Stack.Protected` guard.',
      );
    } else {
      await wireNavigationRef(patch, 'the premium gate can open the paywall');
      const routeMsg =
        "register the paywall: `subscription: 'Subscription'` in NAVIGATION, a `[NAVIGATION.subscription]: undefined` param, `[NAVIGATION.subscription]: 'subscription'` in linking.ts, and `<Stack.Screen component={PaywallScreen} name={NAVIGATION.subscription} />` in the signed-in branch of RootNavigator.";
      await patch.insertBefore(
        patch.find('src/shared/constants/navigation.ts', 'src/shared/constants/navigation.js'),
        // `} as const;` in TypeScript, `};` once transpiled to JavaScript.
        /^}( as const)?;/m,
        "  subscription: 'Subscription',\n",
        routeMsg,
      );
      if (ts) {
        await patch.insertAfter(
          'src/navigation/types.ts',
          /^ *\[NAVIGATION\.main\]: NavigatorScreenParams<MainTabParamList>;\n/m,
          '  [NAVIGATION.subscription]: undefined;\n',
          routeMsg,
        );
      }
      await patch.insertAfter(
        patch.find('src/navigation/linking.ts', 'src/navigation/linking.js'),
        /^ {4}screens: \{\n/m,
        "      [NAVIGATION.subscription]: 'subscription',\n",
        routeMsg,
      );
      const rootNavigator = patch.find(
        'src/navigation/RootNavigator.tsx',
        'src/navigation/RootNavigator.jsx',
      );
      const mainScreen = '<Stack.Screen component={MainTabNavigator} name={NAVIGATION.main} />';
      if (
        await patch.edit(
          rootNavigator,
          (src) =>
            src.includes('NAVIGATION.subscription')
              ? src
              : src.includes(mainScreen)
                ? src.replace(
                    mainScreen,
                    `<>\n${mainScreen}\n<Stack.Screen component={PaywallScreen} name={NAVIGATION.subscription} />\n</>`,
                  )
                : null,
          routeMsg,
        )
      ) {
        await patch.insertAfter(
          rootNavigator,
          /^import \{ NAVIGATION \} from '@\/shared\/constants';\n/m,
          "import { PaywallScreen } from '@/subscription';\n",
          routeMsg,
        );
      }
    }

    // ── Tests ────────────────────────────────────────────────
    await patch.edit(
      patch.find('jest.setup.ts', 'jest.setup.js'),
      (src) =>
        src.includes("jest.mock('react-native-purchases'")
          ? src
          : `${src.trimEnd()}\n${JEST_MOCKS}`,
      'add the react-native-purchases and @gorhom/bottom-sheet mocks to jest.setup.',
    );

    // The tests format real copy through i18n, which loads expo-localization
    // and, through it, other expo-* packages — all untranspiled ESM. Projects
    // created before the template covered expo-* need it added.
    await patch.edit(
      'jest.config.js',
      (src) =>
        // Templates from this version on already include it.
        src.includes('expo-[a-z-]+')
          ? src
          : src.includes("'node_modules/(?!(' +\n")
            ? src.replace(
                "'node_modules/(?!(' +\n",
                "'node_modules/(?!(' +\n      'expo-[a-z-]+|' +\n",
              )
            : null,
      'add `expo-[a-z-]+` to `transformIgnorePatterns`, so expo-* packages are transpiled.',
    );

    // ── What's left ──────────────────────────────────────────
    const steps: string[] = [];
    if (!iosKey || !androidKey) {
      steps.push(
        `Add your RevenueCat public SDK keys to .env.development / .staging / .production (${KEY_IOS}, ${KEY_ANDROID}). Until then subscriptions are switched off and the paywall says plans couldn't load.`,
      );
    }
    steps.push(
      `Map your user to a RevenueCat id in ${ext('src/subscription/useSubscriptionUser.ts')} — until then purchases are attributed to an anonymous id per install.`,
      `Set TERMS_OF_USE_URL and PRIVACY_POLICY_URL in ${ext('src/subscription/config.ts')} — both stores reject a paywall without them.`,
      `In RevenueCat: create the "${entitlement}" entitlement, attach your products, and mark an offering as current.`,
      'Gate a feature: const { requirePremium } = useSubscription(); requirePremium(() => doIt()).',
      'Rebuild the dev client — react-native-purchases is a native module: npx expo prebuild --clean, then run ios:development / android:development.',
      'Test purchases with sandbox/test accounts (StoreKit sandbox on iOS, a license tester on Play); the simulator can show offerings but not complete a real purchase.',
    );
    return steps;
  },
};
