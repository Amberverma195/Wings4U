import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Gift,
  Home,
  LifeBuoy,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Plus,
  ReceiptText,
  Save,
  Ticket,
  Trash2,
  User,
  Wallet,
} from 'lucide-react-native';
import { useAuth } from '../src/hooks/use-auth';
import {
  type AddressInput,
  type CustomerAddress,
  type SupportTicketSummary,
  type TicketInput,
  useAccountData,
} from '../src/hooks/use-account-data';
import { useSession } from '../src/context/session';
import {
  ACTIVE_STATUSES,
  SUPPORT_TICKET_TYPES,
  type OrderSummary,
  type SupportTicketType,
} from '../src/lib/types';
import { formatPhoneForDisplay } from '../src/lib/phone';

type TabKey = 'overview' | 'profile' | 'orders' | 'addresses' | 'support' | 'cards';
type OrderFilter = 'active' | 'past';

type AddressForm = AddressInput & { id?: string };

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Profile' },
  { key: 'orders', label: 'Orders' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'support', label: 'Support' },
  { key: 'cards', label: 'Cards' },
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

function initialsFor(name?: string | null): string {
  if (!name || isPhoneDisplayName(name)) return 'W4';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'W4';
}

function promoLine(name: string, code: string): string {
  return code ? `${name} (${code})` : name;
}

function formatTicketType(type: string): string {
  return titleCase(type);
}

