/**
 * -----------------------------------------------------------------------------
 *  pages/ProductDetail.jsx — the PDP
 * -----------------------------------------------------------------------------
 *  Weight/pack selector (250g / 500g / 1kg …), gallery, certification &
 *  lab-report documents, combo contents with live availability, origin story
 *  and the "related" rail the API computes. Out-of-stock variants stay visible
 *  with a badge (never a 404) so search traffic still lands somewhere useful.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ShoppingBasket, FileCheck2, FlaskConical, Leaf, ShieldCheck, Package,
  ChevronRight, Truck, BadgeCheck, Sprout,
} from 'lucide-react';
import { clsx } from 'clsx';
import { storefront } from '../lib/api';
import { useCartStore } from '../stores/cartStore';
import { taka } from '../lib/format';
import { Price, StockBadge, Rating, QuantityStepper, Loading, ErrorBanner, SectionHeading } from '../components/ui';
import ProductCard from '../components/ProductCard';
import Countdown from '../components/Countdown';

const DOC_ICONS = {
  bsti: BadgeCheck,
  lab_report: FlaskConical,
  organic_certificate: Sprout,
  halal: ShieldCheck,
  iso: ShieldCheck,
  sourcing_story: Leaf,
};

export default function ProductDetail() {
  const { slug } = useParams();
  const add = useCartStore((s) => s.add);

  const [product, setProduct] = useState(null);
  const [error, setError] = useState(null);
  const [variantId, setVariantId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    setProduct(null);
    setError(null);
    setImageIndex(0);
    setQuantity(1);
    storefront.product(slug)
      .then((data) => {
        if (!alive) return;
        setProduct(data);
        // Default to the marked default variant, else the first in-stock one.
        const active = (data.variants ?? []).filter((v) => v.isActive !== false);
        const preferred = active.find((v) => v.isDefault && v.stock > 0)
          ?? active.find((v) => v.stock > 0)
          ?? active[0];
        setVariantId(preferred?._id ?? null);
      })
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [slug]);

  const variant = useMemo(
    () => product?.variants?.find((v) => v._id === variantId) ?? null,
    [product, variantId],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <ErrorBanner error={error} />
        <Link to="/shop" className="btn-primary mt-4">Back to the shop</Link>
      </div>
    );
  }
  if (!product) return <Loading label="Fetching the product…" />;

  const images = product.imageSrcSet?.length ? product.imageSrcSet : [{ url: product.image, alt: product.title }];
  const current = images[Math.min(imageIndex, images.length - 1)];
  const out = product.stockStatus === 'out_of_stock';
  const variantOut = !variant || variant.stock <= 0;
  const unitPrice = variant ? (variant.salePrice ?? variant.price) : product.priceFrom;
  const maxQty = Math.min(99, variant?.stock ?? 99);

  const addToCart = () => {
    if (variant && !variantOut) add(product, variant, quantity);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      {/* breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-xs text-soil-400">
        <Link to="/" className="hover:text-leaf-700">Home</Link>
        <ChevronRight size={13} aria-hidden />
        <Link to={`/shop?category=${product.categorySlug}`} className="hover:text-leaf-700">{product.categoryName}</Link>
        <ChevronRight size={13} aria-hidden />
        <span className="truncate text-soil-600">{product.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ================= GALLERY ================= */}
        <div>
          <div className="relative overflow-hidden rounded-3xl bg-soil-50">
            <img
              src={current.url}
              srcSet={current.srcset ?? undefined}
              sizes="(min-width: 1024px) 50vw, 100vw"
              alt={current.alt ?? product.title}
              width={current.width ?? 1200}
              height={current.height ?? 1200}
              className={clsx('aspect-square w-full object-cover', out && 'opacity-60 grayscale-[30%]')}
            />
            {product.discountPercent > 0 && (
              <span className="chip absolute left-3 top-3 bg-red-600 text-white">−{product.discountPercent}%</span>
            )}
            {out && (
              <div className="absolute inset-x-0 bottom-0 bg-soil-950/75 py-2 text-center text-sm font-bold uppercase tracking-wider text-white">
                Out of stock — back after the next harvest
              </div>
            )}
          </div>

          {images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {images.map((image, i) => (
                <button
                  key={image.url}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  aria-label={`Image ${i + 1}`}
                  className={clsx(
                    'overflow-hidden rounded-xl border-2 transition-colors',
                    i === imageIndex ? 'border-leaf-600' : 'border-transparent hover:border-soil-200',
                  )}
                >
                  <img src={image.url} alt="" width={64} height={64} loading="lazy" className="h-16 w-16 object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ================= BUY PANEL ================= */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-leaf-600">{product.categoryName}</p>
          <h1 className="mt-1 text-2xl font-extrabold leading-tight text-soil-900 sm:text-3xl">{product.title}</h1>
          {product.titleBn && <p lang="bn" className="mt-1 text-lg text-soil-500">{product.titleBn}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Rating value={product.rating} count={product.reviewCount} />
            <StockBadge status={product.stockStatus} />
            {product.badges?.map((badge) => (
              <span key={badge} className="chip bg-soil-100 text-soil-600 capitalize">{badge.replace(/-/g, ' ')}</span>
            ))}
          </div>

          <p className="mt-4 text-sm leading-relaxed text-soil-600">{product.summary}</p>

          {/* flash sale countdown */}
          {product.isOnFlashSale && product.flashSale?.endsAt && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-honey-50 p-3">
              <span className="text-xs font-bold uppercase tracking-wider text-honey-700">
                {product.flashSale.label ?? 'Flash sale'} ends in
              </span>
              <Countdown secondsRemaining={(new Date(product.flashSale.endsAt).getTime() - Date.now()) / 1000} />
            </div>
          )}

          {/* ---- weight / pack selector ---- */}
          {product.variants?.length > 0 && (
            <fieldset className="mt-5">
              <legend className="field-label">Pack size</legend>
              <div className="flex flex-wrap gap-2">
                {product.variants.filter((v) => v.isActive !== false).map((v) => {
                  const vOut = v.stock <= 0;
                  const price = v.salePrice ?? v.price;
                  return (
                    <button
                      key={v._id}
                      type="button"
                      onClick={() => { setVariantId(v._id); setQuantity(1); }}
                      aria-pressed={v._id === variantId}
                      className={clsx(
                        'relative rounded-xl border px-4 py-2.5 text-left transition-colors',
                        v._id === variantId
                          ? 'border-leaf-600 bg-leaf-50 ring-1 ring-leaf-600'
                          : 'border-soil-200 bg-white hover:border-leaf-400',
                        vOut && 'opacity-50',
                      )}
                    >
                      <span className="block text-sm font-bold text-soil-900">{v.label}</span>
                      <span className="block text-xs text-soil-500">
                        {taka(price)}
                        {v.compareAtPrice > price && <s className="ml-1 text-soil-400">{taka(v.compareAtPrice)}</s>}
                      </span>
                      {vOut && <span className="absolute -right-1.5 -top-1.5 chip bg-red-600 !px-1.5 !py-0.5 text-[9px] text-white">Sold out</span>}
                      {!vOut && v.stock <= (v.lowStockThreshold ?? 10) && (
                        <span className="absolute -right-1.5 -top-1.5 chip bg-honey-500 !px-1.5 !py-0.5 text-[9px] text-white">{v.stock} left</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* ---- price + add ---- */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Price amount={unitPrice * quantity} compareAt={variant?.compareAtPrice ? variant.compareAtPrice * quantity : null} size="lg" />
            <QuantityStepper value={quantity} onChange={setQuantity} max={maxQty} />
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={addToCart}
              disabled={variantOut}
              className="btn-primary flex-1 !py-3.5 text-base"
            >
              <ShoppingBasket size={18} aria-hidden />
              {variantOut ? 'Out of stock' : 'Add to basket'}
            </button>
          </div>

          {/* delivery promise */}
          <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-leaf-50/70 p-3.5 text-xs leading-relaxed text-leaf-900">
            <Truck size={16} className="mt-0.5 shrink-0" aria-hidden />
            <p>
              <strong>৳60 inside Dhaka (1–2 days) · ৳120 nationwide (2–4 days).</strong>{' '}
              Free delivery on orders over ৳2,500. Cash on Delivery, bKash, Nagad and Rocket accepted.
            </p>
          </div>

          {/* ---- combo contents ---- */}
          {product.isCombo && product.bundle?.items?.length > 0 && (
            <div className="mt-5 rounded-2xl border border-soil-100 p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-soil-900">
                <Package size={16} className="text-leaf-600" aria-hidden />
                {product.bundle.headline ?? "What's inside this box"}
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm text-soil-600">
                {product.bundle.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-leaf-500" aria-hidden />
                    {item.quantity > 1 ? `${item.quantity} × ` : ''}{item.label}
                  </li>
                ))}
              </ul>
              {product.bundleAvailability && !product.bundleAvailability.available && (
                <p className="mt-2 text-xs font-medium text-honey-700">
                  Limited availability — a component is running low.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================= DESCRIPTION + DOCUMENTS ================= */}
      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        <article className="lg:col-span-2">
          <SectionHeading eyebrow="The story" title="About this product" />
          <div className="prose-sm max-w-none whitespace-pre-line text-[15px] leading-relaxed text-soil-700">
            {product.description}
          </div>
        </article>

        {product.documents?.length > 0 && (
          <aside>
            <SectionHeading eyebrow="Proof, not promises" title="Certificates & lab reports" />
            <ul className="space-y-2.5">
              {product.documents.map((doc) => {
                const Icon = DOC_ICONS[doc.type] ?? FileCheck2;
                return (
                  <li key={doc.url}>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="card flex items-start gap-3 p-3.5 transition-shadow hover:shadow-pop"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700">
                        <Icon size={17} aria-hidden />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-soil-900">{doc.title}</span>
                        {doc.reference && <span className="block text-xs text-soil-400">Ref: {doc.reference}</span>}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>

      {/* ================= RELATED ================= */}
      {product.related?.length > 0 && (
        <section className="mt-14">
          <SectionHeading eyebrow="Goes well with" title="You may also like" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
            {product.related.map((rel) => (
              <div key={rel._id} className="w-52 shrink-0 sm:w-auto">
                <ProductCard product={rel} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
