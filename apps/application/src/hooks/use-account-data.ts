import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiEnvelope } from "@wings4u/contracts";
import { apiFetch, getApiErrorMessage } from "../lib/api";
import { DEFAULT_LOCATION_ID } from "../lib/env";
import type { ActivePromo, OrderSummary, SupportTicketType } from "../lib/types";
import { useSession, withSilentRefresh } from "../context/session";

export type WalletSummary = {
  customer_user_id: string;
  balance_cents: number;
  lifetime_credit_cents: number;
  updated_at: string;
};

export type WalletLedgerEntry = {
  id: string;
  amount_cents: number;
  balance_after_cents: number;
  entry_type: string;
  reason_text: string;
  order_id?: string | null;
  refund_request_id?: string | null;
  created_at: string;
};

export type WingsRewardsSummary = {
  customer_user_id: string;
  available_stamps: number;
  lifetime_stamps: number;
  lifetime_redemptions: number;
  stamps_per_reward: number;
  updated_at: string;
};

export type WingsStampEntry = {
  id: string;
  entry_type: string;
  delta_stamps: number;
  balance_after_stamps: number;
  pounds_awarded: number | null;
  reason_text: string;
  order_id: string | null;
  order_number: string | null;
  order_fulfillment_type: string | null;
  created_at: string;
};

