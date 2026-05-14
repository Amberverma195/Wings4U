import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SessionProvider } from "../src/context/session";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: "#ffffff",
            },
            headerTintColor: "#000000",
            headerTitleStyle: {
              fontWeight: "bold",
            },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen
            name="index"
            options={{
              title: "Wings4U",
              headerShown: false,
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
