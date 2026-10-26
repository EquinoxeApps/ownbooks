import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Speaks a message that just appeared (an error, a status change). TalkBack already reads
 * live regions; VoiceOver has no live regions, so on iOS the message is announced instead.
 */
export function useAnnounce(message: string | null | undefined): void {
  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}

/** Whether VoiceOver / TalkBack is on, kept up to date. */
export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (active) setEnabled(on);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return enabled;
}
