/**
 * -----------------------------------------------------------------------------
 *  pages/Shop.jsx — the catalogue: real-time search + filters + pagination
 * -----------------------------------------------------------------------------
 *  All state lives in the URL (`?q=&category=&sort=&page=&inStock=`), so
 *  filters are shareable, the back button works and a refresh keeps context.
 *
 *  Search is "real-time" with a 300 ms debounce: keystrokes update the box
 *  instantly, the URL and the server query follow after the pause. Pagination
 *  is fully server-side (`limit`/`skip` on the API).
 * -----------------------------------------------------------------------------
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { clsx } from 'clsx';
import { storefront } from '../lib/api';
import ProductGrid from '../components/ProductGrid';
import { Pagination, ErrorBanner } from '../components/ui';

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'best_selling', label: 'Best selling' },
  { id: 'popular', label: 'Most viewed' },
  { id: 'price_asc', label: 'Price: low → high' },
  { id: 'price_desc', label: 'Price: high → low' },
  { id: 'rating', label: 'Top rated' },
];

export default function Shop() {
  const [params, setParams] = useSearchParams();

  // --- URL-derived state ---
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const inStock = params.get('inStock') === '1';

  // --- server data ---
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // --- debounced search box (controlled locally, synced to the URL) ---
  const [searchText, setSearchText] = useState(q);
  const debounceRef = useRef(null);

  useEffect(() => setSearchText(q), [q]); // back/forward navigation

  const updateParams = (patch, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value == null || value === false) next.delete(key);
      else next.set(key, value === true ? '1' : String(value));
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: false });
  };

  const onSearchInput = (value) => {
    setSearchText(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value.trim() }), 300);
  };

  // Categories load once.
  useEffect(() => {
    storefront.categories().then(({ items }) => setCategories(items)).catch(() => {});
  }, []);

  // Products reload whenever the URL query changes (server-side pagination).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    storefront
      .products({
        q: q || undefined,
        category: category || undefined,
        sort,
        page,
        limit: 12,
        inStock: inStock ? 'true' : undefined,
      })
      .then(({ items, pagination: pager }) => {
        if (!alive) return;
        setProducts(items);
        setPagination(pager);
      })
      .catch((err) => alive && setError(err))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [q, category, sort, page, inStock]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.slug === category),
    [categories, category],
  );

  const activeFilterCount = (category ? 1 : 0) + (inStock ? 1 : 0) + (q ? 1 : 0);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6">
      {/* ---- heading ---- */}
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-soil-900">
          {activeCategory ? activeCategory.name?.en : 'All products'}
        </h1>
        {activeCategory?.summary && <p className="mt-1 max-w-2xl text-sm text-soil-500">{activeCategory.summary}</p>}
      </div>

      {/* ---- search + sort toolbar ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-soil-400" aria-hidden />
          <input
            type="search"
            value={searchText}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder="Search the catalogue…"
            aria-label="Search products"
            className="field !pl-10"
          />
        </div>

        <select
          value={sort}
          onChange={(e) => updateParams({ sort: e.target.value })}
          aria-label="Sort products"
          className="field w-auto"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        <button
          type="button"
          className={clsx('btn-outline sm:hidden', activeFilterCount > 0 && '!border-leaf-500 !text-leaf-700')}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal size={15} /> Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
      </div>

      {/* ---- category pills (always visible on ≥sm, toggle on mobile) ---- */}
      <div className={clsx('mt-3 flex-wrap items-center gap-2', filtersOpen ? 'flex' : 'hidden sm:flex')}>
        <CategoryPill active={!category} onClick={() => updateParams({ category: '' })}>All</CategoryPill>
        {categories.map((c) => (
          <CategoryPill key={c.slug} active={category === c.slug} onClick={() => updateParams({ category: c.slug })}>
            {c.name?.en}
            <span className="ml-1 text-[10px] opacity-60">{c.liveProductCount ?? c.productCount}</span>
          </CategoryPill>
        ))}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-soil-600">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => updateParams({ inStock: e.target.checked })}
            className="h-4 w-4 rounded border-soil-300 text-leaf-600 focus:ring-leaf-500"
          />
          In stock only
        </label>
      </div>

      {/* ---- active search chip ---- */}
      {q && (
        <div className="mt-3 flex items-center gap-2 text-sm text-soil-600">
          <span>
            Results for <strong>“{q}”</strong>
            {pagination && <span className="text-soil-400"> — {pagination.total} found</span>}
          </span>
          <button type="button" className="chip bg-soil-100 text-soil-600 hover:bg-soil-200" onClick={() => updateParams({ q: '' })}>
            Clear <X size={12} aria-hidden />
          </button>
        </div>
      )}

      {/* ---- results ---- */}
      <div className="mt-5">
        {error ? (
          <ErrorBanner error={error} />
        ) : (
          <ProductGrid
            products={products}
            loading={loading}
            emptyTitle={q ? `Nothing matches “${q}”` : 'No products in this category yet'}
          />
        )}
      </div>

      <Pagination
        className="mt-8"
        pagination={pagination}
        onPage={(p) => {
          updateParams({ page: p }, { resetPage: false });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}

function CategoryPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-leaf-600 text-white' : 'bg-white text-soil-700 border border-soil-200 hover:border-leaf-400',
      )}
    >
      {children}
    </button>
  );
}
