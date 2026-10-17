import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../context/session';

/** Wait for AuthSheet completion, not just the earlier authenticated-session update. */
export function useProfileTabAuth(onAuthenticated: () => void, onCancel?: () => void) {
  const session = useSession();
  const [visible, setVisible] = useState(false);
  const [pending, setPendingState] = useState<'session' | 'complete' | null>(null);
  const pendingRef = useRef<typeof pending>(null);
  const visibleRef = useRef(false);
  const completedRef = useRef(false);

  const setPending = useCallback((value: typeof pending) => {
    pendingRef.current = value;
    setPendingState(value);
  }, []);

  const showAuth = useCallback(() => {
    setPending(null);
    completedRef.current = false;
    visibleRef.current = true;
    setVisible(true);
  }, [setPending]);

  const requestProfile = useCallback(() => {
    if (!session.loaded) setPending('session');
    else if (session.authenticated) onAuthenticated();
    else if (!visibleRef.current) showAuth();
  }, [session.loaded, session.authenticated, onAuthenticated, setPending, showAuth]);

  useEffect(() => {
    if (!session.loaded || !pending || pendingRef.current !== pending) return;
    if (pending === 'session') {
      setPending(null);
      if (session.authenticated) onAuthenticated();
      else showAuth();
    } else if (session.authenticated && !session.needsProfileCompletion) {
      // Consume synchronously as well, guarding repeated effects/callbacks.
      setPending(null);
      onAuthenticated();
    }
  }, [pending, session.loaded, session.authenticated, session.needsProfileCompletion, onAuthenticated, setPending, showAuth]);

  const cancelPending = useCallback(() => {
    setPending(null);
    visibleRef.current = false;
    setVisible(false);
  }, [setPending]);

  const onComplete = useCallback(() => {
    if (!visibleRef.current || completedRef.current) return;
    completedRef.current = true;
    setPending('complete');
  }, [setPending]);

  const onClose = useCallback(() => {
    visibleRef.current = false;
    setVisible(false);
    if (!completedRef.current) {
      setPending(null);
      onCancel?.();
    }
  }, [onCancel, setPending]);

  const onTabPress = useCallback((event: { preventDefault: () => void }) => {
    if (session.loaded && session.authenticated) return; // Normal native tab selection.
    event.preventDefault();
    requestProfile();
  }, [session.loaded, session.authenticated, requestProfile]);

  return { requestProfile, onTabPress, cancelPending, authSheetProps: { visible, onComplete, onClose } };
}