export default function ProfileScreen() {
  const router = useRouter();
  const session = useSession();
  const account = useAccountData();
  const { updateProfile, logout, loading: authLoading, error: authError, clearError } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('active');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressForm>(EMPTY_ADDRESS_FORM);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [ticketForm, setTicketForm] = useState<TicketInput>(EMPTY_TICKET_FORM);
  const [ticketFormOpen, setTicketFormOpen] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!session.loaded) return;
    if (!session.authenticated) {
      router.replace('/');
    }
  }, [router, session.authenticated, session.loaded]);

  useEffect(() => {
    if (!user) return;
    setFullName(isPhoneDisplayName(user.displayName) ? '' : user.displayName);
    setEmail(user.email ?? '');
  }, [user]);

  useEffect(() => {
    if (session.needsProfileCompletion) {
      setActiveTab('profile');
    }
  }, [session.needsProfileCompletion]);

  async function handleSaveProfile() {
    clearError();
    setProfileError(null);
    setProfileSaved(false);

    const trimmedName = fullName.trim();
    if (trimmedName.length < 4) {
      setProfileError('Name must be at least 4 characters');
      return;
    }

    try {
      await updateProfile(trimmedName);
      await account.refresh('refresh');
      setProfileSaved(true);
    } catch {
      // useAuth owns the network error message
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/');
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
    } finally {
      setTicketBusy(false);
    }
  }

  if (!session.loaded || !user || account.loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#FF4D4D" />
          <Text style={styles.loadingText}>Loading account...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={account.refreshing}
            onRefresh={() => void account.refresh('refresh')}
            tintColor="#FF4D4D"
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsFor(displayName)}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>{shownName}</Text>
            <Text style={styles.phone}>{phoneLabel}</Text>
            <View style={[styles.statusPill, session.profileComplete ? styles.statusComplete : styles.statusIncomplete]}>
              {session.profileComplete ? (
                <CheckCircle2 size={14} color="#15803D" />
              ) : (
                <AlertCircle size={14} color="#B45309" />
              )}
              <Text style={[styles.statusText, session.profileComplete ? styles.statusTextComplete : styles.statusTextIncomplete]}>
                {session.profileComplete ? 'Profile complete' : 'Complete profile'}
              </Text>
            </View>
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
          {activeTab === 'overview' && (
            <OverviewTab
              walletBalance={account.data.wallet?.balance_cents ?? 0}
              availableStamps={availableStamps}
              stampsPerReward={stampsPerReward}
              stampsToNext={stampsToNext}
              rewardReady={rewardReady}
              orders={account.data.orders}
              tickets={account.data.tickets}
              promos={account.data.promos}
              walletLedger={account.data.walletLedger}
              onOpenTab={setActiveTab}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileTab
              fullName={fullName}
              email={email}
              phoneLabel={phoneLabel}
              loading={authLoading}
              error={profileDisplayError}
              saved={profileSaved}
              onNameChange={(value) => {
                setFullName(value);
                setProfileSaved(false);
                setProfileError(null);
                clearError();
              }}
              onSave={handleSaveProfile}
            />
          )}

          {activeTab === 'orders' && (
            <OrdersTab
              filter={orderFilter}
              activeOrders={activeOrders}
              pastOrders={pastOrders}
              visibleOrders={visibleOrders}
              onFilterChange={setOrderFilter}
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

          {activeTab === 'cards' && <CardsTab orders={account.data.orders} />}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} disabled={authLoading}>
          <LogOut size={18} color="#FF4D4D" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function OverviewTab({
  walletBalance,
  availableStamps,
  stampsPerReward,
  stampsToNext,
  rewardReady,
  orders,
  tickets,
  promos,
  walletLedger,
  onOpenTab,
}: {
  walletBalance: number;
  availableStamps: number;
  stampsPerReward: number;
  stampsToNext: number;
  rewardReady: boolean;
  orders: OrderSummary[];
  tickets: SupportTicketSummary[];
  promos: Array<{
    id: string;
    name: string;
    code: string;
    discountType: string;
    benefitSummary?: string;
  }>;
  walletLedger: Array<{ id: string; amount_cents: number; reason_text: string; created_at: string }>;
  onOpenTab: (tab: TabKey) => void;
}) {
  return (
    <>
      <View style={styles.statGrid}>
        <StatCard icon={<Wallet size={20} color="#FF4D4D" />} label="Wallet" value={cents(walletBalance)} />
        <StatCard icon={<Gift size={20} color="#FF4D4D" />} label="Stamps" value={`${availableStamps}/${stampsPerReward}`} />
        <StatCard icon={<ReceiptText size={20} color="#FF4D4D" />} label="Orders" value={String(orders.length)} />
        <StatCard icon={<Ticket size={20} color="#FF4D4D" />} label="Tickets" value={String(tickets.length)} />
      </View>

      <SectionCard
        title={rewardReady ? 'Free wings ready' : 'Wings rewards'}
      >
        <Text style={styles.sectionBody}>
          {rewardReady
            ? 'You have enough stamps for a free 1lb wings reward.'
            : `${stampsToNext} stamp${stampsToNext === 1 ? '' : 's'} until your next 1lb wings reward.`}
        </Text>
        <View style={styles.stampGrid}>
          {Array.from({ length: stampsPerReward }).map((_, index) => (
            <View
              key={index}
              style={[styles.stampDot, index < availableStamps && styles.stampDotFilled]}
            >
              <Text style={[styles.stampDotText, index < availableStamps && styles.stampDotTextFilled]}>
                {index + 1}
              </Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="Recent orders" actionLabel="View all" onAction={() => onOpenTab('orders')}>
        {orders.slice(0, 3).length === 0 ? (
          <EmptyLine text="No orders yet" />
        ) : (
          orders.slice(0, 3).map((order) => <OrderRow key={order.id} order={order} />)
        )}
      </SectionCard>

      <SectionCard title="Support tickets" actionLabel="View all" onAction={() => onOpenTab('support')}>
        {tickets.slice(0, 3).length === 0 ? (
          <EmptyLine text="No tickets yet" />
        ) : (
          tickets.slice(0, 3).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)
        )}
      </SectionCard>

      <SectionCard title="Promotions">
        {promos.slice(0, 3).length === 0 ? (
          <EmptyLine text="No active offers right now" />
        ) : (
          promos.slice(0, 3).map((promo) => (
            <View key={promo.id} style={styles.simpleRow}>
              <View>
                <Text style={styles.rowTitle}>{promoLine(promo.name, promo.code)}</Text>
                <Text style={styles.rowMeta}>{promo.benefitSummary ?? titleCase(promo.discountType)}</Text>
              </View>
            </View>
          ))
        )}
      </SectionCard>

      <SectionCard title="Wallet activity">
        {walletLedger.slice(0, 3).length === 0 ? (
          <EmptyLine text="No wallet activity yet" />
        ) : (
          walletLedger.slice(0, 3).map((entry) => (
            <View key={entry.id} style={styles.simpleRow}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{entry.reason_text}</Text>
                <Text style={styles.rowMeta}>{shortDate(entry.created_at)}</Text>
              </View>
              <Text style={[styles.amount, entry.amount_cents >= 0 ? styles.amountPositive : styles.amountNegative]}>
                {entry.amount_cents >= 0 ? '+' : ''}{cents(entry.amount_cents)}
              </Text>
            </View>
          ))
        )}
      </SectionCard>
    </>
  );
}

function ProfileTab({
  fullName,
  email,
  phoneLabel,
  loading,
  error,
  saved,
  onNameChange,
  onSave,
}: {
  fullName: string;
  email: string;
  phoneLabel: string;
  loading: boolean;
  error: string | null;
  saved: boolean;
  onNameChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <SectionCard title="Account settings">
      {error ? <Banner kind="error" text={error} /> : null}
      {saved ? <Banner kind="success" text="Profile updated" /> : null}
      <InputRow icon={<User size={20} color="#FF4D4D" />}>
        <TextInput
          style={styles.input}
          placeholder="Full Name"
          placeholderTextColor="#AAA"
          value={fullName}
          onChangeText={onNameChange}
          autoCapitalize="words"
          returnKeyType="next"
        />
      </InputRow>
      <InputRow icon={<Mail size={20} color="#FF4D4D" />}>
        <TextInput
          style={[styles.input, styles.inputReadonly]}
          placeholder="Email"
          placeholderTextColor="#AAA"
          value={email}
          editable={false}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </InputRow>
      <Text style={styles.helperText}>
        Email and phone changes require verification from account settings on the website.
      </Text>
      <View style={styles.readonlyRow}>
        <Phone size={19} color="#777" />
        <View>
          <Text style={styles.detailLabel}>Verified phone</Text>
          <Text style={styles.detailValue}>{phoneLabel}</Text>
        </View>
      </View>
      <TouchableOpacity style={[styles.primaryBtn, loading && styles.disabledBtn]} onPress={onSave} disabled={loading}>
        {loading ? <ActivityIndicator color="#FFF" size="small" /> : <Save size={18} color="#FFF" />}
        <Text style={styles.primaryBtnText}>{loading ? 'Saving...' : 'Save Changes'}</Text>
      </TouchableOpacity>
    </SectionCard>
  );
}

function OrdersTab({
  filter,
  activeOrders,
  pastOrders,
  visibleOrders,
  onFilterChange,
}: {
  filter: OrderFilter;
  activeOrders: OrderSummary[];
  pastOrders: OrderSummary[];
  visibleOrders: OrderSummary[];
  onFilterChange: (filter: OrderFilter) => void;
}) {
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

      {visibleOrders.length === 0 ? (
        <EmptyLine text={filter === 'active' ? 'No active orders' : 'No past orders'} />
      ) : (
        visibleOrders.map((order) => <OrderRow key={order.id} order={order} />)
      )}
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
          <InputRow icon={<Home size={20} color="#FF4D4D" />}>
            <TextInput
              style={styles.input}
              placeholder="Street address"
              placeholderTextColor="#AAA"
              value={form.line1}
              onChangeText={(line1) => onChange({ ...form, line1 })}
            />
          </InputRow>
          <InputRow icon={<MapPin size={20} color="#FF4D4D" />}>
            <TextInput
              style={styles.input}
              placeholder="City"
              placeholderTextColor="#AAA"
              value={form.city}
              onChangeText={(city) => onChange({ ...form, city })}
            />
          </InputRow>
          <InputRow icon={<MapPin size={20} color="#FF4D4D" />}>
            <TextInput
              style={styles.input}
              placeholder="Postal code"
              placeholderTextColor="#AAA"
              value={form.postal_code}
              onChangeText={(postal_code) => onChange({ ...form, postal_code })}
              autoCapitalize="characters"
            />
          </InputRow>
          <InputRow icon={<User size={20} color="#FF4D4D" />}>
            <TextInput
              style={styles.input}
              placeholder="Label (Home, Work)"
              placeholderTextColor="#AAA"
              value={form.label}
              onChangeText={(label) => onChange({ ...form, label })}
            />
          </InputRow>
          <TouchableOpacity
            style={[styles.checkRow, form.is_default && styles.checkRowActive]}
            onPress={() => onChange({ ...form, is_default: !form.is_default })}
          >
            <CheckCircle2 size={18} color={form.is_default ? '#FFF' : '#777'} />
            <Text style={[styles.checkText, form.is_default && styles.checkTextActive]}>Default address</Text>
          </TouchableOpacity>
          <View style={styles.formActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel} disabled={busy}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, styles.formPrimaryBtn, busy && styles.disabledBtn]} onPress={onSave} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Save size={18} color="#FFF" />}
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
                <Trash2 size={16} color="#FF4D4D" />
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
    <SectionCard title="Support tickets" actionLabel="New" onAction={onAdd}>
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
          <InputRow icon={<Ticket size={20} color="#FF4D4D" />}>
            <TextInput
              style={styles.input}
              placeholder="Subject"
              placeholderTextColor="#AAA"
              value={form.subject}
              onChangeText={(subject) => onChange({ ...form, subject })}
            />
          </InputRow>
          <View style={styles.textAreaWrap}>
            <TextInput
              style={styles.textArea}
              placeholder="What happened?"
              placeholderTextColor="#AAA"
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
              {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Plus size={18} color="#FFF" />}
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
  );
}

