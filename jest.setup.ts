// @cli:unistyles-start — the create CLI removes this block for other styling options
// Unistyles' official mock stubs its native (Nitro) module and the StyleSheet /
// useUnistyles surface, so components that import the style layer can render
// in tests. It starts with no themes; importing the app's own config registers
// the real light/dark themes, so `theme.colors.x` in a style factory resolves.
import 'react-native-unistyles/mocks';
import '@/styles/unistyles';

// @cli:unistyles-end
// Mock react-native-mmkv so tests don't require native modules. The hooks are
// stateless stand-ins (value + setter), so components that read a stored
// setting — e.g. `useSelectedLanguage` — can render.
jest.mock('react-native-mmkv', () => {
  const hook = () => [undefined, jest.fn()];
  return {
    createMMKV: jest.fn(() => ({
      getString: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      delete: jest.fn(),
      clearAll: jest.fn(),
    })),
    useMMKVString: jest.fn(hook),
    useMMKVNumber: jest.fn(hook),
    useMMKVBoolean: jest.fn(hook),
    useMMKVObject: jest.fn(hook),
  };
});

// The library's official mock: real insets for `useSafeAreaInsets()` and
// providers that render their children, so screens render without a native
// `SafeAreaProvider` measuring the window.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('mock-encryption-key'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock storage initStorage so stores work in tests
jest.mock('@/storage', () => {
  const mockStorage = {
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    clearAll: jest.fn(),
  };
  return {
    storage: mockStorage,
    initStorage: jest.fn().mockResolvedValue(undefined),
    getItem: jest.fn().mockReturnValue(null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  };
});

// Silence noisy console.log in test output
jest.spyOn(console, 'log').mockImplementation(() => {});
