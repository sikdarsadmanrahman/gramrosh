/**
 * -----------------------------------------------------------------------------
 *  stores/configStore.js — commerce constants + storefront identity (Zustand)
 * -----------------------------------------------------------------------------
 *  `/api/config` is fetched once on boot and cached here: shipping fees, the
 *  free-delivery threshold, payment method definitions (with merchant numbers
 *  and hints), the district list for the checkout selector and the store's
 *  contact block for the footer / WhatsApp widget.
 *
 *  Components never hard-code ৳60/৳120 or the bKash number — if ops changes a
 *  merchant wallet in the admin settings screen, the storefront follows on the
 *  next load with zero deploys.
 * -----------------------------------------------------------------------------
 */
import { create } from 'zustand';
import { storefront } from '../lib/api';

export const useConfigStore = create((set, get) => ({
  config: null,
  status: 'idle', // idle | loading | ready | error

  /** Fetch once; concurrent callers share the same in-flight request. */
  async load() {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    try {
      const config = await storefront.config();
      set({ config, status: 'ready' });
    } catch {
      // The storefront still works with fallbacks; retry on next mount.
      set({ status: 'error' });
    }
  },
}));

/* ---- selector helpers (fallbacks keep the UI sane before /config lands) --- */

export const useStoreIdentity = () =>
  useConfigStore((s) => s.config?.store) ?? {
    name: 'Gramrosh',
    tagline: 'Fresh & organic, straight from the village',
    announcement: { text: '', isActive: false },
    contact: {},
  };

export const useSupport = () => useConfigStore((s) => s.config?.support) ?? {};

export const useShippingMethods = () => useConfigStore((s) => s.config?.shippingMethods) ?? [
  { id: 'inside_dhaka', label: 'Inside Dhaka', fee: 60, etaDays: [1, 2] },
  { id: 'outside_dhaka', label: 'Outside Dhaka', fee: 120, etaDays: [2, 4] },
];

export const usePaymentMethods = () => useConfigStore((s) => s.config?.paymentMethods) ?? [];

export const useDistricts = () => useConfigStore((s) => s.config?.districts) ?? [];

export const useDhakaDistricts = () => useConfigStore((s) => s.config?.dhakaDistricts) ?? ['Dhaka'];

export const useFreeShippingThreshold = () => useConfigStore((s) => s.config?.freeShippingThreshold) ?? 2500;
