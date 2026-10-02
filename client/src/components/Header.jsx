/**
 * -----------------------------------------------------------------------------
 *  components/Header.jsx — announcement bar + sticky header + search
 * -----------------------------------------------------------------------------
 *  Mobile-first: logo, search toggle and basket always visible; category nav
 *  collapses into a slide-down panel. Search submits to /shop?q=… where the
 *  server-side search (plus client-side debounce on that page) takes over.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Leaf, Menu, Search, ShoppingBasket, X, PackageSearch } from 'lucide-react';
import { useStoreIdentity } from '../stores/configStore';
import { useCartStore, useCartCount } from '../stores/cartStore';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/shop', label: 'Shop' },
  { to: '/shop?category=combos', label: 'Combos & Gifts' },
  { to: '/track', label: 'Track Order' },
];

export default function Header() {
  const store = useStoreIdentity();
  const cartCount = useCartCount();
  const openCart = useCartStore((s) => s.open);
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const submitSearch = (event) => {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
    setSearchOpen(false);
    setMenuOpen(false);
  };

  return (
    <>
      {/* ---- announcement bar ---- */}
      {store.announcement?.isActive && store.announcement.text && (
        <div className="bg-leaf-700 px-4 py-1.5 text-center text-xs font-medium text-leaf-50">
          {store.announcement.text}
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-soil-100 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          {/* mobile menu toggle */}
          <button
            type="button"
            className="btn-ghost -ml-2 !px-2 md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          {/* logo */}
          <Link to="/" className="flex items-center gap-2" aria-label={`${store.name} home`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
              <Leaf size={20} aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-extrabold tracking-tight text-leaf-800">{store.name}</span>
              <span className="hidden text-[10px] font-medium text-soil-500 sm:block">{store.tagline}</span>
            </span>
          </Link>

          {/* desktop nav */}
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                    isActive ? 'text-leaf-700' : 'text-soil-600 hover:text-leaf-700',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* search toggle */}
            <button
              type="button"
              className="btn-ghost !px-2.5"
              aria-label="Search products"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search size={20} />
            </button>

            {/* basket */}
            <button type="button" className="btn-ghost relative !px-2.5" aria-label={`Open cart, ${cartCount} items`} onClick={openCart}>
              <ShoppingBasket size={22} />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-honey-500 px-1 text-[11px] font-bold text-white">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ---- search panel ---- */}
        {searchOpen && (
          <form onSubmit={submitSearch} className="animate-fade-in border-t border-soil-100 bg-white px-4 py-3">
            <div className="mx-auto flex max-w-6xl gap-2">
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search honey, ghee, nuts, combos…"
                className="field"
                aria-label="Search products"
              />
              <button type="submit" className="btn-primary shrink-0">
                <Search size={16} /> Search
              </button>
            </div>
          </form>
        )}

        {/* ---- mobile nav panel ---- */}
        {menuOpen && (
          <nav className="animate-fade-in border-t border-soil-100 bg-white px-4 py-2 md:hidden" aria-label="Mobile">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold',
                    isActive ? 'bg-leaf-50 text-leaf-700' : 'text-soil-700',
                  )
                }
              >
                {item.label === 'Track Order' && <PackageSearch size={16} aria-hidden />}
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
    </>
  );
}
