/**
 * -----------------------------------------------------------------------------
 *  admin/ProductForm.jsx — create / edit a product
 * -----------------------------------------------------------------------------
 *  Covers the fields the storefront actually renders: bilingual titles,
 *  category, summary/description, image URL(s), badges/tags, variants with
 *  weight-unit pack sizes (250g / 500g / 1kg …) and pricing, plus status and
 *  feature flags. Server-side Zod remains the source of truth — field errors
 *  from a 422 are mapped straight onto the inputs.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, Loader2, Star } from 'lucide-react';
import { clsx } from 'clsx';
import { admin } from '../lib/api';
import { Loading, ErrorBanner } from '../components/ui';
import { PageHeader, useToast } from './shared';

const WEIGHT_UNITS = ['g', 'kg', 'ml', 'l', 'pc', 'pack'];

const EMPTY_VARIANT = { label: '', weightValue: '', weightUnit: 'g', price: '', compareAtPrice: '', stock: 0, isDefault: false };

const EMPTY = {
  title: '', titleBn: '', category: '', summary: '', description: '',
  image: '', imageAlt: '',
  tags: '', badges: '',
  status: 'active', isFeatured: false, isCombo: false,
  variants: [{ ...EMPTY_VARIANT, isDefault: true }],
};

export default function ProductForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { toast, ToastHost } = useToast();

  const [form, setForm] = useState(EMPTY);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fieldErrors = useMemo(() => {
    const map = {};
    for (const e of error?.errors ?? []) map[e.path] = e.message;
    return map;
  }, [error]);

  useEffect(() => {
    admin.categories().then(({ items }) => setCategories(items)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    admin.product(id)
      .then((product) => {
        if (!alive) return;
        setForm({
          title: product.title ?? '',
          titleBn: product.titleBn ?? '',
          category: product.category?._id ?? product.category ?? '',
          summary: product.summary ?? '',
          description: product.description ?? '',
          image: product.images?.[0]?.url ?? product.image ?? '',
          imageAlt: product.images?.[0]?.alt ?? '',
          tags: (product.tags ?? []).join(', '),
          badges: (product.badges ?? []).join(', '),
          status: product.status ?? 'active',
          isFeatured: Boolean(product.isFeatured),
          isCombo: Boolean(product.isCombo),
          variants: (product.variants ?? []).map((v) => ({
            _id: v._id,
            label: v.label ?? '',
            weightValue: v.weightValue ?? '',
            weightUnit: v.weightUnit ?? 'g',
            price: v.price ?? '',
            compareAtPrice: v.compareAtPrice ?? '',
            stock: v.stock ?? 0,
            isDefault: Boolean(v.isDefault),
          })),
        });
      })
      .catch((err) => alive && setError(err))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id, isEdit]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  /* ---- variants ---- */
  const setVariant = (index, key, value) =>
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, i) => (i === index ? { ...v, [key]: value } : v)),
    }));

  const setDefaultVariant = (index) =>
    setForm((f) => ({ ...f, variants: f.variants.map((v, i) => ({ ...v, isDefault: i === index })) }));

  const addVariant = () => setForm((f) => ({ ...f, variants: [...f.variants, { ...EMPTY_VARIANT }] }));

  const removeVariant = (index) =>
    setForm((f) => {
      const variants = f.variants.filter((_, i) => i !== index);
      // Keep exactly one default.
      if (variants.length && !variants.some((v) => v.isDefault)) variants[0] = { ...variants[0], isDefault: true };
      return { ...f, variants };
    });

  /* ---- submit ---- */
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const csv = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      title: form.title,
      titleBn: form.titleBn || undefined,
      category: form.category,
      summary: form.summary || undefined,
      description: form.description || undefined,
      images: form.image ? [{ url: form.image, alt: form.imageAlt || form.title, isPrimary: true, format: 'webp' }] : undefined,
      tags: csv(form.tags),
      badges: csv(form.badges),
      status: form.status,
      isFeatured: form.isFeatured,
      variants: form.variants.map((v) => ({
        ...(v._id ? { _id: v._id } : {}),
        label: v.label || `${v.weightValue} ${v.weightUnit}`,
        weightValue: Number(v.weightValue),
        weightUnit: v.weightUnit,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
        stock: Number(v.stock) || 0,
        isDefault: Boolean(v.isDefault),
      })),
    };

    try {
      if (isEdit) {
        const { message } = await admin.updateProduct(id, payload);
        toast(message);
      } else {
        const { data, message } = await admin.createProduct(payload);
        toast(message);
        navigate(`/admin/products/${data._id}`, { replace: true });
      }
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading the product…" />;

  return (
    <form onSubmit={submit}>
      <ToastHost />
      <PageHeader
        title={isEdit ? `Edit: ${form.title || '…'}` : 'New product'}
        actions={
          <>
            <Link to="/admin/products" className="btn-ghost"><ArrowLeft size={15} aria-hidden /> Back</Link>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />} Save
            </button>
          </>
        }
      />

      <div className="grid gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <ErrorBanner error={error} />

          {/* ---- basics ---- */}
          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-soil-900">Basics</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="pf-title">Title (English) *</label>
                <input id="pf-title" required className="field" value={form.title} onChange={set('title')} placeholder="Sundarban Raw Honey" />
                {fieldErrors.title && <p className="field-error">{fieldErrors.title}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="pf-titlebn">Title (Bangla)</label>
                <input id="pf-titlebn" lang="bn" className="field font-bangla" value={form.titleBn} onChange={set('titleBn')} placeholder="সুন্দরবনের কাঁচা মধু" />
              </div>
              <div>
                <label className="field-label" htmlFor="pf-category">Category *</label>
                <select id="pf-category" required className="field" value={form.category} onChange={set('category')}>
                  <option value="">Choose…</option>
                  {categories.map((c) => <option key={c._id} value={c._id}>{c.name?.en}</option>)}
                </select>
                {fieldErrors.category && <p className="field-error">{fieldErrors.category}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="pf-summary">Card summary</label>
                <input id="pf-summary" className="field" value={form.summary} onChange={set('summary')} maxLength={240} placeholder="One sentence shown on the product card" />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="pf-desc">Full description</label>
                <textarea id="pf-desc" rows={6} className="field" value={form.description} onChange={set('description')} placeholder="Origin story, tasting notes, how it's tested…" />
              </div>
            </div>
          </section>

          {/* ---- variants ---- */}
          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-soil-900">Pack sizes & pricing</h2>
              <button type="button" className="btn-outline !px-3 !py-1.5 text-xs" onClick={addVariant}>
                <Plus size={13} aria-hidden /> Add pack size
              </button>
            </div>
            {fieldErrors.variants && <p className="field-error">{fieldErrors.variants}</p>}

            <div className="space-y-3">
              {form.variants.map((variant, index) => (
                <div key={variant._id ?? index} className="grid grid-cols-2 gap-2.5 rounded-xl border border-soil-100 p-3 sm:grid-cols-7">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="field-label">Label</label>
                    <input className="field !px-2.5 !py-2 text-sm" value={variant.label} onChange={(e) => setVariant(index, 'label', e.target.value)} placeholder="500 g" />
                  </div>
                  <div>
                    <label className="field-label">Weight</label>
                    <input type="number" min="0" step="any" required className="field !px-2.5 !py-2 text-sm" value={variant.weightValue} onChange={(e) => setVariant(index, 'weightValue', e.target.value)} placeholder="500" />
                  </div>
                  <div>
                    <label className="field-label">Unit</label>
                    <select className="field !px-2 !py-2 text-sm" value={variant.weightUnit} onChange={(e) => setVariant(index, 'weightUnit', e.target.value)}>
                      {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Price ৳ *</label>
                    <input type="number" min="1" required className="field !px-2.5 !py-2 text-sm" value={variant.price} onChange={(e) => setVariant(index, 'price', e.target.value)} placeholder="750" />
                  </div>
                  <div>
                    <label className="field-label">Was ৳</label>
                    <input type="number" min="0" className="field !px-2.5 !py-2 text-sm" value={variant.compareAtPrice} onChange={(e) => setVariant(index, 'compareAtPrice', e.target.value)} placeholder="—" />
                  </div>
                  <div>
                    <label className="field-label">Stock</label>
                    <input type="number" min="0" className="field !px-2.5 !py-2 text-sm" value={variant.stock} onChange={(e) => setVariant(index, 'stock', e.target.value)} />
                  </div>
                  <div className="col-span-2 flex items-end justify-between gap-1 sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => setDefaultVariant(index)}
                      title="Default pack"
                      aria-pressed={variant.isDefault}
                      className={clsx('btn-ghost !p-2', variant.isDefault ? '!text-honey-500' : '!text-soil-300')}
                    >
                      <Star size={16} className={variant.isDefault ? 'fill-current' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeVariant(index)}
                      disabled={form.variants.length === 1}
                      aria-label="Remove pack size"
                      className="btn-ghost !p-2 hover:!text-red-600 disabled:opacity-30"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-soil-400">
              SKUs and slugs are generated server-side; the ★ marks the pack pre-selected on the product page.
            </p>
          </section>
        </div>

        {/* ---- sidebar ---- */}
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-soil-900">Visibility</h2>
            <div>
              <label className="field-label" htmlFor="pf-status">Status</label>
              <select id="pf-status" className="field" value={form.status} onChange={set('status')}>
                <option value="active">Active — visible in the shop</option>
                <option value="draft">Draft — hidden</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-soil-700">
              <input type="checkbox" checked={form.isFeatured} onChange={set('isFeatured')} className="h-4 w-4 rounded border-soil-300 text-leaf-600 focus:ring-leaf-500" />
              Featured on the home page
            </label>
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-soil-900">Image</h2>
            <div>
              <label className="field-label" htmlFor="pf-image">Image URL (WebP)</label>
              <input id="pf-image" className="field font-mono text-xs" value={form.image} onChange={set('image')} placeholder="/img/products/honey-sundarban.webp" />
              <p className="mt-1 text-[11px] text-soil-400">CDN or /img/products path. Uploads: POST /api/admin/uploads/image transcodes to WebP.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="pf-alt">Alt text</label>
              <input id="pf-alt" className="field" value={form.imageAlt} onChange={set('imageAlt')} placeholder="Jar of raw honey" />
            </div>
            {form.image && (
              <img src={form.image} alt="" className="aspect-square w-full rounded-xl object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            )}
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-soil-900">Merchandising</h2>
            <div>
              <label className="field-label" htmlFor="pf-tags">Tags (comma-separated)</label>
              <input id="pf-tags" className="field" value={form.tags} onChange={set('tags')} placeholder="honey, raw, sundarban" />
            </div>
            <div>
              <label className="field-label" htmlFor="pf-badges">Badges (comma-separated)</label>
              <input id="pf-badges" className="field" value={form.badges} onChange={set('badges')} placeholder="bestseller, lab-tested" />
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
