import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StripeProvider } from "@stripe/stripe-react-native";
import { CartProvider } from "../src/context/cart";
import { SessionProvider } from "../src/context/session";
import { STRIPE_PUBLISHABLE_KEY } from "../src/lib/env";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        <SessionProvider>
          <CartProvider>
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
              <Stack.Screen
                name="profile"
                options={{
                  title: "Profile",
                }}
              />
              <Stack.Screen
                name="cart"
                options={{
                  title: "Cart",
                }}
              />
              <Stack.Screen
                name="checkout"
                options={{
                  title: "Checkout",
                }}
              />
              <Stack.Screen
                name="orders/[id]"
                options={{
                  title: "Track Order",
                }}
              />
            </Stack>
            <StatusBar style="auto" />
          </CartProvider>
        </SessionProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  );
}
