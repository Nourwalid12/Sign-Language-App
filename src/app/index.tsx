import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

const colors = {
  ivory: '#F7F4EC',
  white: '#FFFFFF',
  line: '#E3DDCF',
  text: '#14231F',
  muted: '#5A6A64',
  emerald: '#0F766E',
  emeraldCard: '#10846E',
  emeraldDark: '#0B4F49',
  pale: '#DCEFEA',
};

type IconProps = { size?: number; color: string };

function BridgeIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 18h18M5 18v-4a7 7 0 0 1 14 0v4M12 7v11" />
    </Svg>
  );
}

function ViewfinderIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <Circle cx={12} cy={12} r={3} />
    </Svg>
  );
}

function MicIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <BridgeIcon color={colors.white} />
        </View>
        <Text style={styles.brandName}>SignBridge</Text>
        <View style={styles.brandSpacer} />
        <Text style={styles.brandHeart}>♥</Text>
      </View>

      <Text style={styles.greeting}>Hello!</Text>
      <Text style={styles.subtitle}>How would you like to communicate today?</Text>

      <View style={styles.cards}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.card,
            styles.cardPrimary,
            pressed && styles.cardPressed,
          ]}
          onPress={() => router.push('/sign-to-speech')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.emeraldDark }]}>
            <ViewfinderIcon size={28} color={colors.white} />
          </View>
          <View>
            <Text style={[styles.cardTitle, { color: colors.white }]}>Sign to Speech</Text>
            <Text style={[styles.cardDescription, { color: colors.white }]}>
              Show your sign, get spoken output
            </Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.card,
            styles.cardSecondary,
            pressed && styles.cardPressed,
          ]}
          onPress={() => router.push('/speech-to-text')}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.pale }]}>
            <MicIcon size={28} color={colors.emerald} />
          </View>
          <View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Speech to Text</Text>
            <Text style={[styles.cardDescription, { color: colors.muted }]}>
              Speak, get text output
            </Text>
          </View>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.conversationCard, pressed && styles.cardPressed]}
        onPress={() => router.push('/two-way-conversation')}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.pale }]}>
          <BridgeIcon size={26} color={colors.emerald} />
        </View>
        <View style={styles.conversationCopy}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Two-Way Conversation</Text>
          <Text style={[styles.cardDescription, { color: colors.muted }]}>Sign and speak together, with both shown as text</Text>
        </View>
        <Text style={styles.conversationArrow}>›</Text>
      </Pressable>
      <Text style={styles.footer}>A bridge for every conversation</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { backgroundColor: colors.ivory },
  container: {
    flexGrow: 1,
    backgroundColor: colors.ivory,
    paddingHorizontal: 24,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emerald,
    marginRight: 12,
  },
  brandName: { color: colors.text, fontSize: 22, fontWeight: '800' },
  brandSpacer: { flex: 1 },
  brandHeart: { color: colors.emerald, fontSize: 22 },
  greeting: {
    color: colors.text,
    fontSize: 60,
    fontWeight: '800',
    letterSpacing: -2,
    marginTop: 56,
    marginBottom: 12,
  },
  subtitle: { color: colors.muted, fontSize: 20, lineHeight: 28, maxWidth: 260 },
  cards: { flexDirection: 'row', gap: 14, marginTop: 40 },
  card: {
    flex: 1,
    height: 290,
    borderRadius: 32,
    padding: 22,
    justifyContent: 'space-between',
  },
  cardPrimary: { backgroundColor: colors.emeraldCard },
  cardSecondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 22, fontWeight: '800', lineHeight: 25 },
  cardDescription: { fontSize: 14, lineHeight: 19, marginTop: 8 },
  conversationCard: {
    minHeight: 106,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 24,
    padding: 18,
    marginTop: 18,
  },
  conversationCopy: { flex: 1 },
  conversationArrow: { color: colors.emeraldDark, fontSize: 30, fontWeight: '500' },  footer: {
    marginTop: 'auto',
    paddingTop: 32,
    textAlign: 'center',
    color: colors.emerald,
    fontSize: 14,
    fontWeight: '600',
  },
});
