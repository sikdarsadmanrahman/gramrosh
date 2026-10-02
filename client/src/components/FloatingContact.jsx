/**
 * -----------------------------------------------------------------------------
 *  components/FloatingContact.jsx — WhatsApp / call widget
 * -----------------------------------------------------------------------------
 *  Fixed bottom-right FAB that fans out into WhatsApp and phone actions.
 *  Numbers come from /api/config so ops can change them without a deploy.
 * -----------------------------------------------------------------------------
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { MessageCircle, Phone, X, Headset } from 'lucide-react';
import { useSupport } from '../stores/configStore';

export default function FloatingContact() {
  const support = useSupport();
  const [open, setOpen] = useState(false);

  if (!support.whatsapp && !support.phone) return null;

  const whatsappHref = support.whatsapp
    ? `https://wa.me/${String(support.whatsapp).replace(/[^\d]/g, '')}?text=${encodeURIComponent('Hi Gramrosh! I have a question about an order.')}`
    : null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {/* fan-out actions */}
      {open && (
        <div className="flex animate-rise-in flex-col items-end gap-2">
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-full bg-[#25d366] py-2.5 pl-4 pr-5 text-sm font-semibold text-white shadow-pop hover:brightness-95"
            >
              <MessageCircle size={18} aria-hidden /> WhatsApp us
            </a>
          )}
          {support.phone && (
            <a
              href={`tel:${support.phone}`}
              className="flex items-center gap-2 rounded-full bg-leaf-600 py-2.5 pl-4 pr-5 text-sm font-semibold text-white shadow-pop hover:bg-leaf-700"
            >
              <Phone size={17} aria-hidden /> Call {support.hotline || support.phone}
            </a>
          )}
        </div>
      )}

      {/* main FAB */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close contact options' : 'Contact us'}
        aria-expanded={open}
        className={clsx(
          'flex h-14 w-14 items-center justify-center rounded-full text-white shadow-pop transition-colors',
          open ? 'bg-soil-800' : 'bg-[#25d366] hover:brightness-95',
        )}
      >
        {open ? <X size={22} /> : <Headset size={24} />}
      </button>
    </div>
  );
}
