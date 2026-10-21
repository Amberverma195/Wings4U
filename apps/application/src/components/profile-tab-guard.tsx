import { useCallback, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useSession } from '../context/session';
import { useProfileTabAuth } from '../hooks/use-profile-tab-auth';
import { AuthSheet } from './auth-sheet';
import { ProfileSkeleton } from './skeletons/screen-skeletons';

const alreadyOnProfile = () => {};

/** Covers direct /profile links and returning to Profile after the session expires. */
export function ProfileTabGuard({ children }: { children: ReactNode }) {
  const session = useSession();
  const focused = useIsFocused();
  const router = useRouter();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const leaveProfile = useCallback(() => {
    if (router.canGoBack()) router.back();
    else navigation.reset({ index: 0, routes: [{ name: 'index' }] });
  }, [router, navigation]);
  const { requestProfile, cancelPending, authSheetProps } = useProfileTabAuth(alreadyOnProfile, leaveProfile);

  useEffect(() => {
    if (!focused) cancelPending();
    else if (!session.authenticated) requestProfile();
  }, [focused, session.authenticated, requestProfile, cancelPending]);

  return <>
    {session.loaded && session.authenticated ? children : !session.loaded ? <ProfileSkeleton active={focused} /> :
      <View style={styles.loading}><ActivityIndicator size="large" color="#FF4D4D" accessibilityLabel="Loading profile" /></View>}
    <AuthSheet {...authSheetProps} visible={focused && authSheetProps.visible} />
  </>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' },
});
