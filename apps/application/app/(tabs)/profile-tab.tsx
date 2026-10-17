import { Redirect } from 'expo-router';

// Tab presses use the shared sign-in gate before opening the account screen.
export default function ProfileTab() {
  return <Redirect href="/profile" />;
}
