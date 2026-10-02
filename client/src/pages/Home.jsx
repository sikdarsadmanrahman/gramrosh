/**
 * -----------------------------------------------------------------------------
 *  pages/Home.jsx — the landing page, fed by ONE API round trip
 * -----------------------------------------------------------------------------
 *  `/api/storefront/home` returns hero slides, trust points, categories, the
 *  live flash-sale campaign (with a server-anchored countdown), four product
 *  rails and testimonials in a single payload — so the page has exactly one
 *  loading state and paints together.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, FlaskConical, Leaf, MapPin, Truck, ShieldCheck, BadgeCheck,
  Flame, Star, Quote, Copy, Check,
} from 'lucide-react';
import { storefront } from '../lib/api';
import { taka } from '../lib/format';
import Countdown from '../components/Countdown';
import ProductCard from '../components/ProductCard';
import { SectionHeading, Loading, ErrorBanner } from '../components/ui';

/** The seed data references lucide icons by kebab name. */
const TRUST_ICONS = {
  'flask-conical': FlaskConical,
  leaf: Leaf,
  'map-pin': MapPin,
  truck: Truck,
  'shield-check': ShieldCheck,
  'badge-check': BadgeCheck,
};

export default function Home() {
  const [home, setHome] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    storefront.home()
      .then((data) => alive && setHome(data))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, []);

  if (error) return <div className="mx-auto max-w-6xl px-4 py-10"><ErrorBanner error={error} /></div>;
  if (!home) return <Loading label="Setting up the market…" />;

  const hero = home.hero?.[0];
  const flash = home.flashSale;

  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* ================= HERO ================= */}
      {hero && (
        <section className="relative mt-4 overflow-hidden rounded-3xl bg-soil-950 text-white">
          <img
            src={hero.image?.url}
            alt={hero.image?.alt ?? ''}
            width={hero.image?.width ?? 1600}
            height={hero.image?.height ?? 1000}
            fetchpriority="high"
            className="absolute inset-0 h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-soil-950/80 via-soil-950/40 to-transparent" />
          <div className="relative flex min-h-[340px] flex-col justify-center gap-3 p-6 sm:min-h-[420px] sm:max-w-xl sm:p-12">
            {hero.eyebrow && (
              <p className="text-xs font-bold uppercase tracking-widest text-honey-300">{hero.eyebrow}</p>
            )}
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{hero.title}</h1>
            {hero.titleBn && <p lang="bn" className="text-lg text-white/80">{hero.titleBn}</p>}
            <p className="text-sm leading-relaxed text-white/75 sm:text-base">{hero.subtitle}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link to={hero.ctaHref ?? '/shop'} className="btn-honey !px-6 !py-3">
                {hero.ctaLabel ?? 'Shop now'} <ArrowRight size={16} aria-hidden />
              </Link>
              <Link to="/shop" className="btn !border !border-white/30 !text-white hover:!bg-white/10 !px-6 !py-3">
                Browse everything
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ================= TRUST POINTS ================= */}
      {home.trustPoints?.length > 0 && (
        <section aria-label="Why shop with us" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {home.trustPoints.map((point) => {
            const Icon = TRUST_ICONS[point.icon] ?? ShieldCheck;
            return (
              <div key={point.title} className="card flex gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700">
                  <Icon size={20} aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-soil-900">{point.title}</h3>
                  <p className="mt-0.5 hidden text-xs leading-relaxed text-soil-500 sm:block">{point.description}</p>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ================= CATEGORIES ================= */}
      <section className="mt-12">
        <SectionHeading eyebrow="Shop by" title="Categories" />
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0 lg:grid-cols-8">
          {home.categories?.map((category) => (
            <Link
              key={category.slug}
              to={`/shop?category=${category.slug}`}
              className="card flex min-w-[110px] flex-col items-center gap-1.5 px-3 py-4 text-center transition-shadow hover:shadow-pop"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white"
                style={{ backgroundColor: category.accent ?? '#3d9142' }}
                aria-hidden
              >
                {category.name?.en?.[0] ?? '?'}
              </span>
              <span className="text-xs font-semibold text-soil-800">{category.name?.en}</span>
              {category.name?.bn && <span lang="bn" className="text-[11px] text-soil-400">{category.name.bn}</span>}
              <span className="text-[10px] text-soil-400">{category.liveProductCount ?? category.productCount} items</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ================= FLASH SALE ================= */}
      {flash?.isActive && flash.products?.length > 0 && (
        <FlashSale flash={flash} />
      )}

      {/* ================= RAILS ================= */}
      <Rail title="Featured picks" eyebrow="Hand-picked" products={home.rails?.featured} link="/shop" />
      <Rail title="Combos & gift boxes" eyebrow="Bundle & save" products={home.rails?.combos} link="/shop?category=combos" />
      <Rail title="Best sellers" eyebrow="Most reordered" products={home.rails?.bestSellers} link="/shop?sort=best_selling" />
      <Rail title="New arrivals" eyebrow="Just in" products={home.rails?.newArrivals} link="/shop?sort=newest" />

      {/* ================= TESTIMONIALS ================= */}
      {home.testimonials?.length > 0 && (
        <section className="mt-14">
          <SectionHeading eyebrow="From our customers" title="Why families reorder" />
          <div className="grid gap-4 sm:grid-cols-2">
            {home.testimonials.map((t) => (
              <figure key={t._id ?? t.name} className="card relative p-5">
                <Quote size={28} className="absolute right-4 top-4 text-leaf-100" aria-hidden />
                <div className="flex items-center gap-1 text-honey-400" aria-label={`${t.rating} out of 5 stars`}>
                  {Array.from({ length: t.rating ?? 5 }).map((_, i) => (
                    <Star key={i} size={14} className="fill-current" aria-hidden />
                  ))}
                </div>
                <blockquote className="mt-3 text-sm leading-relaxed text-soil-700">“{t.quote}”</blockquote>
                <figcaption className="mt-3 text-xs font-semibold text-soil-500">
                  {t.name} · <span className="font-normal">{t.location}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Flash-sale band: countdown + coupon + the campaign's products. */
function FlashSale({ flash }) {
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);

  const copyCoupon = async () => {
    try {
      await navigator.clipboard.writeText(flash.couponCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied — the code is still visible */ }
  };

  if (expired) return null;

  return (
    <section className="mt-12 overflow-hidden rounded-3xl bg-gradient-to-br from-honey-500 to-honey-700 p-5 text-white sm:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-honey-100">
            <Flame size={14} aria-hidden /> Flash sale
          </p>
          <h2 className="mt-1 text-2xl font-extrabold">{flash.title}</h2>
          <p className="mt-1 text-sm text-honey-50/90">{flash.subtitle}</p>
          {flash.couponCode && (
            <button
              type="button"
              onClick={copyCoupon}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-white/50 bg-white/10 px-4 py-2 font-mono text-sm font-bold tracking-wider hover:bg-white/20"
              aria-label={`Copy coupon code ${flash.couponCode}`}
            >
              {flash.couponCode}
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              <span className="font-sans text-xs font-medium text-honey-100">
                {copied ? 'Copied!' : `${taka(flash.couponValue)} off`}
              </span>
            </button>
          )}
        </div>
        <div className="shrink-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-honey-100">Ends in</p>
          <Countdown size="lg" secondsRemaining={flash.secondsRemaining} onExpire={() => setExpired(true)} />
        </div>
      </div>

      <div className="no-scrollbar -mx-5 mt-6 flex gap-3 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
        {flash.products.map((product) => (
          <div key={product._id} className="w-56 shrink-0 sm:w-64">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Horizontal product rail with a "view all" link. */
function Rail({ title, eyebrow, products, link }) {
  if (!products?.length) return null;
  return (
    <section className="mt-12">
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        action={
          <Link to={link} className="flex items-center gap-1 text-sm font-semibold text-leaf-700 hover:text-leaf-800">
            View all <ArrowRight size={15} aria-hidden />
          </Link>
        }
      />
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-4">
        {products.slice(0, 8).map((product) => (
          <div key={product._id} className="w-56 shrink-0 sm:w-auto">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}
