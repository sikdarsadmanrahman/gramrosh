/**
 * -----------------------------------------------------------------------------
 *  admin/Products.jsx — catalogue table: search, stock, archive, duplicate
 * -----------------------------------------------------------------------------
 *  Inline stock editing PATCHes `/products/:id/stock` and refreshes the row
 *  from the response, so the table always shows what the server derived
 *  (totalStock, stockStatus). Archive/restore and duplicate are one-click.
 * -----------------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Archive, ArchiveRestore, CopyPlus, Trash2, Pencil, PackageX,
} from 'lucide-react';
import { clsx } from 'clsx';
import { admin } from '../lib/api';
import { taka, STOCK_LABELS } from '../lib/format';
import { Loading, ErrorBanner, Pagination, StockBadge } from '../components/ui';
import { PageHeader, useToast } from './shared';

export default function Products() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';
  const includeArchived = params.get('archived') === '1';

  const [rows, setRows] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState(q);
  const debounceRef = useRef(null);
  const { toast, ToastHost } = useToast();

  const load = useCallback(() => {
    admin.products({ page, limit: 15, q: q || undefined, includeArchived: includeArchived ? 'true' : undefined })
      .then(({ items, pagination: pager }) => { setRows(items); setPagination(pager); })
      .catch(setError);
  }, [page, q, includeArchived]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const updateParams = (patch, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value === true ? '1' : String(value));
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };

  const onSearch = (value) => {
    setSearchText(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value.trim() }), 300);
  };

  /** Replace one row in place after a mutation (no full reload flash). */
  const patchRow = (id, next) =>
    setRows((current) => current.map((row) => (row._id === id ? { ...row, ...next } : row)));

  const onArchive = async (product) => {
    try {
      const { data, message } = await admin.archiveProduct(product._id, !product.isArchived);
      patchRow(product._id, data);
      toast(message);
    } catch (err) { toast(err.message, 'error'); }
  };

  const onDuplicate = async (product) => {
    try {
      const { message } = await admin.duplicateProduct(product._id);
      toast(message);
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const onDelete = async (product) => {
    // The API refuses deletion while orders reference the product (409).
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Permanently delete "${product.title}"? Archive is usually safer.`)) return;
    try {
      const { message } = await admin.deleteProduct(product._id);
      toast(message);
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div>
      <ToastHost />
      <PageHeader
        title="Products"
        description={pagination ? `${pagination.total} in the catalogue` : ' '}
        actions={
          <Link to="/admin/products/new" className="btn-primary">
            <Plus size={16} aria-hidden /> New product
          </Link>
        }
      />

      <div className="space-y-4 px-4 sm:px-6">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soil-400" aria-hidden />
            <input
              type="search" value={searchText} onChange={(e) => onSearch(e.target.value)}
              placeholder="Search title, SKU, tag…" className="field !pl-9" aria-label="Search products"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-soil-600">
            <input
              type="checkbox" checked={includeArchived}
              onChange={(e) => updateParams({ archived: e.target.checked })}
              className="h-4 w-4 rounded border-soil-300 text-leaf-600 focus:ring-leaf-500"
            />
            Show archived
          </label>
        </div>

        <ErrorBanner error={error} />
        {!rows ? (
          <Loading label="Loading the catalogue…" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-soil-100 bg-soil-50/60">
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Price</th>
                  <th className="th">Stock by pack</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soil-50">
                {rows.map((product) => (
                  <ProductRow
                    key={product._id}
                    product={product}
                    onPatched={(next) => patchRow(product._id, next)}
                    onArchive={() => onArchive(product)}
                    onDuplicate={() => onDuplicate(product)}
                    onDelete={() => onDelete(product)}
                    toast={toast}
                  />
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="td py-10 text-center text-soil-400">Nothing matches this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination pagination={pagination} onPage={(p) => updateParams({ page: p }, { resetPage: false })} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** One table row with inline per-variant stock inputs. */
function ProductRow({ product, onPatched, onArchive, onDuplicate, onDelete, toast }) {
  const [savingVariant, setSavingVariant] = useState(null);

  /** Commit an absolute stock value for one variant on blur/Enter. */
  const commitStock = async (variant, raw) => {
    const stock = Math.max(0, Number(raw) || 0);
    if (stock === variant.stock) return;
    setSavingVariant(variant._id);
    try {
      const { data } = await admin.updateStock(product._id, { variants: [{ variantId: variant._id, stock }] });
      // The response carries the re-derived product — trust it, don't guess.
      onPatched({
        variants: data.product.variants,
        totalStock: data.totalStock,
        stockStatus: data.stockStatus,
      });
      toast(`Stock updated — ${product.title} · ${variant.label} → ${stock}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingVariant(null);
    }
  };

  return (
    <tr className={clsx(product.isArchived && 'opacity-50')}>
      {/* product cell */}
      <td className="td">
        <div className="flex items-center gap-3">
          <img src={product.image} alt="" width={44} height={44} loading="lazy" className="h-11 w-11 rounded-xl object-cover" />
          <div className="min-w-0">
            <Link to={`/admin/products/${product._id}`} className="block truncate text-sm font-bold text-soil-900 hover:text-leaf-700">
              {product.title}
            </Link>
            <p className="truncate text-xs text-soil-400">
              {product.categoryName}{product.isCombo ? ' · combo' : ''}{product.isArchived ? ' · archived' : ''}
            </p>
          </div>
        </div>
      </td>

      {/* price */}
      <td className="td whitespace-nowrap text-sm font-semibold">
        {product.priceRange?.min === product.priceRange?.max
          ? taka(product.priceRange?.min)
          : `${taka(product.priceRange?.min)} – ${taka(product.priceRange?.max)}`}
      </td>

      {/* stock inputs */}
      <td className="td">
        <div className="flex flex-wrap gap-1.5">
          {product.variants?.map((variant) => (
            <label key={variant._id} className="flex items-center gap-1 rounded-lg border border-soil-100 bg-soil-50/50 px-1.5 py-1">
              <span className="text-[10px] font-bold text-soil-500">{variant.label}</span>
              <input
                type="number"
                min={0}
                defaultValue={variant.stock}
                disabled={savingVariant === variant._id}
                onBlur={(e) => commitStock(variant, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-label={`${product.title} ${variant.label} stock`}
                className={clsx(
                  'w-14 rounded-md border border-transparent bg-white px-1 py-0.5 text-right text-xs font-semibold tabular-nums',
                  'focus:border-leaf-500 focus:outline-none',
                  variant.stock === 0 && 'text-red-600',
                )}
              />
            </label>
          ))}
        </div>
      </td>

      {/* status */}
      <td className="td">
        <div className="flex flex-col items-start gap-1">
          <StockBadge status={product.stockStatus} />
          {product.stockStatus === 'out_of_stock' && <PackageX size={13} className="text-red-400" aria-hidden />}
        </div>
      </td>

      {/* actions */}
      <td className="td">
        <div className="flex items-center justify-end gap-1">
          <Link to={`/admin/products/${product._id}`} className="btn-ghost !p-2" aria-label={`Edit ${product.title}`}>
            <Pencil size={15} />
          </Link>
          <button type="button" className="btn-ghost !p-2" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
            <CopyPlus size={15} />
          </button>
          <button type="button" className="btn-ghost !p-2" aria-label={product.isArchived ? 'Restore' : 'Archive'} title={product.isArchived ? 'Restore' : 'Archive'} onClick={onArchive}>
            {product.isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
          <button type="button" className="btn-ghost !p-2 hover:!text-red-600" aria-label="Delete" title="Delete" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}
