import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/** Navigation from outside a screen (notification taps). Passed to `NavigationContainer`. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
