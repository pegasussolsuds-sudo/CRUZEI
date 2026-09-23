import { useEffect, useState } from 'react';

export function useNetworkStatus() {
  // placeholder — em prod usar @react-native-community/netinfo
  const [isOnline] = useState(true);
  useEffect(() => {}, []);
  return { isOnline };
}
