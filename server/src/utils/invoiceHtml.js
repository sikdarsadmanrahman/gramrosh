/**
 * -----------------------------------------------------------------------------
 *  invoiceHtml.js — Printable invoice / shipping slip
 * -----------------------------------------------------------------------------
 *  Renders the same invoice context the React invoice page uses, but as a
 *  self-contained HTML document with `@media print` rules. Two reasons to have
 *  it server-side as well as client-side:
 *
 *    • the warehouse can hit `/api/admin/orders/:id/invoice` and print straight
 *      from a browser or `wkhtmltopdf`/Chrome headless without running React;
 *    • it is a stable, dependency-free artefact for email attachments and audit.
 *
 *  Everything interpolated is HTML-escaped — order data contains free-text notes
 *  and addresses typed by customers.
 * -----------------------------------------------------------------------------
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape untrusted text for interpolation into HTML. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Format a Date for a Bangladeshi invoice: `20 Sep 2026, 04:31 PM`. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka',
  });
}

/** `৳1,234` with lakh/crore grouping, which is what BD invoices use. */
export function formatMoney(amount, symbol = '৳') {
  const value = Number(amount) || 0;
  const [intPart, decPart] = value.toFixed(2).split('.');
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${symbol}${grouped}${decPart && decPart !== '00' ? `.${decPart}` : ''}`;
}

/** Render one address block. */
function addressBlock(address = {}) {
  const lines = [address.line1, address.line2, address.area, address.city, address.district, address.postalCode]
    .filter(Boolean)
    .map(escapeHtml);
  return lines.join('<br/>');
}

/**
 * @param {object} ctx  output of `buildInvoiceContext(order)`
 * @param {{variant?:'invoice'|'shipping', showPrintButton?:boolean}} [options]
 * @returns {string} a complete HTML document
 */
export function renderInvoiceHtml(ctx, { variant = 'invoice', showPrintButton = true } = {}) {
  const isShippingSlip = variant === 'shipping';
  const money = (value) => formatMoney(value, ctx.currencySymbol);

  const rows = ctx.items
    .map(
      (item, index) => `
        <tr>
          <td class="num">${index + 1}</td>
          <td>
            <strong>${escapeHtml(item.title)}</strong>
            ${item.titleBn ? `<span class="bn">${escapeHtml(item.titleBn)}</span>` : ''}
            <div class="muted">${escapeHtml(item.variantLabel)}${item.sku ? ` · SKU ${escapeHtml(item.sku)}` : ''}</div>
          </td>
          <td class="num">${escapeHtml(item.quantity)}</td>
          <td class="num">${money(item.unitPrice)}</td>
          <td class="num strong">${money(item.total)}</td>
        </tr>`,
    )
    .join('');

  const paymentRows = [
    ['Method', escapeHtml(ctx.payment.methodLabel)],
    ctx.payment.transactionId ? ['Transaction ID', `<code>${escapeHtml(ctx.payment.transactionId)}</code>`] : null,
    ctx.payment.senderPhone ? ['Sent from', escapeHtml(ctx.payment.senderPhone)] : null,
    ctx.payment.merchantNumber && ctx.payment.transactionId ? ['Sent to', escapeHtml(ctx.payment.merchantNumber)] : null,
    ['Status', `<span class="pill">${escapeHtml(ctx.payment.status)}</span>`],
    ctx.payment.paidAt ? ['Paid at', formatDateTime(ctx.payment.paidAt)] : null,
  ]
    .filter(Boolean)
    .map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`)
    .join('');

  const timeline = (ctx.timeline ?? [])
    .map(
      (entry) => `<li><span class="dot"></span><strong>${escapeHtml(entry.status)}</strong>
        <span class="muted">${formatDateTime(entry.at)}${entry.by ? ` · ${escapeHtml(entry.by)}` : ''}</span>
        ${entry.note ? `<div class="muted small">${escapeHtml(entry.note)}</div>` : ''}</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${isShippingSlip ? 'Shipping slip' : 'Invoice'} ${escapeHtml(ctx.order.invoiceNumber)}</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#15803d; --brand-soft:#f0fdf4; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f1f5f9; color:var(--ink);
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  .sheet { max-width: 820px; margin: 24px auto; background:#fff; padding: 32px;
           box-shadow: 0 1px 3px rgba(15,23,42,.12); border-radius: 12px; }
  header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start;
           border-bottom: 2px solid var(--brand); padding-bottom:18px; margin-bottom:22px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .logo { width:44px; height:44px; border-radius:12px; background:var(--brand-soft); color:var(--brand);
          display:grid; place-items:center; font-weight:800; font-size:20px; letter-spacing:-.5px; }
  h1 { font-size:20px; margin:0; letter-spacing:-.2px; }
  .tagline { color:var(--muted); font-size:12px; margin-top:2px; }
  .doc-meta { text-align:right; font-size:12px; color:var(--muted); }
  .doc-meta .number { font-size:16px; font-weight:700; color:var(--ink); letter-spacing:.4px; }
  .status { display:inline-block; margin-top:6px; padding:3px 10px; border-radius:999px;
            background:var(--brand-soft); color:var(--brand); font-weight:700; font-size:11px;
            text-transform:uppercase; letter-spacing:.6px; }
  .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:20px; margin-bottom:24px; }
  .card { border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card h2 { margin:0 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); }
  .kv { display:flex; justify-content:space-between; gap:12px; padding:3px 0; font-size:13px; }
  .kv span { color:var(--muted); }
  table { width:100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted);
             text-align:left; border-bottom:1px solid var(--line); padding:8px 6px; }
  tbody td { padding:10px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody tr:last-child td { border-bottom:none; }
  .num { text-align:right; white-space:nowrap; }
  .strong { font-weight:700; }
  .muted { color:var(--muted); font-size:12px; }
  .small { font-size:11px; }
  .bn { margin-left:6px; color:var(--muted); font-size:12px; }
  code { background:#f8fafc; border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:12px; }
  .pill { background:#f8fafc; border:1px solid var(--line); border-radius:999px; padding:1px 8px; font-size:11px; }
  .totals { display:flex; justify-content:flex-end; }
  .totals table { width: 320px; margin:0; }
  .totals td { border:none; padding:4px 6px; }
  .totals tr.grand td { border-top:2px solid var(--ink); font-size:17px; font-weight:800; padding-top:8px; }
  .words { text-align:right; font-size:12px; color:var(--muted); margin-top:6px; font-style:italic; }
  .timeline { list-style:none; margin:0 0 22px; padding:0; }
  .timeline li { position:relative; padding:0 0 10px 22px; border-left:1px solid var(--line); margin-left:5px; }
  .timeline li:last-child { border-left-color:transparent; padding-bottom:0; }
  .timeline .dot { position:absolute; left:-5px; top:5px; width:9px; height:9px; border-radius:50%;
                   background:var(--brand); border:2px solid #fff; box-shadow:0 0 0 1px var(--brand); }
  .note { background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; font-size:12px; margin-bottom:20px; }
  footer { border-top:1px solid var(--line); margin-top:24px; padding-top:14px;
           display:flex; justify-content:space-between; gap:16px; font-size:11px; color:var(--muted); }
  .sign { margin-top:34px; display:flex; justify-content:flex-end; }
  .sign div { text-align:center; min-width:200px; }
  .sign .line { border-top:1px dashed #94a3b8; padding-top:6px; font-size:11px; color:var(--muted); }
  .actions { max-width:820px; margin:0 auto 12px; display:flex; gap:8px; justify-content:flex-end; }
  .btn { border:1px solid var(--line); background:#fff; color:var(--ink); padding:8px 16px;
         border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; }
  .btn.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  .barcode { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:3px; font-size:12px; }
  @media (max-width: 640px) {
    .sheet { margin:0; border-radius:0; padding:18px; }
    .grid { grid-template-columns: 1fr; }
    header { flex-direction:column; }
    .doc-meta { text-align:left; }
    .totals table { width:100%; }
  }
  @media print {
    body { background:#fff; }
    .sheet { box-shadow:none; margin:0; max-width:none; border-radius:0; padding:0; }
    .actions { display:none !important; }
    thead th { color:#000; }
    a { color:inherit; text-decoration:none; }
    @page { margin: 12mm; }
  }
</style>
</head>
<body>
  ${showPrintButton ? `<div class="actions">
      <button class="btn" onclick="window.history.back()">Back</button>
      <button class="btn primary" onclick="window.print()">Print / Save as PDF</button>
    </div>` : ''}

  <div class="sheet">
    <header>
      <div class="brand">
        <div class="logo">G</div>
        <div>
          <h1>${escapeHtml(ctx.store.name)}</h1>
          <div class="tagline">${escapeHtml(ctx.store.tagline)}</div>
          <div class="muted small">${escapeHtml(ctx.store.address)}</div>
          <div class="muted small">${escapeHtml(ctx.store.phone)} · ${escapeHtml(ctx.store.email)}</div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="muted">${isShippingSlip ? 'Shipping slip' : 'Tax invoice'}</div>
        <div class="number">${escapeHtml(ctx.order.invoiceNumber)}</div>
        <div class="muted">Order ${escapeHtml(ctx.order.number)}</div>
        <div class="muted">Placed ${formatDateTime(ctx.order.placedAt)}</div>
        <div class="status">${escapeHtml(ctx.order.status)}</div>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h2>Billed &amp; delivered to</h2>
        <div class="strong">${escapeHtml(ctx.customer.name)}</div>
        <div class="muted">${escapeHtml(ctx.customer.phone)}</div>
        ${ctx.customer.email ? `<div class="muted">${escapeHtml(ctx.customer.email)}</div>` : ''}
        ${ctx.customer.alternatePhone ? `<div class="muted">Alt: ${escapeHtml(ctx.customer.alternatePhone)}</div>` : ''}
        <div style="margin-top:8px">${addressBlock(ctx.shippingAddress)}</div>
        ${ctx.shippingAddress.landmark ? `<div class="muted small">Landmark: ${escapeHtml(ctx.shippingAddress.landmark)}</div>` : ''}
        <div class="muted small" style="margin-top:6px">Delivery zone: <strong>${escapeHtml(ctx.shipping.label)}</strong>${ctx.shipping.etaDays?.length ? ` · ${ctx.shipping.etaDays[0]}–${ctx.shipping.etaDays[1]} days` : ''}</div>
        ${ctx.shipping.courier || ctx.shipping.trackingNumber ? `<div class="muted small">Courier: ${escapeHtml(ctx.shipping.courier || '—')}${ctx.shipping.trackingNumber ? ` · <span class="barcode">${escapeHtml(ctx.shipping.trackingNumber)}</span>` : ''}</div>` : ''}
      </div>
      <div class="card">
        <h2>Payment</h2>
        ${paymentRows}
      </div>
    </div>

    ${ctx.order.deliveryNote ? `<div class="note"><strong>Delivery note:</strong> ${escapeHtml(ctx.order.deliveryNote)}</div>` : ''}

    <table>
      <thead>
        <tr><th class="num" style="width:28px">#</th><th>Item</th><th class="num" style="width:56px">Qty</th><th class="num" style="width:96px">Unit</th><th class="num" style="width:104px">Total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td class="num">${money(ctx.pricing.subtotal)}</td></tr>
        ${ctx.pricing.discount > 0 ? `<tr><td>Discount</td><td class="num">− ${money(ctx.pricing.discount)}</td></tr>` : ''}
        <tr><td>Delivery (${escapeHtml(ctx.shipping.label)})</td><td class="num">${ctx.pricing.shippingFee === 0 ? 'FREE' : money(ctx.pricing.shippingFee)}</td></tr>
        ${ctx.pricing.paymentFee > 0 ? `<tr><td>Payment fee</td><td class="num">${money(ctx.pricing.paymentFee)}</td></tr>` : ''}
        ${ctx.pricing.tax > 0 ? `<tr><td>VAT</td><td class="num">${money(ctx.pricing.tax)}</td></tr>` : ''}
        <tr class="grand"><td>Grand total</td><td class="num">${money(ctx.pricing.grandTotal)}</td></tr>
      </table>
    </div>
    <div class="words">In words: ${escapeHtml(ctx.totals.amountInWords)}</div>

    ${timeline ? `<h2 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;margin:26px 0 10px">Order timeline</h2>
      <ul class="timeline">${timeline}</ul>` : ''}

    ${ctx.order.notes ? `<div class="note"><strong>Note:</strong> ${escapeHtml(ctx.order.notes)}</div>` : ''}

    <div class="sign">
      <div><div class="line">Authorised signature &amp; seal</div></div>
    </div>

    <footer>
      <div>
        Thank you for supporting Bangladeshi farmers.<br/>
        ${escapeHtml(ctx.store.hours ? `Hours: ${ctx.store.hours}` : '')}
      </div>
      <div style="text-align:right">
        Need help? Call ${escapeHtml(ctx.store.phone)}<br/>
        <span class="barcode">${escapeHtml(ctx.order.number)}</span>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

export default renderInvoiceHtml;
