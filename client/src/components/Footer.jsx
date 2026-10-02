/**
 * -----------------------------------------------------------------------------
 *  components/Footer.jsx — contact block, hours, socials, admin door
 * -----------------------------------------------------------------------------
 *  Everything comes from `/api/config` (which mirrors admin Settings), so the
 *  footer follows ops changes without a deploy.
 * -----------------------------------------------------------------------------
 */
import { Link } from 'react-router-dom';
import { Leaf, Phone, Mail, MapPin, Clock, Facebook, Instagram, Youtube } from 'lucide-react';
import { useStoreIdentity } from '../stores/configStore';

export default function Footer() {
  const store = useStoreIdentity();
  const contact = store.contact ?? {};

  return (
    <footer className="mt-16 border-t border-soil-100 bg-soil-950 text-soil-200">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {/* brand */}
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
              <Leaf size={20} aria-hidden />
            </span>
            <span className="text-lg font-extrabold text-white">{store.name}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-soil-300">{store.tagline}</p>
          <div className="mt-4 flex gap-2">
            {contact.facebook && (
              <a href={contact.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="rounded-lg bg-white/5 p-2 hover:bg-white/10">
                <Facebook size={16} />
              </a>
            )}
            {contact.instagram && (
              <a href={contact.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="rounded-lg bg-white/5 p-2 hover:bg-white/10">
                <Instagram size={16} />
              </a>
            )}
            {contact.youtube && (
              <a href={contact.youtube} target="_blank" rel="noreferrer" aria-label="YouTube" className="rounded-lg bg-white/5 p-2 hover:bg-white/10">
                <Youtube size={16} />
              </a>
            )}
          </div>
        </div>

        {/* shop links */}
        <nav aria-label="Shop">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">Shop</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:text-white" to="/shop">All products</Link></li>
            <li><Link className="hover:text-white" to="/shop?category=honey">Honey</Link></li>
            <li><Link className="hover:text-white" to="/shop?category=ghee">Ghee</Link></li>
            <li><Link className="hover:text-white" to="/shop?category=organic-sugar">Organic Sugar & Gur</Link></li>
            <li><Link className="hover:text-white" to="/shop?category=nuts-dry-fruits">Nuts & Dry Fruits</Link></li>
            <li><Link className="hover:text-white" to="/shop?category=combos">Combos & Gifts</Link></li>
          </ul>
        </nav>

        {/* help */}
        <nav aria-label="Help">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">Help</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:text-white" to="/track">Track your order</Link></li>
            <li><Link className="hover:text-white" to="/shop">Delivery: ৳60 Dhaka · ৳120 nationwide</Link></li>
            <li><Link className="hover:text-white" to="/shop">Cash on Delivery available</Link></li>
            <li><Link className="hover:text-white" to="/admin">Store admin</Link></li>
          </ul>
        </nav>

        {/* contact */}
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">Contact</h3>
          <ul className="mt-3 space-y-2.5 text-sm">
            {contact.phone && (
              <li className="flex items-start gap-2">
                <Phone size={15} className="mt-0.5 shrink-0 text-leaf-400" aria-hidden />
                <a href={`tel:${contact.phone}`} className="hover:text-white">{contact.phone}{contact.hotline ? ` · Hotline ${contact.hotline}` : ''}</a>
              </li>
            )}
            {contact.email && (
              <li className="flex items-start gap-2">
                <Mail size={15} className="mt-0.5 shrink-0 text-leaf-400" aria-hidden />
                <a href={`mailto:${contact.email}`} className="hover:text-white">{contact.email}</a>
              </li>
            )}
            {contact.address && (
              <li className="flex items-start gap-2">
                <MapPin size={15} className="mt-0.5 shrink-0 text-leaf-400" aria-hidden />
                <span>{contact.address}</span>
              </li>
            )}
            {contact.hours && (
              <li className="flex items-start gap-2">
                <Clock size={15} className="mt-0.5 shrink-0 text-leaf-400" aria-hidden />
                <span>{contact.hours}</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-soil-400">
        © {new Date().getFullYear()} {store.name}. Prices include VAT where applicable. BSTI-certified & lab-tested batches.
      </div>
    </footer>
  );
}
