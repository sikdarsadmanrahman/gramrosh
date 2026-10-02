/**
 * -----------------------------------------------------------------------------
 *  components/ProductCard.jsx — the catalogue card
 * -----------------------------------------------------------------------------
 *  Renders exactly what the API's card shape provides: WebP image with
 *  width/height (no layout shift), "from ৳X" price via `priceFrom`, badges,
 *  stock state and a one-tap add for single-variant products. Multi-variant
 *  products route to the PDP where the weight selector lives.
 * -----------------------------------------------------------------------------
 */
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ShoppingBasket, Layers } from 'lucide-react';
import { Price, StockBadge, DiscountBadge, Rating } from './ui';
import { useCartStore } from '../stores/cartStore';

/** Badge labels the merchandising team uses in the seed data. */
const BADGE_LABELS = {
  bestseller: 'Bestseller',
  new: 'New',
  limited: 'Limited',
  seasonal: 'Seasonal',
  organic: 'Organic',
  raw: 'Raw',
  'lab-tested': 'Lab-tested',
};

export default function ProductCard({ product, className }) {
  const add = useCartStore((s) => s.add);
  const out = product.stockStatus === 'out_of_stock';
  const primary = product.imageSrcSet?.[0];

  /** Single-variant products can be added straight from the card. */
  const quickAdd = (event) => {
    event.preventDefault();
    if (product.defaultVariant && !out) add(product, product.defaultVariant, 1);
  };

  return (
    <Link
      to={`/product/${product.slug}`}
      className={clsx(
        'card group relative flex flex-col overflow-hidden transition-shadow hover:shadow-pop',
        className,
      )}
    >
      {/* ---- image ---- */}
      <div className="relative aspect-square overflow-hidden bg-soil-50">
        <img
          src={primary?.url ?? product.image}
          srcSet={primary?.srcset ?? undefined}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          alt={primary?.alt ?? product.title}
          width={primary?.width ?? 1200}
          height={primary?.height ?? 1200}
          loading="lazy"
          decoding="async"
          className={clsx(
            'h-full w-full object-cover transition-transform duration-300 group-hover:scale-105',
            out && 'opacity-50 grayscale-[35%]',
          )}
        />

        {/* corner chips */}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          <DiscountBadge percent={product.discountPercent} />
          {product.isOnFlashSale && <span className="chip bg-honey-500 text-white shadow-sm">Flash sale</span>}
          {product.badges?.slice(0, 1).map((badge) => (
            <span key={badge} className="chip bg-white/90 text-soil-700 shadow-sm">{BADGE_LABELS[badge] ?? badge}</span>
          ))}
        </div>

        {out && (
          <div className="absolute inset-x-0 bottom-0 bg-soil-950/70 py-1.5 text-center text-xs font-bold uppercase tracking-wider text-white">
            Out of stock
          </div>
        )}
      </div>

      {/* ---- body ---- */}
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-leaf-600">{product.categoryName}</p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-soil-900">{product.title}</h3>
        {product.titleBn && <p lang="bn" className="text-xs text-soil-500">{product.titleBn}</p>}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            {product.hasMultipleVariants && <p className="text-[11px] text-soil-400">from</p>}
            <Price amount={product.priceFrom} compareAt={product.defaultVariant?.compareAtPrice} size="sm" />
          </div>
          <Rating value={product.rating} count={product.reviewCount} className="hidden sm:inline-flex" />
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <StockBadge status={product.stockStatus} />
          {product.hasMultipleVariants ? (
            <span className="btn-outline !px-3 !py-1.5 text-xs" aria-hidden>
              <Layers size={14} /> {product.variants?.length ?? 0} sizes
            </span>
          ) : (
            <button
              type="button"
              onClick={quickAdd}
              disabled={out}
              className="btn-primary !px-3 !py-1.5 text-xs"
              aria-label={`Add ${product.title} to cart`}
            >
              <ShoppingBasket size={14} /> Add
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
