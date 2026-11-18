
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="sign-to-speech"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="speech-to-text"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="two-way-conversation"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
