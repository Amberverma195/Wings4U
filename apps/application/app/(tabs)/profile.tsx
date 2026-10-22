import { OrderReorderAction } from '../../src/components/order-history';
import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import {
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Home,
  LifeBuoy,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Ticket,
  Trash2,
  User,
  X,
} from 'lucide-react-native';
import { useAuth } from '../../src/hooks/use-auth';
import {
  type AddressInput,
  type CustomerAddress,
  type SupportTicketSummary,
  type TicketInput,
  type WingsStampEntry,
  useAccountData,
} from '../../src/hooks/use-account-data';
import { useSession } from '../../src/context/session';
import {
  ACTIVE_STATUSES,
  SUPPORT_TICKET_TYPES,
  type ActivePromo,
  type OrderSummary,
  type SupportTicketType,
} from '../../src/lib/types';
import { formatPhoneForDisplay } from '../../src/lib/phone';
import { ProfileSkeleton, ProfileSectionSkeleton, OrdersPaginationSkeleton } from '../../src/components/skeletons/screen-skeletons';
import { ProfileTabGuard } from '../../src/components/profile-tab-guard';
import { AccountDeletionModal } from '../../src/components/account-deletion';
import { forgetDeletedAccount } from '../../src/lib/account-deletion';

type TabKey = 'overview' | 'profile' | 'orders' | 'addresses' | 'support' | 'cards';
type OrderFilter = 'active' | 'past';

type AddressForm = AddressInput & { id?: string };

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Profile' },
  { key: 'orders', label: 'Orders' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'support', label: 'Support' },
  // { key: 'cards', label: 'Cards' },
];

const EMPTY_ADDRESS_FORM: AddressForm = {
  line1: '',
  city: 'London',
  postal_code: '',
  label: '',
  is_default: false,
};

const EMPTY_TICKET_FORM: TicketInput = {
  ticket_type: 'OTHER',
  subject: '',
  description: '',
  priority: 'NORMAL',
};

function isPhoneDisplayName(value: string | undefined): boolean {
  if (!value) return false;
  return /^\+[1-9]\d{1,14}$/.test(value.trim());
}

function cents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return shortDate(iso);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PLACED: 'Placed',
    ACCEPTED: 'Accepted',
    PREPARING: 'Preparing',
    READY: 'Ready',
    OUT_FOR_DELIVERY: 'Out for delivery',
    PICKED_UP: 'Picked up',
    DELIVERED: 'Delivered',
    NO_SHOW_PICKUP: 'No-show pickup',
    NO_SHOW_DELIVERY: 'No-show delivery',
    NO_PIN_DELIVERY: 'Delivered without PIN',
    CANCELLED: 'Cancelled',
    OPEN: 'Open',
    IN_REVIEW: 'In review',
    WAITING_ON_CUSTOMER: 'Waiting on you',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
  };
  return labels[status] ?? titleCase(status);
}

function promoBenefit(promo: ActivePromo): string {
  if (promo.benefitSummary) return promo.benefitSummary;
  if (promo.discountType === 'PERCENT') return `${promo.discountValue}% OFF`;
  if (promo.discountType === 'FIXED_AMOUNT') return `$${(promo.discountValue / 100).toFixed(2)} OFF`;
  if (promo.discountType === 'FREE_DELIVERY') return 'FREE DELIVERY';
  if (promo.discountType === 'BXGY') return 'BOGO';
  return titleCase(promo.discountType);
}

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function promoFulfillment(promo: ActivePromo): string | null {
  if (promo.eligibleFulfillmentType === 'PICKUP') return 'Pickup only';
  if (promo.eligibleFulfillmentType === 'DELIVERY') return 'Delivery only';
  return null;
}

function isProfileTab(value: string | undefined): value is TabKey {
  return value === 'overview' || value === 'profile' || value === 'orders' || value === 'addresses' || value === 'support';
}

function formatTicketType(type: string): string {
  return titleCase(type);
}

export default function ProfileTabRoute() {
  const session = useSession();
  return <ProfileTabGuard><ProfileScreen key={session.user?.id ?? 'guest'} /></ProfileTabGuard>;
}

