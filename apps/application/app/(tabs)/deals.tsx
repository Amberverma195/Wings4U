import { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AuthSheet } from '../../src/components/auth-sheet';
import { SectionSwitch } from '../../src/components/section-switch';
import { TabHeader } from '../../src/components/tab-header';
import { usePromo } from '../../src/context/promo';
import { useSession } from '../../src/context/session';
import { useAccountData, type WingsStampEntry } from '../../src/hooks/use-account-data';
import {
  accountTabGate,
  formatBxgyDetails,
  promoBenefitLabel,
  promoFulfillmentLabel,
  rewardProgress,
  sectionContentState,
} from '../../src/lib/deals-display';
import type { ActivePromo } from '../../src/lib/types';

type DealSection = 'rewards' | 'coupons';

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function GuestDeals() {
  const [authVisible, setAuthVisible] = useState(false);
  return (
    <View style={styles.guest}>
      <Text style={styles.guestTitle}>Sign in to see your deals</Text>
      <Text style={styles.guestBody}>Wing stamps and coupons are saved to your account.</Text>
      <TouchableOpacity style={styles.signIn} onPress={() => setAuthVisible(true)} accessibilityRole="button">
        <Text style={styles.signInText}>Sign in</Text>
      </TouchableOpacity>
      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </View>
  );
}

