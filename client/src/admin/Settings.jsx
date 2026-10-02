/**
 * -----------------------------------------------------------------------------
 *  admin/Settings.jsx — storefront settings + flash sale + system info
 * -----------------------------------------------------------------------------
 *  PATCHes the storefront singleton; changes are live on the shop immediately
 *  (verified by the API smoke suite). System facts (driver, indexes, image
 *  provider) render read-only for the super_admin.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from 'react';
import { Save, Loader2, Megaphone, Flame, Phone, ServerCog } from 'lucide-react';
import { admin } from '../lib/api';
import { useAdminStore } from '../stores/adminStore';
import { Loading, ErrorBanner } from '../components/ui';
import { PageHeader, useToast } from './shared';

export default function Settings() {
  const can = useAdminStore((s) => s.can);
  const { toast, ToastHost } = useToast();

  const [settings, setSettings] = useState(null);
  const [system, setSystem] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(null);

  useEffect(() => {
    let alive = true;
    admin.settings()
      .then((data) => {
        if (!alive) return;
        setSettings(data.settings);
        setForm({
          storeName: data.settings.storeName ?? '',
          tagline: data.settings.tagline ?? '',
          announcementText: data.settings.announcement?.text ?? '',
          announcementActive: Boolean(data.settings.announcement?.isActive),
          phone: data.settings.contact?.phone ?? '',
          whatsapp: data.settings.contact?.whatsapp ?? '',
          hotline: data.settings.contact?.hotline ?? '',
          email: data.settings.contact?.email ?? '',
          address: data.settings.contact?.address ?? '',
          hours: data.settings.contact?.hours ?? '',
          flashActive: Boolean(data.settings.flashSale?.isActive),
          flashTitle: data.settings.flashSale?.title ?? '',
          flashSubtitle: data.settings.flashSale?.subtitle ?? '',
          flashEndsAt: data.settings.flashSale?.endsAt ? data.settings.flashSale.endsAt.slice(0, 16) : '',
          flashCoupon: data.settings.flashSale?.couponCode ?? '',
          flashValue: data.settings.flashSale?.couponValue ?? 0,
        });
      })
      .catch((err) => alive && setError(err));

    if (can('*')) {
      admin.system().then((data) => alive && setSystem(data)).catch(() => {});
    }
    return () => { alive = false; };
  }, [can]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { message } = await admin.updateSettings({
        storeName: form.storeName,
        tagline: form.tagline,
        announcement: { text: form.announcementText, isActive: form.announcementActive },
        contact: {
          ...settings.contact,
          phone: form.phone, whatsapp: form.whatsapp, hotline: form.hotline,
          email: form.email, address: form.address, hours: form.hours,
        },
        flashSale: {
          ...settings.flashSale,
          isActive: form.flashActive,
          title: form.flashTitle,
          subtitle: form.flashSubtitle,
          endsAt: form.flashEndsAt ? new Date(form.flashEndsAt).toISOString() : settings.flashSale?.endsAt,
          couponCode: form.flashCoupon,
          couponValue: Number(form.flashValue) || 0,
        },
      });
      toast(message);
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const indexSummary = useMemo(() => {
    if (!system?.indexes) return null;
    const byCollection = {};
    for (const index of system.indexes) {
      byCollection[index.model] = (byCollection[index.model] ?? 0) + 1;
    }
    return byCollection;
  }, [system]);

  if (error && !form) return <div className="p-6"><ErrorBanner error={error} /></div>;
  if (!form) return <Loading label="Loading settings…" />;

  return (
    <form onSubmit={save}>
      <ToastHost />
      <PageHeader
        title="Settings"
        description="Changes go live on the storefront immediately"
        actions={
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />} Save changes
          </button>
        }
      />

      <div className="grid gap-6 px-4 pb-8 sm:px-6 lg:grid-cols-2">
        <ErrorBanner error={error} className="lg:col-span-2" />

        {/* ---- identity ---- */}
        <section className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-soil-900">
            <Megaphone size={15} className="text-leaf-600" aria-hidden /> Store identity
          </h2>
          <div>
            <label className="field-label" htmlFor="st-name">Store name</label>
            <input id="st-name" className="field" value={form.storeName} onChange={set('storeName')} />
          </div>
          <div>
            <label className="field-label" htmlFor="st-tagline">Tagline</label>
            <input id="st-tagline" className="field" value={form.tagline} onChange={set('tagline')} />
          </div>
          <div>
            <label className="field-label" htmlFor="st-announce">Announcement bar</label>
            <input id="st-announce" className="field" value={form.announcementText} onChange={set('announcementText')} placeholder="Free delivery over ৳2,500 …" />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-soil-700">
              <input type="checkbox" checked={form.announcementActive} onChange={set('announcementActive')} className="h-4 w-4 rounded border-soil-300 text-leaf-600 focus:ring-leaf-500" />
              Show on the storefront
            </label>
          </div>
        </section>

        {/* ---- contact ---- */}
        <section className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-soil-900">
            <Phone size={15} className="text-leaf-600" aria-hidden /> Contact & support
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="field-label">Phone</label><input className="field" value={form.phone} onChange={set('phone')} /></div>
            <div><label className="field-label">WhatsApp</label><input className="field" value={form.whatsapp} onChange={set('whatsapp')} /></div>
            <div><label className="field-label">Hotline</label><input className="field" value={form.hotline} onChange={set('hotline')} /></div>
            <div><label className="field-label">Email</label><input type="email" className="field" value={form.email} onChange={set('email')} /></div>
          </div>
          <div><label className="field-label">Address</label><input className="field" value={form.address} onChange={set('address')} /></div>
          <div><label className="field-label">Opening hours</label><input className="field" value={form.hours} onChange={set('hours')} /></div>
        </section>

        {/* ---- flash sale ---- */}
        <section className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-soil-900">
            <Flame size={15} className="text-honey-600" aria-hidden /> Flash sale campaign
          </h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-soil-700">
            <input type="checkbox" checked={form.flashActive} onChange={set('flashActive')} className="h-4 w-4 rounded border-soil-300 text-leaf-600 focus:ring-leaf-500" />
            Campaign is live (countdown shows on the home page)
          </label>
          <div><label className="field-label">Title</label><input className="field" value={form.flashTitle} onChange={set('flashTitle')} /></div>
          <div><label className="field-label">Subtitle</label><input className="field" value={form.flashSubtitle} onChange={set('flashSubtitle')} /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="field-label">Ends at</label>
              <input type="datetime-local" className="field" value={form.flashEndsAt} onChange={set('flashEndsAt')} />
            </div>
            <div><label className="field-label">Coupon code</label><input className="field font-mono uppercase" value={form.flashCoupon} onChange={set('flashCoupon')} /></div>
            <div><label className="field-label">Coupon value ৳</label><input type="number" min="0" className="field" value={form.flashValue} onChange={set('flashValue')} /></div>
          </div>
        </section>

        {/* ---- system (super_admin) ---- */}
        {system && (
          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-soil-900">
              <ServerCog size={15} className="text-soil-500" aria-hidden /> System
            </h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-soil-500">Environment</dt><dd className="font-mono text-xs">{system.environment} · {system.node}</dd></div>
              <div className="flex justify-between"><dt className="text-soil-500">Database driver</dt><dd className="font-mono text-xs">{system.database?.driver} ({system.database?.state})</dd></div>
              <div className="flex justify-between"><dt className="text-soil-500">Image provider</dt><dd className="font-mono text-xs">{system.images?.provider}{system.images?.cloudinaryConfigured ? ' (Cloudinary)' : ''}</dd></div>
              <div className="flex justify-between"><dt className="text-soil-500">Pagination</dt><dd className="font-mono text-xs">default {system.limits?.defaultPageSize} / max {system.limits?.maxPageSize}</dd></div>
              <div className="flex justify-between"><dt className="text-soil-500">Declared indexes</dt><dd className="font-mono text-xs">{system.indexes?.length}</dd></div>
            </dl>
            {indexSummary && (
              <p className="text-xs text-soil-400">
                {Object.entries(indexSummary).map(([model, count]) => `${model}: ${count}`).join(' · ')}
              </p>
            )}
          </section>
        )}
      </div>
    </form>
  );
}
