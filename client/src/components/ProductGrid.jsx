/**
 * -----------------------------------------------------------------------------
 *  components/ProductGrid.jsx — responsive card grid + skeleton state
 * -----------------------------------------------------------------------------
 *  2 columns on phones (the mobile-first majority), scaling to 4 on desktop.
 *  Skeletons keep the grid height stable while a filter/page change loads.
 * -----------------------------------------------------------------------------
 */
import { PackageSearch } from 'lucide-react';
import ProductCard from './ProductCard';
import { EmptyState, Skeleton } from './ui';

export default function ProductGrid({ products, loading = false, skeletonCount = 8, emptyTitle = 'No products found', emptyBody }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <Skeleton className="aspect-square !rounded-none" />
            <div className="space-y-2 p-3.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!products?.length) {
    return (
      <EmptyState icon={PackageSearch} title={emptyTitle}>
        {emptyBody ?? 'Try a different search term or clear the filters.'}
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product._id} product={product} />
      ))}
    </div>
  );
}