function RewardHistory({ entries }: { entries: WingsStampEntry[] }) {
  if (entries.length === 0) {
    return (
      <Text style={styles.empty}>
        No stamps yet. Order a pound of wings and the first stamp is added when the order is complete.
      </Text>
    );
  }
  return (
    <View>
      {entries.map(entry => {
        const gifted = entry.entry_type === 'ADMIN_GRANTED';
        const earned = entry.entry_type === 'EARNED' || gifted;
        const when = formatWhen(entry.created_at);
        return (
          <View key={entry.id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>
                {gifted ? 'Gifted by Wings 4 U' : earned
                  ? `Earned ${Math.abs(entry.delta_stamps)} stamp${Math.abs(entry.delta_stamps) === 1 ? '' : 's'}`
                  : 'Redeemed 1lb of wings free'}
              </Text>
              <Text style={styles.rowMeta}>
                {[when, entry.order_number ? `Order #${entry.order_number}` : null].filter(Boolean).join(' · ')}
              </Text>
              {entry.reason_text ? <Text style={styles.rowMeta}>{entry.reason_text}</Text> : null}
            </View>
            <Text style={[styles.delta, earned ? styles.deltaEarn : styles.deltaRedeem]}>
              {earned ? '+' : ''}{entry.delta_stamps}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function RewardsSection() {
  const account = useAccountData();
  const promo = usePromo();
  const router = useRouter();
  const progress = rewardProgress(account.data.wingsRewards);
  const state = sectionContentState(account.sectionErrors.rewards, progress ? 1 : 0);

  if (state === 'error') {
    return <Text style={styles.error}>{account.sectionErrors.rewards}</Text>;
  }
  if (!progress) {
    return <Text style={styles.empty}>Rewards are not available for this account yet.</Text>;
  }

  return (
    <View>
      <Text style={styles.lead}>
        Earn 1 stamp for every pound of wings you order. Collect {progress.stampsPerReward} stamps to unlock 1lb of wings free.
      </Text>
      <Text style={styles.balance} accessibilityLabel={`${progress.availableStamps} of ${progress.stampsPerReward} stamps`}>
        {progress.availableStamps}/{progress.stampsPerReward}
      </Text>
      <Text style={styles.eligibility}>
        {progress.eligible
          ? 'Free 1lb wings reward is ready. Apply it to your cart.'
          : `${progress.stampsToNext} more stamp${progress.stampsToNext === 1 ? '' : 's'} to unlock 1lb of wings free.`}
      </Text>
      {progress.eligible ? (
        <TouchableOpacity
          style={[styles.applyButton, promo.applyWingsReward && styles.applyButtonDone]}
          onPress={() => {
            promo.redeemWingsReward();
            router.push('/cart');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.applyButtonText}>
            {promo.applyWingsReward ? 'Reward applied · View cart' : 'Apply free wings reward'}
          </Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.dots}>
        {Array.from({ length: progress.stampsPerReward }).map((_, index) => {
          const filled = index < progress.availableStamps;
          return (
            <View key={index} style={[styles.dot, filled && styles.dotFilled]}>
              <Text style={[styles.dotText, filled && styles.dotTextFilled]}>{index + 1}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.stats}>
        <Text style={styles.stat}>{progress.lifetimeStamps} lifetime stamps</Text>
        <Text style={styles.stat}>{progress.lifetimeRedemptions} free pounds redeemed</Text>
      </View>
      <Text style={styles.sectionLabel}>Reward history</Text>
      <RewardHistory entries={account.data.wingsLedger} />
    </View>
  );
}

function CouponCard({ promo }: { promo: ActivePromo }) {
  const promoSelection = usePromo();
  const router = useRouter();
  const bxgy = promo.discountType === 'BXGY' ? formatBxgyDetails(promo) : null;
  const fulfillment = promoFulfillmentLabel(promo.eligibleFulfillmentType);
  const starts = formatWhen(promo.startsAt);
  const ends = formatWhen(promo.endsAt);
  const applied = promoSelection.promoCode === promo.code;
  return (
    <View style={styles.coupon}>
      <Text style={styles.code}>{promo.code}</Text>
      <Text style={styles.rowTitle}>{promo.name}</Text>
      <Text style={styles.benefit}>{promoBenefitLabel(promo)}</Text>
      {promo.minSubtotalCents > 0 ? (
        <Text style={styles.rowMeta}>Min order ${(promo.minSubtotalCents / 100).toFixed(2)}</Text>
      ) : null}
      {starts ? <Text style={styles.rowMeta}>Starts {starts}</Text> : null}
      {ends ? <Text style={styles.rowMeta}>Ends {ends}</Text> : null}
      {promo.isOneTimePerCustomer ? <Text style={styles.rowMeta}>One time per customer</Text> : null}
      {fulfillment ? <Text style={styles.rowMeta}>{fulfillment}</Text> : null}
      {bxgy ? <Text style={styles.rowMeta}>{bxgy}</Text> : null}
      {promo.autoApply ? (
        <Text style={styles.rowMeta}>Applies automatically at checkout</Text>
      ) : (
        <TouchableOpacity
          style={[styles.applyButton, applied && styles.applyButtonDone]}
          onPress={() => {
            promoSelection.applyPromoCode(promo.code);
            router.push('/cart');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.applyButtonText}>
            {applied ? 'Applied · View cart' : 'Apply to cart'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function CouponsSection() {
  const account = useAccountData();
  const promos = account.data.promos;
  const state = sectionContentState(account.sectionErrors.promos, promos.length);

  if (state === 'error') {
    return <Text style={styles.error}>{account.sectionErrors.promos}</Text>;
  }
  if (state === 'empty') {
    return <Text style={styles.empty}>No coupons yet. Check back later for special offers and discounts.</Text>;
  }
  return (
    <View>
      {promos.map(promo => <CouponCard key={promo.id} promo={promo} />)}
    </View>
  );
}

export default function DealsTab() {
  const session = useSession();
  const account = useAccountData();
  const [section, setSection] = useState<DealSection>('rewards');
  const gate = accountTabGate({
    sessionLoaded: session.loaded,
    authenticated: session.authenticated,
    loading: account.loading,
  });

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <TabHeader title="Deals" />
      {gate === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#FF4D4D" />
        </View>
      ) : gate === 'guest' ? (
        <GuestDeals />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={account.refreshing}
              onRefresh={() => { void account.refresh('refresh'); }}
              tintColor="#FF4D4D"
            />
          }
        >
          <SectionSwitch
            label="Deals"
            options={[{ key: 'rewards', label: 'Rewards' }, { key: 'coupons', label: 'Coupons' }]}
            value={section}
            onChange={setSection}
          />
          {section === 'rewards' ? <RewardsSection /> : <CouponsSection />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guest: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  guestTitle: { color: '#1A1A1A', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  guestBody: { color: '#777777', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  signIn: { marginTop: 20, backgroundColor: '#FF4D4D', borderRadius: 22, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center' },
  signInText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  lead: { color: '#555555', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  balance: { color: '#1A1A1A', fontSize: 36, fontWeight: '800' },
  eligibility: { color: '#1A1A1A', fontSize: 15, fontWeight: '700', marginTop: 6, marginBottom: 16 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dot: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEEEEE', alignItems: 'center', justifyContent: 'center' },
  dotFilled: { backgroundColor: '#FF4D4D' },
  dotText: { color: '#888888', fontSize: 12, fontWeight: '800' },
  dotTextFilled: { color: '#FFFFFF' },
  stats: { marginTop: 16, gap: 4 },
  stat: { color: '#777777', fontSize: 13, fontWeight: '600' },
  sectionLabel: { marginTop: 24, marginBottom: 8, color: '#1A1A1A', fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F1F1F1' },
  rowMain: { flex: 1 },
  rowTitle: { color: '#1A1A1A', fontSize: 14, fontWeight: '800' },
  rowMeta: { color: '#777777', fontSize: 12, fontWeight: '600', marginTop: 4 },
  delta: { fontSize: 16, fontWeight: '800' },
  deltaEarn: { color: '#15803D' },
  deltaRedeem: { color: '#FF4D4D' },
  coupon: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F1F1F1' },
  code: { color: '#FF4D4D', fontSize: 16, fontWeight: '800' },
  benefit: { color: '#1A1A1A', fontSize: 14, fontWeight: '700', marginTop: 6 },
  applyButton: { marginTop: 12, backgroundColor: '#FF4D4D', borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  applyButtonDone: { backgroundColor: '#16A34A' },
  applyButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  empty: { color: '#777777', fontSize: 14, lineHeight: 20, paddingVertical: 24, textAlign: 'center' },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, paddingVertical: 24, textAlign: 'center' },
});