export type CustomerAddress = {
  id: string;
  label: string | null;
  line1: string;
  city: string;
  postal_code: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type SupportTicketSummary = {
  id: string;
  location_id: string;
  order_id: string | null;
  customer_user_id: string | null;
  ticket_type: string;
  status: string;
  priority: string;
  subject: string;
  created_at: string;
  updated_at: string;
  latest_public_message: {
    message_body: string;
    author_user_id: string;
    created_at: string;
  } | null;
};

export type AddressInput = {
  label?: string;
  line1: string;
  city: string;
  postal_code: string;
  is_default?: boolean;
};

export type TicketInput = {
  ticket_type: SupportTicketType;
  subject: string;
  description: string;
  order_id?: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
};

export type AccountData = {
  wallet: WalletSummary | null;
  walletLedger: WalletLedgerEntry[];
  wingsRewards: WingsRewardsSummary | null;
  wingsLedger: WingsStampEntry[];
  promos: ActivePromo[];
  orders: OrderSummary[];
  ordersNextCursor: string | null;
  addresses: CustomerAddress[];
  tickets: SupportTicketSummary[];
  ticketsNextCursor: string | null;
};

type OrdersPage = {
  orders: OrderSummary[];
  next_cursor: string | null;
};

type WalletLedgerPage = {
  entries: WalletLedgerEntry[];
  next_cursor: string | null;
};

type WingsLedgerPage = {
  entries: WingsStampEntry[];
  next_cursor: string | null;
};

type AddressesPage = {
  items: CustomerAddress[];
};

type TicketsPage = {
  tickets: SupportTicketSummary[];
  next_cursor: string | null;
};

const EMPTY_ACCOUNT_DATA: AccountData = {
  wallet: null,
  walletLedger: [],
  wingsRewards: null,
  wingsLedger: [],
  promos: [],
  orders: [],
  ordersNextCursor: null,
  addresses: [],
  tickets: [],
  ticketsNextCursor: null,
};

function normalizePostalCode(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fulfilled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function useAccountDataState() {
  const session = useSession();
  const userKey = session.authenticated ? session.user?.id ?? 'customer' : null;
  const generation = useRef(0);
  const inFlight = useRef<{ userKey: string | null; promise: Promise<void> } | null>(null);
  const pageBusy = useRef(false);
  const [data, setData] = useState<AccountData>(EMPTY_ACCOUNT_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<'orders' | 'rewards' | 'promos' | 'wallet', string>>>({});
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit & { locationId?: string }) =>
      withSilentRefresh(
        () => apiFetch(path, init),
        session.refresh,
        session.clear,
      ),
    [session.refresh, session.clear],
  );

  const authedJson = useCallback(
    async <T,>(path: string, init?: RequestInit & { locationId?: string }): Promise<T> => {
      const res = await authedFetch(path, init);
      const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
      if (!res.ok || !body || body.data == null) {
        throw new Error(getApiErrorMessage(body, res.statusText || "Request failed"));
      }
      return body.data as T;
    },
    [authedFetch],
  );

  const performLoad = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      const request = ++generation.current;
      if (!session.loaded) return;
      if (!session.authenticated) {
        setData(EMPTY_ACCOUNT_DATA);
        setLoading(false);
        setRefreshing(false);
        setError(null);
        setSectionErrors({});
        return;
      }

      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      const results = await Promise.allSettled([
        authedJson<WalletSummary>("/api/v1/wallets/me"),
        authedJson<WalletLedgerPage>("/api/v1/wallets/me/ledger?limit=6"),
        authedJson<WingsRewardsSummary>("/api/v1/rewards/me"),
        authedJson<WingsLedgerPage>("/api/v1/rewards/me/ledger?limit=20"),
        authedJson<ActivePromo[]>("/api/v1/promotions/active", {
          locationId: DEFAULT_LOCATION_ID,
        }),
        authedJson<OrdersPage>("/api/v1/orders/customer?limit=20", {
          locationId: DEFAULT_LOCATION_ID,
        }),
        authedJson<AddressesPage>("/api/v1/customer/addresses"),
        authedJson<TicketsPage>("/api/v1/support/tickets?limit=20", {
          locationId: DEFAULT_LOCATION_ID,
        }),
      ]);

      // A response from a previous customer must never repopulate shared state.
      if (request !== generation.current) return;

      const [
        walletResult,
        walletLedgerResult,
        rewardsResult,
        wingsLedgerResult,
        promosResult,
        ordersResult,
        addressesResult,
        ticketsResult,
      ] = results;

      const walletLedger = fulfilled<WalletLedgerPage>(walletLedgerResult, {
        entries: [],
        next_cursor: null,
      });
      const wingsLedger = fulfilled<WingsLedgerPage>(wingsLedgerResult, {
        entries: [],
        next_cursor: null,
      });
      const orders = fulfilled<OrdersPage>(ordersResult, {
        orders: [],
        next_cursor: null,
      });
      const addresses = fulfilled<AddressesPage>(addressesResult, { items: [] });
      const tickets = fulfilled<TicketsPage>(ticketsResult, {
        tickets: [],
        next_cursor: null,
      });

      setData({
        wallet: fulfilled<WalletSummary | null>(walletResult, null),
        walletLedger: walletLedger.entries,
        wingsRewards: fulfilled<WingsRewardsSummary | null>(rewardsResult, null),
        wingsLedger: wingsLedger.entries,
        promos: fulfilled<ActivePromo[]>(promosResult, []),
        orders: orders.orders,
        ordersNextCursor: orders.next_cursor,
        addresses: addresses.items,
        tickets: tickets.tickets,
        ticketsNextCursor: tickets.next_cursor,
      });

      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => errorMessage(result.reason));
      setError(failures.length > 0 ? failures[0] : null);
      const errors: typeof sectionErrors = {};
      if (ordersResult.status === 'rejected') errors.orders = errorMessage(ordersResult.reason);
      if (rewardsResult.status === 'rejected') errors.rewards = errorMessage(rewardsResult.reason);
      if (wingsLedgerResult.status === 'rejected') errors.rewards ??= errorMessage(wingsLedgerResult.reason);
      if (promosResult.status === 'rejected') errors.promos = errorMessage(promosResult.reason);
      if (walletResult.status === 'rejected') errors.wallet = errorMessage(walletResult.reason);
      setSectionErrors(errors);
      setLoading(false);
      setRefreshing(false);
    },
    [authedJson, session.loaded, session.authenticated, userKey],
  );

  const load = useCallback((mode: 'initial' | 'refresh' = 'refresh') => {
    if (inFlight.current?.userKey === userKey) return inFlight.current.promise;
    const promise = performLoad(mode).finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null;
    });
    inFlight.current = { userKey, promise };
    return promise;
  }, [performLoad, userKey]);

  useEffect(() => {
    setData(EMPTY_ACCOUNT_DATA);
    setLoading(true);
    setLoadingMoreOrders(false);
    pageBusy.current = false;
    inFlight.current = null;
    void load("initial");
    return () => { generation.current++; };
  }, [load]);

  const loadMoreOrders = useCallback(async () => {
    const cursor = data.ordersNextCursor;
    if (!session.authenticated || !cursor || loading || refreshing || pageBusy.current) return;
    const request = generation.current;
    pageBusy.current = true;
    setLoadingMoreOrders(true);
    try {
      const page = await authedJson<OrdersPage>(`/api/v1/orders/customer?limit=20&cursor=${encodeURIComponent(cursor)}`, {
        locationId: DEFAULT_LOCATION_ID,
      });
      if (request !== generation.current) return;
      setData(previous => ({ ...previous,
        orders: [...new Map([...previous.orders, ...page.orders].map(order => [order.id, order])).values()],
        ordersNextCursor: page.next_cursor,
      }));
      setSectionErrors(previous => ({ ...previous, orders: undefined }));
    } catch (error) {
      if (request === generation.current) setSectionErrors(previous => ({ ...previous, orders: errorMessage(error) }));
    } finally {
      pageBusy.current = false;
      setLoadingMoreOrders(false);
    }
  }, [authedJson, data.ordersNextCursor, session.authenticated, loading, refreshing]);

  const saveAddress = useCallback(
    async (input: AddressInput, id?: string) => {
      const payload = {
        label: input.label?.trim() || null,
        line1: input.line1.trim(),
        city: input.city.trim(),
        postal_code: normalizePostalCode(input.postal_code),
        is_default: input.is_default === true,
      };

      await authedJson<CustomerAddress>(
        id ? `/api/v1/customer/addresses/${id}` : "/api/v1/customer/addresses",
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      await load("refresh");
    },
    [authedJson, load],
  );

  const deleteAddress = useCallback(
    async (id: string) => {
      await authedJson<{ deleted: true }>(`/api/v1/customer/addresses/${id}`, {
        method: "DELETE",
      });
      await load("refresh");
    },
    [authedJson, load],
  );

  const createTicket = useCallback(
    async (input: TicketInput) => {
      await authedJson<SupportTicketSummary>("/api/v1/support/tickets", {
        method: "POST",
        locationId: DEFAULT_LOCATION_ID,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_type: input.ticket_type,
          subject: input.subject.trim(),
          description: input.description.trim(),
          order_id: input.order_id,
          priority: input.priority ?? "NORMAL",
        }),
      });
      await load("refresh");
    },
    [authedJson, load],
  );

  return {
    data: session.authenticated ? data : EMPTY_ACCOUNT_DATA,
    loading,
    refreshing,
    error,
    sectionErrors,
    loadingMoreOrders,
    loadMoreOrders,
    refresh: load,
    saveAddress,
    deleteAddress,
    createTicket,
  };
}

const AccountDataContext = createContext<ReturnType<typeof useAccountDataState> | null>(null);

/** Profile, Deals and Orders consume a single authenticated account store. */
export function AccountDataProvider({ children }: { children: ReactNode }) {
  const value = useAccountDataState();
  return createElement(AccountDataContext.Provider, { value }, children);
}

export function useAccountData() {
  const account = useContext(AccountDataContext);
  if (!account) throw new Error('useAccountData must be used within AccountDataProvider');
  return account;
}