function CardsTab({ orders }: { orders: OrderSummary[] }) {
  const cardOrders = orders.filter((order) => order.payment_status_summary !== 'UNPAID');

  return (
    <SectionCard title="Payment methods">
      <View style={styles.emptyCard}>
        <CreditCard size={30} color="#FF4D4D" />
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
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function OrderRow({ order }: { order: OrderSummary }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.orderRow} onPress={() => router.push(`/orders/${order.id}`)}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>Order #{order.order_number}</Text>
        <Text style={styles.rowMeta}>
          {statusLabel(order.status)} - {titleCase(order.fulfillment_type)} - {shortDate(order.placed_at)}
        </Text>
      </View>
      <Text style={styles.amount}>{cents(order.final_payable_cents)}</Text>
    </TouchableOpacity>
  );
}

function TicketRow({ ticket }: { ticket: SupportTicketSummary }) {
  return (
    <View style={styles.ticketRow}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{ticket.subject}</Text>
        <Text style={styles.rowMeta}>
          {formatTicketType(ticket.ticket_type)} - {statusLabel(ticket.status)} - {relativeTime(ticket.updated_at)}
        </Text>
        {ticket.latest_public_message ? (
          <Text style={styles.previewText} numberOfLines={2}>{ticket.latest_public_message.message_body}</Text>
        ) : null}
      </View>
    </View>
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
    backgroundColor: '#FAFAFA',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#666',
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#FF4D4D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
  },
  headerText: {
    flex: 1,
  },
  name: {
    color: '#1A1A1A',
    fontSize: 22,
    fontWeight: '800',
  },
  phone: {
    color: '#777',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  statusComplete: {
    backgroundColor: '#DCFCE7',
  },
  statusIncomplete: {
    backgroundColor: '#FEF3C7',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  statusTextComplete: {
    color: '#15803D',
  },
  statusTextIncomplete: {
    color: '#B45309',
  },
  errorBanner: {
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  errorText: {
    color: '#FF4D4D',
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
    backgroundColor: '#FFF',
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EEE',
  },
  tabActive: {
    backgroundColor: '#FF4D4D',
    borderColor: '#FF4D4D',
  },
  tabText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#FFF',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },
  statValue: {
    color: '#1A1A1A',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 9,
  },
  statLabel: {
    color: '#777',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 15,
    marginBottom: 12,
    shadowColor: '#000',
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
    color: '#1A1A1A',
    fontSize: 17,
    fontWeight: '800',
  },
  sectionAction: {
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sectionActionText: {
    color: '#FF4D4D',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionBody: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  stampGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  stampDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
  },
  stampDotFilled: {
    backgroundColor: '#FF4D4D',
  },
  stampDotText: {
    color: '#999',
    fontSize: 12,
    fontWeight: '800',
  },
  stampDotTextFilled: {
    color: '#FFF',
  },
  simpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#F1F1F1',
    gap: 12,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F1F1',
    gap: 12,
  },
  ticketRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F1F1',
  },
  addressRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F1F1',
    gap: 10,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    color: '#1A1A1A',
    fontSize: 14,
    fontWeight: '800',
  },
  rowMeta: {
    color: '#777',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  previewText: {
    color: '#555',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  amount: {
    color: '#1A1A1A',
    fontSize: 14,
    fontWeight: '800',
  },
  amountPositive: {
    color: '#15803D',
  },
  amountNegative: {
    color: '#FF4D4D',
  },
  emptyLine: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F1F1',
  },
  emptyLineText: {
    color: '#888',
    fontWeight: '700',
    textAlign: 'center',
  },
  inputRow: {
    height: 54,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    marginLeft: 12,
    color: '#1A1A1A',
    fontSize: 16,
    fontWeight: '600',
  },
  inputReadonly: {
    color: '#777',
  },
  helperText: {
    color: '#777',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginBottom: 12,
  },
  readonlyRow: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    marginBottom: 12,
  },
  detailLabel: {
    color: '#777',
    fontSize: 12,
    fontWeight: '700',
  },
  detailValue: {
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: '#FF4D4D',
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
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FFF',
  },
  secondaryBtnText: {
    color: '#555',
    fontSize: 15,
    fontWeight: '800',
  },
  banner: {
    borderRadius: 12,
    padding: 11,
    marginBottom: 12,
  },
  errorBannerInline: {
    backgroundColor: 'rgba(255,77,77,0.1)',
  },
  successBanner: {
    backgroundColor: '#DCFCE7',
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
    borderTopColor: '#F1F1F1',
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
    borderColor: '#DDD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  checkRowActive: {
    backgroundColor: '#FF4D4D',
    borderColor: '#FF4D4D',
  },
  checkText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '800',
  },
  checkTextActive: {
    color: '#FFF',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallActionBtn: {
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '800',
  },
  deleteIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,77,77,0.1)',
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
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchBtnActive: {
    backgroundColor: '#FF4D4D',
  },
  switchText: {
    color: '#666',
    fontWeight: '800',
    fontSize: 13,
  },
  switchTextActive: {
    color: '#FFF',
  },
  formLabel: {
    color: '#555',
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
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: '#FF4D4D',
  },
  chipText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextActive: {
    color: '#FFF',
  },
  textAreaWrap: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    minHeight: 112,
    marginBottom: 12,
  },
  textArea: {
    color: '#1A1A1A',
    fontSize: 15,
    fontWeight: '600',
    minHeight: 112,
    padding: 14,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F1F1',
  },
  emptyTitle: {
    color: '#1A1A1A',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 10,
  },
  emptyText: {
    color: '#777',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 5,
    textAlign: 'center',
  },
  logoutBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.35)',
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 30,
    marginTop: 2,
  },
  logoutText: {
    color: '#FF4D4D',
    fontSize: 15,
    fontWeight: '800',
  },
});
