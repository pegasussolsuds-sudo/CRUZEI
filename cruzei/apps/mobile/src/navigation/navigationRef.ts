import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

/**
 * Ref única do NavigationContainer: deixa navegar de fora das telas (modal de match, socket, helpers como openChat)
 * sem repetir o cast `as never`. O RootNavigator liga a ref no container.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