function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ section?: string | string[]; entry?: string | string[] }>();
  const requestedTab = Array.isArray(params.section) ? params.section[0] : params.section;
  const sectionEntry = Array.isArray(params.entry) ? params.entry[0] : params.entry;
  const appliedTabParam = useRef<string | undefined>(undefined);
  const session = useSession();
  const account = useAccountData();
  const { updateProfile, requestPhoneChange, verifyPhoneChange, logout, loading: authLoading, error: authError, clearError } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>(isProfileTab(requestedTab) ? requestedTab : 'overview');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('active');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [phoneCodeTarget, setPhoneCodeTarget] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<AddressForm>(EMPTY_ADDRESS_FORM);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [ticketForm, setTicketForm] = useState<TicketInput>(EMPTY_TICKET_FORM);
  const [ticketFormOpen, setTicketFormOpen] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const user = session.user;
  const displayName = user?.displayName ?? '';
  const shownName = isPhoneDisplayName(displayName) ? 'Profile not completed' : displayName || 'Customer';
  const phoneLabel = user?.phone ? formatPhoneForDisplay(user.phone) : 'Not available';
  const profileDisplayError = profileError || authError;

  const activeOrders = useMemo(
    () => account.data.orders.filter((order) => ACTIVE_STATUSES.has(order.status)),
    [account.data.orders],
  );
  const pastOrders = useMemo(
    () => account.data.orders.filter((order) => !ACTIVE_STATUSES.has(order.status)),
    [account.data.orders],
  );
  const visibleOrders = orderFilter === 'active' ? activeOrders : pastOrders;
  const stampsPerReward = account.data.wingsRewards?.stamps_per_reward ?? 8;
  const availableStamps = Math.min(account.data.wingsRewards?.available_stamps ?? 0, stampsPerReward);
  const stampsToNext = Math.max(0, stampsPerReward - availableStamps);
  const rewardReady = availableStamps >= stampsPerReward;
  const lifetimeStamps = account.data.wingsRewards?.lifetime_stamps ?? 0;
  const lifetimeRedemptions = account.data.wingsRewards?.lifetime_redemptions ?? 0;

  useEffect(() => {
    if (!isProfileTab(requestedTab)) return;
    const key = `${requestedTab}:${sectionEntry ?? ''}`;
    if (appliedTabParam.current === key) return;
    appliedTabParam.current = key;
    setActiveTab(requestedTab);
  }, [requestedTab, sectionEntry]);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? '');
  }, [user]);

  useEffect(() => {
    if (session.needsProfileCompletion) {
      setActiveTab('profile');
    }
  }, [session.needsProfileCompletion]);

  const savedName = isPhoneDisplayName(user?.displayName) ? '' : (user?.displayName ?? '');
  const savedPhone = user?.phone ? formatPhoneForDisplay(user.phone) : '';

  async function handleSaveProfile(nextName: string, nextPhone: string) {
    clearError();
    setProfileError(null);
    setProfileSaved(false);

    const trimmedName = nextName.trim();
    const nameChanged = trimmedName !== savedName.trim();
    const phoneChanged = phoneDigits(nextPhone) !== phoneDigits(savedPhone);
    if (!nameChanged && !phoneChanged) return;

    if (nameChanged && trimmedName.length < 4) {
      setProfileError('Name must be at least 4 characters');
      return;
    }
    if (phoneChanged && phoneDigits(nextPhone).length !== 10) {
      setProfileError('Please enter a valid 10 digit phone number');
      return;
    }

    try {
      if (nameChanged) {
        await updateProfile(trimmedName);
      }
      if (phoneChanged) {
        const result = await requestPhoneChange(nextPhone);
        setPhoneCodeTarget(result.deliveryTarget);
        return;
      }
      await account.refresh('refresh');
      setProfileSaved(true);
    } catch {
      // useAuth owns the network error message
    }
  }

  async function handleVerifyPhone(code: string) {
    clearError();
    setProfileError(null);
    try {
      await verifyPhoneChange(code);
      await account.refresh('refresh');
      setPhoneCodeTarget(null);
      setProfileSaved(true);
    } catch {
      // useAuth owns the network error message
    }
  }

  function cancelProfileEdit() {
    clearError();
    setProfileError(null);
    setProfileSaved(false);
    setPhoneCodeTarget(null);
  }

  async function handleLogout() {
    await logout();
    // Clear visited-tab history so Android Back cannot reopen the signed-out account.
    navigation.reset({ index: 0, routes: [{ name: 'index' }] });
  }

  function startNewAddress() {
    setAddressForm(EMPTY_ADDRESS_FORM);
    setAddressError(null);
    setAddressFormOpen(true);
  }

  function startEditAddress(address: CustomerAddress) {
    setAddressForm({
      id: address.id,
      label: address.label ?? '',
      line1: address.line1,
      city: address.city,
      postal_code: address.postal_code,
      is_default: address.is_default,
    });
    setAddressError(null);
    setAddressFormOpen(true);
  }

  async function handleSaveAddress() {
    setAddressError(null);
    if (!addressForm.line1.trim() || !addressForm.city.trim() || !addressForm.postal_code.trim()) {
      setAddressError('Street, city, and postal code are required');
      return;
    }

    setAddressBusy(true);
    try {
      await account.saveAddress(addressForm, addressForm.id);
      setAddressForm(EMPTY_ADDRESS_FORM);
      setAddressFormOpen(false);
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : 'Unable to save address');
    } finally {
      setAddressBusy(false);
    }
  }

  function handleDeleteAddress(address: CustomerAddress) {
    Alert.alert('Remove address', `Remove ${address.line1}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void account.deleteAddress(address.id).catch((error) => {
            setAddressError(error instanceof Error ? error.message : 'Unable to remove address');
          });
        },
      },
    ]);
  }

  async function handleCreateTicket() {
    setTicketError(null);
    if (ticketForm.subject.trim().length < 4) {
      setTicketError('Subject must be at least 4 characters');
      return;
    }
    if (ticketForm.description.trim().length < 10) {
      setTicketError('Description must be at least 10 characters');
      return;
    }

    setTicketBusy(true);
    try {
      await account.createTicket({
        ...ticketForm,
        order_id: ticketForm.order_id?.trim() || undefined,
      });
      setTicketForm(EMPTY_TICKET_FORM);
      setTicketFormOpen(false);
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : 'Unable to create ticket');
      const existing = (error as { body?: { errors?: Array<{ code?: string; detail?: { ticket_id?: string } }> } }).body?.errors?.[0];
      if (existing?.code === 'SUPPORT_TICKET_EXISTS' && existing.detail?.ticket_id) {
        const ticketId = existing.detail.ticket_id;
        Alert.alert('Existing support ticket', 'Continue in your existing ticket. You can reopen it if it has been resolved or closed.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'View ticket', onPress: () => router.push(`/support/${ticketId}`) },
        ]);
      }
    } finally {
      setTicketBusy(false);
    }
  }

  if (!session.loaded || !user) {
    return <SafeAreaView edges={["left", "right"]} style={styles.container}><ProfileSkeleton active={focused} /></SafeAreaView>;
  }
  const showSectionSkeleton = account.loading && !account.hasLoaded && activeTab !== 'profile' &&
    !(activeTab === 'addresses' && addressFormOpen) && !(activeTab === 'support' && ticketFormOpen);

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.container}>
      {focused && <StatusBar style="dark" />}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={account.refreshing}
            onRefresh={() => void account.refresh('refresh')}
            tintColor="#E53C3C"
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>{shownName}</Text>
            <Text style={styles.phone}>{phoneLabel}</Text>
          </View>
        </View>

        {account.error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{account.error}</Text>
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.content}>
          {showSectionSkeleton ? <ProfileSectionSkeleton active={focused} section={activeTab === 'cards' ? 'overview' : activeTab} /> : <>
          {activeTab === 'overview' && (
            <OverviewTab
              availableStamps={availableStamps}
              stampsPerReward={stampsPerReward}
              stampsToNext={stampsToNext}
              rewardReady={rewardReady}
              lifetimeStamps={lifetimeStamps}
              lifetimeRedemptions={lifetimeRedemptions}
              ledger={account.data.wingsLedger}
              orders={account.data.orders}
              promos={account.data.promos}
              onOpenTab={setActiveTab}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileTab
              savedName={savedName}
              savedPhone={savedPhone}
              email={email}
              loading={authLoading}
              error={profileDisplayError}
              saved={profileSaved}
              phoneCodeTarget={phoneCodeTarget}
              onSave={handleSaveProfile}
              onVerifyPhone={handleVerifyPhone}
              onCancelEdit={cancelProfileEdit}
              showAccountDeletion={session.authenticated && user?.role === 'CUSTOMER'}
              onDeleteAccount={() => setDeleteAccountOpen(true)}
            />
          )}

          {activeTab === 'orders' && (
            <OrdersTab
              filter={orderFilter}
              activeOrders={activeOrders}
              pastOrders={pastOrders}
              visibleOrders={visibleOrders}
              onFilterChange={setOrderFilter}
              hasMoreOrders={Boolean(account.data.ordersNextCursor)}
              loadingMoreOrders={account.loadingMoreOrders}
              paginationDisabled={account.loading || account.refreshing}
              ordersError={account.sectionErrors?.orders ?? null}
              onLoadMore={() => { void account.loadMoreOrders(); }}
              onRetry={() => { void account.refresh('refresh'); }}
            />
          )}

          {activeTab === 'addresses' && (
            <AddressesTab
              addresses={account.data.addresses}
              form={addressForm}
              formOpen={addressFormOpen}
              busy={addressBusy}
              error={addressError}
              onAdd={startNewAddress}
              onEdit={startEditAddress}
              onDelete={handleDeleteAddress}
              onCancel={() => {
                setAddressForm(EMPTY_ADDRESS_FORM);
                setAddressFormOpen(false);
                setAddressError(null);
              }}
              onChange={setAddressForm}
              onSave={handleSaveAddress}
            />
          )}

          {activeTab === 'support' && (
            <SupportTab
              tickets={account.data.tickets}
              orders={account.data.orders}
              form={ticketForm}
              formOpen={ticketFormOpen}
              busy={ticketBusy}
              error={ticketError}
              onAdd={() => {
                setTicketError(null);
                setTicketFormOpen(true);
              }}
              onCancel={() => {
                setTicketForm(EMPTY_TICKET_FORM);
                setTicketError(null);
                setTicketFormOpen(false);
              }}
              onChange={setTicketForm}
              onSave={handleCreateTicket}
            />
          )}

          {/* {activeTab === 'cards' && <CardsTab orders={account.data.orders} />} */}
          </>}
        </View>
      </ScrollView>

      <View style={styles.logoutBar}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} disabled={authLoading}>
          <LogOut size={18} color="#E53C3C" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
      {deleteAccountOpen ? <AccountDeletionModal visible onClose={() => setDeleteAccountOpen(false)}
        onCompleted={async () => {
          session.clear();
          navigation.reset({ index: 0, routes: [{ name: 'index' }] });
          try { await forgetDeletedAccount(); }
          catch { Alert.alert('Account deleted', 'You are signed out. Some local saved data could not be cleared.'); return; }
          Alert.alert('Account deleted', 'Your Wings4U account has been deleted.');
        }} /> : null}
    </SafeAreaView>
  );
}

function OverviewTab({
  availableStamps,
  stampsPerReward,
  stampsToNext,
  rewardReady,
  lifetimeStamps,
  lifetimeRedemptions,
  ledger,
  orders,
  promos,
  onOpenTab,
}: {
  availableStamps: number;
  stampsPerReward: number;
  stampsToNext: number;
  rewardReady: boolean;
  lifetimeStamps: number;
  lifetimeRedemptions: number;
  ledger: WingsStampEntry[];
  orders: OrderSummary[];
  promos: ActivePromo[];
  onOpenTab: (tab: TabKey) => void;
}) {
  return (
    <>
      <RewardsHub
        availableStamps={availableStamps}
        stampsPerReward={stampsPerReward}
        stampsToNext={stampsToNext}
        rewardReady={rewardReady}
        lifetimeStamps={lifetimeStamps}
        lifetimeRedemptions={lifetimeRedemptions}
        ledger={ledger}
        promos={promos}
      />

      <SectionCard title="Recent orders" actionLabel="View all" onAction={() => onOpenTab('orders')}>
        {orders.slice(0, 3).length === 0 ? (
          <EmptyLine text="No orders yet" />
        ) : (
          orders.slice(0, 3).map((order) => <OrderRow key={order.id} order={order} />)
        )}
      </SectionCard>
    </>
  );
}

function RewardsHub({
  availableStamps,
  stampsPerReward,
  stampsToNext,
  rewardReady,
  lifetimeStamps,
  lifetimeRedemptions,
  ledger,
  promos,
}: {
  availableStamps: number;
  stampsPerReward: number;
  stampsToNext: number;
  rewardReady: boolean;
  lifetimeStamps: number;
  lifetimeRedemptions: number;
  ledger: WingsStampEntry[];
  promos: ActivePromo[];
}) {
  const [hubTab, setHubTab] = useState<'rewards' | 'coupons'>('rewards');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedPromoId, setCopiedPromoId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyPromoCode(promo: ActivePromo) {
    await Clipboard.setStringAsync(promo.code);
    setCopiedPromoId(promo.id);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedPromoId(null), 1600);
  }

  return (
    <View style={styles.hubCard}>
      <View style={styles.hubTabs}>
        <TouchableOpacity onPress={() => setHubTab('rewards')} hitSlop={8}>
          <Text style={[styles.hubTab, hubTab === 'rewards' && styles.hubTabActive]}>Rewards hub</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hubTabCoupons} onPress={() => setHubTab('coupons')} hitSlop={8}>
          <Text style={[styles.hubTab, hubTab === 'coupons' && styles.hubTabActive]}>Coupons</Text>
          <View style={[styles.hubCount, hubTab === 'coupons' && styles.hubCountActive]}>
            <Text style={[styles.hubCountText, hubTab === 'coupons' && styles.hubCountTextActive]}>
              {promos.length}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.hubTitle}>
        {hubTab === 'rewards'
          ? (rewardReady ? 'Your free wings are ready' : 'Free wings stamp card')
          : 'Available coupons'}
      </Text>
      <Text style={styles.hubDesc}>
        {hubTab === 'rewards'
          ? (rewardReady
            ? "You've collected all 8 stamps. Redeem at checkout for 1lb of wings, on us."
            : `Earn 1 stamp for every pound of wings you order. Collect ${stampsPerReward} stamps to unlock 1lb of wings free.`)
          : 'Active promotions and special offers currently available for your account.'}
      </Text>

      {hubTab === 'rewards' ? (
        <>
          <View style={styles.rewardsPanel}>
            <View style={styles.pointsCol}>
              <Text style={styles.pointsNum}>
                {availableStamps}
                <Text style={styles.pointsDenom}>/{stampsPerReward}</Text>
              </Text>
              <Text style={styles.pointsLabel}>Stamps collected</Text>
              <Text style={styles.pointsCredit}>
                {rewardReady ? 'Ready to redeem' : `${stampsToNext} more to go`}
              </Text>
            </View>
            <StampRing available={availableStamps} total={stampsPerReward} ready={rewardReady} />
            <View style={styles.pointsCol}>
              <Text style={styles.pointsNumMuted}>{lifetimeRedemptions}</Text>
              <Text style={styles.pointsLabel}>Free pounds unlocked</Text>
              <Text style={styles.pointsCredit}>
                {lifetimeStamps} stamps earned all-time
              </Text>
            </View>
          </View>

          <View style={styles.stampRow}>
            {Array.from({ length: stampsPerReward }).map((_, index) => {
              const filled = index < availableStamps;
              return (
                <View key={index} style={[styles.stampSlot, filled && styles.stampSlotFilled]}>
                  <Text style={[styles.stampSlotText, filled && styles.stampSlotTextFilled]}>
                    {filled ? '🍗' : index + 1}
                  </Text>
                </View>
              );
            })}
          </View>

          <TouchableOpacity style={styles.historyLink} onPress={() => setHistoryOpen(true)}>
            <Text style={styles.historyLinkText}>View history  →</Text>
          </TouchableOpacity>
        </>
      ) : promos.length === 0 ? (
        <View style={styles.couponEmpty}>
          <Text style={styles.couponEmptyIcon}>🏷️</Text>
          <Text style={styles.couponEmptyTitle}>No coupons yet</Text>
          <Text style={styles.couponEmptyDesc}>Check back later for special offers and discounts.</Text>
        </View>
      ) : (
        promos.map((promo) => {
          const fulfillment = promoFulfillment(promo);
          return (
            <View key={promo.id} style={styles.couponRow}>
              <View style={styles.couponIcon}>
                <Text style={styles.couponIconText}>🏷️</Text>
              </View>
              <View style={styles.couponBody}>
                <Text style={styles.couponCode}>{promo.code}</Text>
                <Text style={styles.couponName}>{promo.name}</Text>
                {promo.minSubtotalCents > 0 ? (
                  <Text style={styles.couponMeta}>Min order: {cents(promo.minSubtotalCents)}</Text>
                ) : null}
                {promo.endsAt ? (
                  <Text style={styles.couponEnds}>
                    Ends: {new Date(promo.endsAt).toLocaleDateString()}
                  </Text>
                ) : null}
                {fulfillment ? <Text style={styles.couponMeta}>{fulfillment}</Text> : null}
              </View>
              <View style={styles.couponOffer}>
                <Text style={styles.couponBenefit}>{promoBenefit(promo)}</Text>
                <TouchableOpacity
                  style={styles.couponCopy}
                  onPress={() => { void copyPromoCode(promo); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy code ${promo.code}`}
                  hitSlop={8}
                >
                  {copiedPromoId === promo.id ? (
                    <Check size={15} color="#10B981" />
                  ) : (
                    <Copy size={15} color="#75665C" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <StampHistoryModal
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        availableStamps={availableStamps}
        stampsPerReward={stampsPerReward}
        lifetimeStamps={lifetimeStamps}
        lifetimeRedemptions={lifetimeRedemptions}
        ledger={ledger}
      />
    </View>
  );
}

function StampRing({ available, total, ready }: { available: number; total: number; ready: boolean }) {
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(available / total, 1) : 0;
  const dash = progress * circumference;
  const center = size / 2;

  return (
    <View style={styles.ringWrap}>
      <Svg width={size} height={size} style={styles.ringSvg}>
        <Defs>
          <LinearGradient id="stampRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#E53C3C" />
            <Stop offset="1" stopColor="#F2A39B" />
          </LinearGradient>
        </Defs>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#F6EEE9"
          strokeWidth={stroke}
          fill="none"
        />
        {dash > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="url(#stampRing)"
            strokeWidth={stroke + 1}
            fill="none"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
      {dash === 0 ? <View style={styles.ringStartDot} /> : null}
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={styles.ringEmoji}>{ready ? '🎁' : '🍗'}</Text>
        <Text style={styles.ringFraction}>{available}/{total}</Text>
      </View>
    </View>
  );
}

function StampHistoryModal({
  visible,
  onClose,
  availableStamps,
  stampsPerReward,
  lifetimeStamps,
  lifetimeRedemptions,
  ledger,
}: {
  visible: boolean;
  onClose: () => void;
  availableStamps: number;
  stampsPerReward: number;
  lifetimeStamps: number;
  lifetimeRedemptions: number;
  ledger: WingsStampEntry[];
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeading}>
              <Text style={styles.modalEyebrow}>Rewards hub</Text>
              <Text style={styles.modalTitle}>Your wings stamp card</Text>
            </View>
            <TouchableOpacity style={styles.modalClose} onPress={onClose}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.modalStats}>
              <View style={styles.modalStat}>
                <Text style={styles.modalStatValue}>{availableStamps}/{stampsPerReward}</Text>
                <Text style={styles.modalStatLabel}>Stamps collected</Text>
              </View>
              <View style={styles.modalStat}>
                <Text style={styles.modalStatValue}>{lifetimeStamps}</Text>
                <Text style={styles.modalStatLabel}>Lifetime stamps</Text>
              </View>
              <View style={styles.modalStat}>
                <Text style={styles.modalStatValue}>{lifetimeRedemptions}</Text>
                <Text style={styles.modalStatLabel}>Free pounds redeemed</Text>
              </View>
            </View>

            <View style={styles.stampRow}>
              {Array.from({ length: stampsPerReward }).map((_, index) => {
                const filled = index < availableStamps;
                return (
                  <View key={index} style={[styles.stampSlot, filled && styles.stampSlotFilled]}>
                    <Text style={[styles.stampSlotText, filled && styles.stampSlotTextFilled]}>
                      {filled ? '🍗' : index + 1}
                    </Text>
                  </View>
                );
              })}
            </View>

            <Text style={styles.historyTitle}>Stamp history</Text>
            {ledger.length === 0 ? (
              <View style={styles.couponEmpty}>
                <Text style={styles.couponEmptyIcon}>🍗</Text>
                <Text style={styles.couponEmptyTitle}>No stamps yet</Text>
                <Text style={styles.couponEmptyDesc}>
                  Order a pound of wings on pickup or delivery — your first stamp lands here the moment the order wraps up.
                </Text>
              </View>
            ) : (
              ledger.map((entry) => {
                const isGift = entry.entry_type === 'ADMIN_GRANTED';
                const isEarn = entry.entry_type === 'EARNED' || isGift;
                const orderLabel = entry.order_number ? `Order #${entry.order_number}` : null;
                return (
                  <View key={entry.id} style={styles.historyRow}>
                    <View style={[styles.historyIcon, isEarn ? styles.historyIconEarn : styles.historyIconRedeem]}>
                      <Text style={styles.historyIconText}>{isEarn ? '🍗' : '🎁'}</Text>
                    </View>
                    <View style={styles.historyBody}>
                      <Text style={styles.historyName}>
                        {isGift
                          ? 'Gifted by Wings 4 U'
                          : isEarn
                            ? `Earned ${Math.abs(entry.delta_stamps)} stamp${Math.abs(entry.delta_stamps) === 1 ? '' : 's'}`
                            : 'Redeemed 1lb of wings free'}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {new Date(entry.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {orderLabel ? `   ${orderLabel}` : ''}
                      </Text>
                      {entry.reason_text ? <Text style={styles.historyReason}>{entry.reason_text}</Text> : null}
                    </View>
                    <Text style={[styles.historyDelta, isEarn ? styles.historyDeltaEarn : styles.historyDeltaRedeem]}>
                      {isEarn ? '+' : ''}{entry.delta_stamps}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProfileTab({
  savedName,
  savedPhone,
  email,
  loading,
  error,
  saved,
  phoneCodeTarget,
  onSave,
  onVerifyPhone,
  onCancelEdit,
  showAccountDeletion,
  onDeleteAccount,
}: {
  savedName: string;
  savedPhone: string;
  email: string;
  loading: boolean;
  error: string | null;
  saved: boolean;
  phoneCodeTarget: string | null;
  onSave: (name: string, phone: string) => void;
  onVerifyPhone: (code: string) => void;
  onCancelEdit: () => void;
  showAccountDeletion: boolean;
  onDeleteAccount: () => void;
}) {
  const nameRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(savedName);
  const [phone, setPhone] = useState(savedPhone);
  const [otp, setOtp] = useState('');
  const verifyingPhone = phoneCodeTarget !== null;
  const fieldsLocked = !editing || verifyingPhone;
  const nameChanged = fullName.trim() !== savedName.trim();
  const phoneChanged = phoneDigits(phone) !== phoneDigits(savedPhone);
  const canSave = verifyingPhone
    ? otp.trim().length === 6 && !loading
    : editing && (nameChanged || phoneChanged) && !loading;

  useEffect(() => {
    if (editing || verifyingPhone) return;
    setFullName(savedName);
    setPhone(savedPhone);
  }, [editing, verifyingPhone, savedName, savedPhone]);

  useEffect(() => {
    if (!saved) return;
    setEditing(false);
    setOtp('');
  }, [saved]);

  useEffect(() => {
    if (!editing || verifyingPhone) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing, verifyingPhone]);

  function beginEdit() {
    onCancelEdit();
    setFullName(savedName);
    setPhone(savedPhone);
    setOtp('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setFullName(savedName);
    setPhone(savedPhone);
    setOtp('');
    onCancelEdit();
  }

  return (
    <SectionCard
      title="Account settings"
      headerAction={(
        <TouchableOpacity
          style={styles.editBtn}
          onPress={editing || verifyingPhone ? cancelEdit : beginEdit}
          accessibilityLabel={editing || verifyingPhone ? 'Cancel editing' : 'Edit account'}
        >
          {editing || verifyingPhone ? (
            <X size={16} color="#4A3B34" />
          ) : (
            <Pencil size={16} color="#4A3B34" />
          )}
        </TouchableOpacity>
      )}
    >
      {error ? <Banner kind="error" text={error} /> : null}
      {saved ? <Banner kind="success" text="Profile updated" /> : null}
      <InputRow icon={<User size={20} color={fieldsLocked ? '#81736A' : '#E53C3C'} />}>
        <TextInput
          ref={nameRef}
          style={[styles.input, fieldsLocked && styles.inputReadonly]}
          placeholder="Full Name"
          placeholderTextColor="#A6948A"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          returnKeyType="next"
          editable={!fieldsLocked}
        />
      </InputRow>
      <InputRow icon={<Mail size={20} color="#81736A" />}>
        <TextInput
          style={[styles.input, styles.inputReadonly]}
          placeholder="Email"
          placeholderTextColor="#A6948A"
          value={email}
          editable={false}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </InputRow>
      <InputRow icon={<Phone size={20} color={fieldsLocked ? '#81736A' : '#E53C3C'} />}>
        <TextInput
          style={[styles.input, fieldsLocked && styles.inputReadonly]}
          placeholder="Phone number"
          placeholderTextColor="#A6948A"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          editable={!fieldsLocked}
        />
      </InputRow>
      {verifyingPhone ? (
        <>
          <Text style={styles.helperText}>
            Enter the code sent to {phoneCodeTarget} to confirm the new phone number.
          </Text>
          <InputRow icon={<Mail size={20} color="#E53C3C" />}>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor="#A6948A"
              value={otp}
              onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
            />
          </InputRow>
        </>
      ) : null}
      <TouchableOpacity
        style={[styles.primaryBtn, !canSave && styles.disabledBtn]}
        onPress={() => {
          if (!canSave) return;
          if (verifyingPhone) onVerifyPhone(otp.trim());
          else onSave(fullName, phone);
        }}
        disabled={!canSave}
      >
        {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Save size={18} color="#FFFFFF" />}
        <Text style={styles.primaryBtnText}>
          {loading ? 'Saving...' : verifyingPhone ? 'Confirm code' : 'Save Changes'}
        </Text>
      </TouchableOpacity>
      {showAccountDeletion ? (
        <View style={styles.accountDeletion}>
          <TouchableOpacity
            style={styles.deleteAccountBtn}
            onPress={onDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Delete Account"
            accessibilityHint="Review permanent account deletion and data retention."
          >
            <Trash2 size={18} color="#B91C1C" />
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </TouchableOpacity>
          <Text style={styles.helperText}>
            Review permanent account deletion and data retention.
          </Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function OrdersTab({
  filter,
  activeOrders,
  pastOrders,
  visibleOrders,
  onFilterChange,
  hasMoreOrders,
  loadingMoreOrders,
  paginationDisabled,
  ordersError,
  onLoadMore,
  onRetry,
}: {
  filter: OrderFilter;
  activeOrders: OrderSummary[];
  pastOrders: OrderSummary[];
  visibleOrders: OrderSummary[];
  onFilterChange: (filter: OrderFilter) => void;
  hasMoreOrders: boolean;
  loadingMoreOrders: boolean;
  paginationDisabled: boolean;
  ordersError: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const focused = useIsFocused();
  return (
    <SectionCard title="Order history">
      <View style={styles.switchRow}>
        <TouchableOpacity
          style={[styles.switchBtn, filter === 'active' && styles.switchBtnActive]}
          onPress={() => onFilterChange('active')}
        >
          <Text style={[styles.switchText, filter === 'active' && styles.switchTextActive]}>
            Active ({activeOrders.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.switchBtn, filter === 'past' && styles.switchBtnActive]}
          onPress={() => onFilterChange('past')}
        >
          <Text style={[styles.switchText, filter === 'past' && styles.switchTextActive]}>
            Past ({pastOrders.length})
          </Text>
        </TouchableOpacity>
      </View>

      {hasMoreOrders ? <Text style={styles.orderPageNote}>Counts show loaded orders. Older orders may be on the next pages.</Text> : null}
      {visibleOrders.length === 0 ? (
        <EmptyLine text={filter === 'active' ? 'No active orders' : hasMoreOrders
          ? 'No past orders in the loaded pages. Load more orders to check older history.' : ordersError
            ? 'Order history could not be loaded.' : 'No past orders'} />
      ) : (
        visibleOrders.map((order) => <OrderRow key={order.id} order={order} />)
      )}
      {loadingMoreOrders ? <OrdersPaginationSkeleton active={focused} /> : null}
      {filter === 'past' ? <>
        {ordersError ? <Text style={styles.errorText} accessibilityRole="alert">{ordersError}</Text> : null}
        {hasMoreOrders ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Load More Orders"
          accessibilityState={{ disabled: loadingMoreOrders || paginationDisabled, busy: loadingMoreOrders }}
          disabled={loadingMoreOrders || paginationDisabled} style={styles.loadMoreOrders} onPress={onLoadMore}>
          <Text style={styles.loadMoreOrdersText}>{loadingMoreOrders ? 'Loading more orders...' : 'Load More Orders'}</Text>
        </TouchableOpacity> : ordersError ? <TouchableOpacity accessibilityRole="button" style={styles.loadMoreOrders}
          disabled={paginationDisabled} onPress={onRetry}><Text style={styles.loadMoreOrdersText}>Try again</Text></TouchableOpacity> : null}
      </> : null}
    </SectionCard>
  );
}

function AddressesTab({
  addresses,
  form,
  formOpen,
  busy,
  error,
  onAdd,
  onEdit,
  onDelete,
  onCancel,
  onChange,
  onSave,
}: {
  addresses: CustomerAddress[];
  form: AddressForm;
  formOpen: boolean;
  busy: boolean;
  error: string | null;
  onAdd: () => void;
  onEdit: (address: CustomerAddress) => void;
  onDelete: (address: CustomerAddress) => void;
  onCancel: () => void;
  onChange: (form: AddressForm) => void;
  onSave: () => void;
}) {
  return (
    <SectionCard title="Saved addresses" actionLabel="Add" onAction={onAdd}>
      {error ? <Banner kind="error" text={error} /> : null}
      {formOpen ? (
        <View style={styles.formBlock}>
          <InputRow icon={<Home size={20} color="#E53C3C" />}>
            <TextInput
              style={styles.input}
              placeholder="Street address"
              placeholderTextColor="#A6948A"
              value={form.line1}
              onChangeText={(line1) => onChange({ ...form, line1 })}
            />
          </InputRow>
          <InputRow icon={<MapPin size={20} color="#E53C3C" />}>
            <TextInput
              style={styles.input}
              placeholder="City"
              placeholderTextColor="#A6948A"
              value={form.city}
              onChangeText={(city) => onChange({ ...form, city })}
            />
          </InputRow>
          <InputRow icon={<MapPin size={20} color="#E53C3C" />}>
            <TextInput
              style={styles.input}
              placeholder="Postal code"
              placeholderTextColor="#A6948A"
              value={form.postal_code}
              onChangeText={(postal_code) => onChange({ ...form, postal_code })}
              autoCapitalize="characters"
            />
          </InputRow>
          <InputRow icon={<User size={20} color="#E53C3C" />}>
            <TextInput
              style={styles.input}
              placeholder="Label (Home, Work)"
              placeholderTextColor="#A6948A"
              value={form.label}
              onChangeText={(label) => onChange({ ...form, label })}
            />
          </InputRow>
          <TouchableOpacity
            style={[styles.checkRow, form.is_default && styles.checkRowActive]}
            onPress={() => onChange({ ...form, is_default: !form.is_default })}
          >
            <CheckCircle2 size={18} color={form.is_default ? '#E53C3C' : '#81736A'} />
            <Text style={[styles.checkText, form.is_default && styles.checkTextActive]}>Default address</Text>
          </TouchableOpacity>
          <View style={styles.formActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel} disabled={busy}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, styles.formPrimaryBtn, busy && styles.disabledBtn]} onPress={onSave} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Save size={18} color="#FFFFFF" />}
              <Text style={styles.primaryBtnText}>{busy ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {addresses.length === 0 ? (
        <EmptyLine text="No saved addresses yet" />
      ) : (
        addresses.map((address) => (
          <View key={address.id} style={styles.addressRow}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>
                {address.label ? `${address.label}: ` : ''}{address.line1}
              </Text>
              <Text style={styles.rowMeta}>
                {address.city}, {address.postal_code}{address.is_default ? ' - Default' : ''}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity style={styles.smallActionBtn} onPress={() => onEdit(address)}>
                <Text style={styles.smallActionText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteIconBtn} onPress={() => onDelete(address)}>
                <Trash2 size={16} color="#E53C3C" />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </SectionCard>
  );
}

function SupportTab({
  tickets,
  orders,
  form,
  formOpen,
  busy,
  error,
  onAdd,
  onCancel,
  onChange,
  onSave,
}: {
  tickets: SupportTicketSummary[];
  orders: OrderSummary[];
  form: TicketInput;
  formOpen: boolean;
  busy: boolean;
  error: string | null;
  onAdd: () => void;
  onCancel: () => void;
  onChange: (form: TicketInput) => void;
  onSave: () => void;
}) {
  return (
    <>
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Need help?</Text>
        </View>
        <Text style={styles.helperText}>
          Tell us what happened and our support team will help you out.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onAdd}>
          <Ticket size={18} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>Contact support</Text>
        </TouchableOpacity>
      </View>
      <SectionCard title="Support tickets">
      {error ? <Banner kind="error" text={error} /> : null}
      {formOpen ? (
        <View style={styles.formBlock}>
          <Text style={styles.formLabel}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {SUPPORT_TICKET_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, form.ticket_type === type && styles.chipActive]}
                onPress={() => onChange({ ...form, ticket_type: type })}
              >
                <Text style={[styles.chipText, form.ticket_type === type && styles.chipTextActive]}>
                  {formatTicketType(type)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <InputRow icon={<Ticket size={20} color="#E53C3C" />}>
            <TextInput
              style={styles.input}
              placeholder="Subject"
              placeholderTextColor="#A6948A"
              value={form.subject}
              onChangeText={(subject) => onChange({ ...form, subject })}
            />
          </InputRow>
          <View style={styles.textAreaWrap}>
            <TextInput
              style={styles.textArea}
              placeholder="What happened?"
              placeholderTextColor="#A6948A"
              value={form.description}
              onChangeText={(description) => onChange({ ...form, description })}
              multiline
              textAlignVertical="top"
            />
          </View>
          <Text style={styles.formLabel}>Link order</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, !form.order_id && styles.chipActive]}
              onPress={() => onChange({ ...form, order_id: undefined })}
            >
              <Text style={[styles.chipText, !form.order_id && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
            {orders.slice(0, 8).map((order) => (
              <TouchableOpacity
                key={order.id}
                style={[styles.chip, form.order_id === order.id && styles.chipActive]}
                onPress={() => onChange({ ...form, order_id: order.id })}
              >
                <Text style={[styles.chipText, form.order_id === order.id && styles.chipTextActive]}>
                  #{order.order_number}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.formActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel} disabled={busy}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, styles.formPrimaryBtn, busy && styles.disabledBtn]} onPress={onSave} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Plus size={18} color="#FFFFFF" />}
              <Text style={styles.primaryBtnText}>{busy ? 'Creating...' : 'Create'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {tickets.length === 0 ? (
        <EmptyLine text="No support tickets yet" />
      ) : (
        tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)
      )}
      </SectionCard>
    </>
  );
}

function CardsTab({ orders }: { orders: OrderSummary[] }) {
  const cardOrders = orders.filter((order) => order.payment_status_summary !== 'UNPAID');

  return (
    <SectionCard title="Payment methods">
      <View style={styles.emptyCard}>
        <CreditCard size={30} color="#E53C3C" />
        <Text style={styles.emptyTitle}>No saved cards</Text>
        <Text style={styles.emptyText}>
          Saved card storage is not enabled yet. Past paid orders remain available in order history.
        </Text>
      </View>
      {cardOrders.slice(0, 4).map((order) => (
        <View key={order.id} style={styles.simpleRow}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Order #{order.order_number}</Text>
            <Text style={styles.rowMeta}>{statusLabel(order.payment_status_summary)} - {shortDate(order.placed_at)}</Text>
          </View>
          <Text style={styles.amount}>{cents(order.final_payable_cents)}</Text>
        </View>
      ))}
    </SectionCard>
  );
}

function SectionCard({
  title,
  actionLabel,
  onAction,
  headerAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {headerAction}
        {actionLabel && onAction ? (
          <TouchableOpacity style={styles.sectionAction} onPress={onAction}>
            <Text style={styles.sectionActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function OrderRow({ order }: { order: OrderSummary }) {
  const router = useRouter();
  return (
    <View><TouchableOpacity style={styles.orderRow} accessibilityRole="button" accessibilityLabel={`Order #${order.order_number}`} onPress={() => router.push(`/orders/${order.id}`)}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>Order #{order.order_number}</Text>
        <Text style={styles.rowMeta}>
          {statusLabel(order.status)} - {titleCase(order.fulfillment_type)} - {shortDate(order.placed_at)}
        </Text>
      </View>
      <Text style={styles.amount}>{cents(order.final_payable_cents)}</Text>
    </TouchableOpacity><OrderReorderAction order={order} /></View>
  );
}

function TicketRow({ ticket }: { ticket: SupportTicketSummary }) {
  const router = useRouter();
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View support ticket: ${ticket.subject}`} onPress={() => router.push(`/support/${ticket.id}`)} style={styles.ticketRow}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{ticket.subject}</Text>
        <Text style={styles.rowMeta}>
          {formatTicketType(ticket.ticket_type)} - {statusLabel(ticket.status)} - {relativeTime(ticket.updated_at)}
        </Text>
        {ticket.latest_public_message ? (
          <Text style={styles.previewText} numberOfLines={2}>{ticket.latest_public_message.message_body}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <View style={styles.emptyLine}>
      <Text style={styles.emptyLineText}>{text}</Text>
    </View>
  );
}

function InputRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.inputRow}>
      {icon}
      {children}
    </View>
  );
}

function Banner({ kind, text }: { kind: 'error' | 'success'; text: string }) {
  return (
    <View style={[styles.banner, kind === 'success' ? styles.successBanner : styles.errorBannerInline]}>
      <Text style={[styles.bannerText, kind === 'success' ? styles.successText : styles.errorText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF9F5',
  },
  scroll: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#806F66',
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    alignItems: 'center',
  },
  headerText: {
    alignItems: 'center',
  },
  name: {
    color: '#30241F',
    fontSize: 22,
    fontWeight: '800',
  },
  phone: {
    color: '#4A3B34',
    backgroundColor: '#FFF0EA',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
  errorBanner: {
    backgroundColor: 'rgba(229,60,60,0.1)',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  errorText: {
    color: '#E53C3C',
    fontSize: 13,
    fontWeight: '700',
  },
  tabs: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  tab: {
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EFE4DE',
  },
  tabActive: {
    backgroundColor: '#FFF0EA',
    borderColor: '#E53C3C',
  },
  tabText: {
    color: '#806F66',
    fontSize: 13,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#E53C3C',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 15,
    marginBottom: 12,
    shadowColor: '#4A3B34',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    flex: 1,
    color: '#30241F',
    fontSize: 17,
    fontWeight: '800',
  },
  accountDeletion: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#EBDDD5',
  },
  deleteAccountBtn: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: '#B91C1C',
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteAccountText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '700',
  },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F6EEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionAction: {
    backgroundColor: 'rgba(229,60,60,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sectionActionText: {
    color: '#E53C3C',
    fontSize: 12,
    fontWeight: '800',
  },
  hubCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBDDD5',
    padding: 16,
    marginBottom: 12,
  },
  hubTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginBottom: 10,
  },
  hubTab: {
    color: '#A18F85',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  hubTabActive: {
    color: '#E53C3C',
  },
  hubTabCoupons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hubCount: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(86,63,51,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubCountActive: {
    backgroundColor: '#E53C3C',
  },
  hubCountText: {
    color: '#75665C',
    fontSize: 11,
    fontWeight: '800',
  },
  hubCountTextActive: {
    color: '#FFFFFF',
  },
  hubTitle: {
    color: '#30241F',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  hubDesc: {
    color: '#75665C',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 6,
  },
  rewardsPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF9F5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F6EEE9',
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginTop: 14,
  },
  pointsCol: {
    flex: 1,
    minWidth: 0,
  },
  pointsNum: {
    color: '#E53C3C',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 30,
  },
  pointsDenom: {
    color: '#A18F85',
    fontSize: 16,
    fontWeight: '700',
  },
  pointsNumMuted: {
    color: '#75665C',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  pointsLabel: {
    color: '#A18F85',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  pointsCredit: {
    color: '#75665C',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  ringWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSvg: {
    transform: [{ rotate: '-90deg' }],
  },
  ringStartDot: {
    position: 'absolute',
    top: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E53C3C',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  ringEmoji: {
    fontSize: 22,
  },
  ringFraction: {
    color: '#A18F85',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 1,
  },
  stampRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
  },
  stampSlot: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F6EEE9',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#EBDDD5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampSlotFilled: {
    backgroundColor: '#FFF0EA',
    borderStyle: 'solid',
    borderColor: '#F2A39B',
  },
  stampSlotText: {
    color: '#A18F85',
    fontSize: 13,
    fontWeight: '800',
  },
  stampSlotTextFilled: {
    fontSize: 15,
  },
  historyLink: {
    alignSelf: 'flex-end',
    marginTop: 12,
    paddingVertical: 4,
  },
  historyLinkText: {
    color: '#A18F85',
    fontSize: 13,
    fontWeight: '700',
  },
  couponEmpty: {
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 8,
  },
  couponEmptyIcon: {
    fontSize: 28,
    width: 64,
    height: 64,
    lineHeight: 64,
    textAlign: 'center',
    borderRadius: 32,
    backgroundColor: '#F6EEE9',
    overflow: 'hidden',
    marginBottom: 10,
  },
  couponEmptyTitle: {
    color: '#30241F',
    fontSize: 16,
    fontWeight: '800',
  },
  couponEmptyDesc: {
    color: '#75665C',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  couponRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF9F5',
    borderWidth: 1,
    borderColor: '#F6EEE9',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  couponIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  couponIconText: {
    fontSize: 18,
  },
  couponBody: {
    flex: 1,
    minWidth: 0,
  },
  couponCode: {
    color: '#30241F',
    fontSize: 15,
    fontWeight: '800',
  },
  couponName: {
    color: '#75665C',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  couponMeta: {
    color: '#75665C',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  couponEnds: {
    color: '#E53C3C',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  couponBenefit: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    flexShrink: 1,
  },
  couponOffer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 132,
  },
  couponCopy: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F6EEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(48,36,31,0.55)',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    maxHeight: '88%',
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  modalHeading: {
    flex: 1,
  },
  modalEyebrow: {
    color: '#E53C3C',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  modalTitle: {
    color: '#30241F',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F6EEE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#75665C',
    fontSize: 16,
    fontWeight: '700',
  },
  modalStats: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  modalStat: {
    flex: 1,
  },
  modalStatValue: {
    color: '#30241F',
    fontSize: 16,
    fontWeight: '800',
  },
  modalStatLabel: {
    color: '#A18F85',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 3,
  },
  historyTitle: {
    color: '#A18F85',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF9F5',
    borderWidth: 1,
    borderColor: '#F6EEE9',
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIconEarn: {
    backgroundColor: '#FFF0EA',
  },
  historyIconRedeem: {
    backgroundColor: '#F1FAF4',
  },
  historyIconText: {
    fontSize: 18,
  },
  historyBody: {
    flex: 1,
    minWidth: 0,
  },
  historyName: {
    color: '#30241F',
    fontSize: 14,
    fontWeight: '800',
  },
  historyMeta: {
    color: '#A18F85',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  historyReason: {
    color: '#75665C',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  historyDelta: {
    fontSize: 16,
    fontWeight: '800',
  },
  historyDeltaEarn: {
    color: '#10B981',
  },
  historyDeltaRedeem: {
    color: '#E53C3C',
  },
  simpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
    gap: 12,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
    gap: 12,
  },
  ticketRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
  },
  addressRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
    gap: 10,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    color: '#30241F',
    fontSize: 14,
    fontWeight: '800',
  },
  rowMeta: {
    color: '#81736A',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  previewText: {
    color: '#6B5A51',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  amount: {
    color: '#30241F',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyLine: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
  },
  emptyLineText: {
    color: '#93847B',
    fontWeight: '700',
    textAlign: 'center',
  },
  inputRow: {
    height: 54,
    backgroundColor: '#FBF5F1',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    marginLeft: 12,
    color: '#30241F',
    fontSize: 16,
    fontWeight: '600',
  },
  inputReadonly: {
    color: '#81736A',
  },
  helperText: {
    color: '#81736A',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: '#E53C3C',
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  formPrimaryBtn: {
    flex: 1,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4D5CC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: {
    color: '#6B5A51',
    fontSize: 15,
    fontWeight: '800',
  },
  banner: {
    borderRadius: 12,
    padding: 11,
    marginBottom: 12,
  },
  errorBannerInline: {
    backgroundColor: 'rgba(229,60,60,0.1)',
  },
  successBanner: {
    backgroundColor: '#E9F8EE',
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  successText: {
    color: '#15803D',
  },
  formBlock: {
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
    paddingTop: 12,
    marginBottom: 8,
  },
  formActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  checkRow: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4D5CC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  checkRowActive: {
    backgroundColor: '#FFF0EA',
    borderColor: '#E53C3C',
  },
  checkText: {
    color: '#6B5A51',
    fontSize: 14,
    fontWeight: '800',
  },
  checkTextActive: {
    color: '#E53C3C',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallActionBtn: {
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F7F0EB',
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
    color: '#6B5A51',
    fontSize: 12,
    fontWeight: '800',
  },
  deleteIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(229,60,60,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  switchBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F7F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchBtnActive: {
    backgroundColor: '#FFF0EA',
  },
  switchText: {
    color: '#806F66',
    fontWeight: '800',
    fontSize: 13,
  },
  switchTextActive: {
    color: '#E53C3C',
  },
  orderPageNote: { color: '#777777', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  loadMoreOrders: { minHeight: 48, marginTop: 12, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12, backgroundColor: '#FFF0ED', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  loadMoreOrdersText: { color: '#E53C3C', fontSize: 14, fontWeight: '800' },
  formLabel: {
    color: '#6B5A51',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  chipRow: {
    gap: 8,
    paddingBottom: 10,
  },
  chip: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: '#F7F0EB',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: '#FFF0EA',
  },
  chipText: {
    color: '#806F66',
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextActive: {
    color: '#E53C3C',
  },
  textAreaWrap: {
    backgroundColor: '#FBF5F1',
    borderRadius: 12,
    minHeight: 112,
    marginBottom: 12,
  },
  textArea: {
    color: '#30241F',
    fontSize: 15,
    fontWeight: '600',
    minHeight: 112,
    padding: 14,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
  },
  emptyTitle: {
    color: '#30241F',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 10,
  },
  emptyText: {
    color: '#81736A',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 5,
    textAlign: 'center',
  },
  logoutBar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#FFF9F5',
    borderTopWidth: 1,
    borderTopColor: '#EEE3DD',
  },
  logoutBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(229,60,60,0.35)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  logoutText: {
    color: '#E53C3C',
    fontSize: 15,
    fontWeight: '800',
  },
});
