import { getDb, migrate, get, run, now } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { config } from '../config.js';

/**
 * Seeds the database if empty: admin user, demo category/product/combinations,
 * reviews, discounts, content pages, and settings. Safe to re-run (no-ops when data exists).
 */
export function seed() {
  migrate();
  const db = getDb();

  if (get('SELECT id FROM users LIMIT 1')) return { seeded: false };

  const ts = now();

  run('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    config.adminUsername, hashPassword(config.adminPassword), ts);

  const settings = {
    business_name: 'Eloria',
    business_email: 'orders@eloria.example',
    business_phone: '+20 100 000 0000',
    whatsapp_number: '+20 100 000 0000',
    business_address: 'Cairo, Egypt',
    business_hours: 'Saturday–Thursday, 10:00–18:00',
    currency: 'EGP',
  };
  for (const [key, value] of Object.entries(settings)) {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', key, value);
  }

  run('INSERT INTO categories (name, sort_order, created_at) VALUES (?, ?, ?)', 'Body Care', 1, ts);

  const categoryId = get('SELECT last_insert_rowid() AS id').id;

  run(
    `INSERT INTO products (item_code, name, description, ingredients, usage_instructions, category_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    'ELR-BL-001',
    'Eloria Body Lotion',
    'A lightweight daily body lotion that absorbs quickly and leaves skin soft and hydrated. ' +
      'Dermatologically tested, paraben free, and suitable for all skin types. ' +
      '(Product name and copy are provisional and require confirmation — see docs/DECISIONS.md.)',
    'Aqua, Glycerin, Cetearyl Alcohol, Butyrospermum Parkii (Shea) Butter, Theobroma Cacao Seed Butter, ' +
      'Tocopheryl Acetate (Vitamin E), Aloe Barbadensis Leaf Juice, Fragrance, Phenoxyethanol.',
    'Apply to clean skin once or twice daily, massaging gently until fully absorbed. ' +
      'For best results use after bathing. For external use only.',
    categoryId, ts, ts,
  );
  const productId = get('SELECT last_insert_rowid() AS id').id;

  const images = [
    ['/assets/lotion-200.jpg', 'Eloria Body Lotion bottle', 1],
    ['/assets/lotion-400.jpg', 'Eloria Body Lotion large bottle', 2],
    ['/assets/hero.jpg', 'Eloria Body Lotion lifestyle image', 3],
  ];
  for (const [url, alt, sort] of images) {
    run('INSERT INTO product_images (product_id, url, alt, sort_order) VALUES (?, ?, ?, ?)',
      productId, url, alt, sort);
  }

  // Combinations (CAT-02): one deliberately near its low-stock threshold to demo INV-04.
  const combos = [
    ['ELR-BL-001-200-VAN', '200 ml', 200, 'Natural White', 'Vanilla', 22000, 300, 10],
    ['ELR-BL-001-200-COC', '200 ml', 200, 'Soft Peach', 'Coconut', 22000, 120, 10],
    ['ELR-BL-001-400-VAN', '400 ml', 400, 'Natural White', 'Vanilla', 38000, 80, 10],
    ['ELR-BL-001-400-COC', '400 ml', 400, 'Soft Peach', 'Coconut', 38000, 60, 10],
    ['ELR-BL-001-400-LAV', '400 ml', 400, 'Natural White', 'Lavender', 38000, 4, 5],
  ];
  for (const [sku, size, ml, color, scent, price, stock, threshold] of combos) {
    run(
      `INSERT INTO combinations (product_id, sku, size_label, size_ml, color, scent, price_minor, stock_qty, low_stock_threshold, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      productId, sku, size, ml, color, scent, price, stock, threshold, ts,
    );
  }

  const reviews = [
    ['Mariam A.', 5, 'Light, non-greasy and the vanilla scent is subtle. My skin feels soft all day.', 'published'],
    ['Nour K.', 4, 'Really nice texture and absorbs fast. Would love a larger size option.', 'published'],
    ['Salma H.', 5, 'Waiting to try the lavender one!', 'pending'],
  ];
  for (const [name, rating, body, status] of reviews) {
    run(
      `INSERT INTO reviews (product_id, author_name, rating, body, status, created_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      productId, name, rating, body, status, ts, status === 'published' ? ts : null,
    );
  }

  const discounts = [
    // Automatic sale: 10% off the launch product.
    ['sale', null, 'Launch sale — 10% off Body Lotion', 'percent', 1000, 'product', productId, 0, null, null, null, 1, ts],
    // Promo code example (documented defaults — see docs/DECISIONS.md).
    ['promo', 'WELCOME10', 'Welcome promo — 10% off', 'percent', 1000, 'all', null, 5000, null, null, 100, 0, ts],
  ];
  for (const [type, code, name, method, value, scope, scopeId, minSub, starts, ends, limit, stackable, created] of discounts) {
    run(
      `INSERT INTO discounts (type, code, name, method, value, scope, scope_id, min_subtotal_minor, starts_at, ends_at, usage_limit, stackable, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      type, code, name, method, value, scope, scopeId, minSub, starts, ends, limit, stackable, created,
    );
  }

  const pages = {
    'shipping-policy': {
      title: 'Shipping Policy',
      body: [
        '## Shipping arrangements',
        '',
        'Shipping arrangements and costs depend on your delivery destination. ' +
          'The website does not list or calculate shipping fees.',
        '',
        'After you submit an order request, our team contacts you on WhatsApp to confirm availability, ' +
          'the delivery address, and the shipping cost. The agreed shipping amount is added to your ' +
          'order total before the deposit is confirmed.',
        '',
        '## Delivery',
        '',
        'Delivery is arranged manually after your deposit is confirmed. You will be contacted on ' +
          'WhatsApp to arrange a suitable time.',
      ].join('\n'),
    },
    faq: {
      title: 'Frequently Asked Questions',
      body: [
        '## How do I book a product?',
        '',
        'Choose your product options and quantities, add them to your order request, and submit the ' +
          'form with your contact details. You will receive a unique order code.',
        '',
        '## What is the order code and why should I keep it?',
        '',
        'Your order code is the reference for your request (for example ELR-7K3M9Q). Keep it safe — ' +
          'you will need it when contacting us about your order.',
        '',
        '## How is my order confirmed?',
        '',
        'Someone from our team will contact you on WhatsApp to confirm the order and delivery details. ' +
          'We do not confirm orders automatically.',
        '',
        '## How do I pay the deposit?',
        '',
        'Deposits are collected outside the website, as agreed on WhatsApp (for example cash on ' +
          'delivery of the deposit, bank transfer, or another arranged method). The admin records the ' +
          'deposit on your order once received.',
        '',
        '## What about the remaining payment?',
        '',
        'The remaining balance is paid when you receive your item, as agreed during confirmation. ' +
          'The order is marked fully paid once the final payment is confirmed.',
        '',
        '## How is shipping handled?',
        '',
        'Shipping arrangements and costs depend on your destination and are confirmed with you ' +
          'separately on WhatsApp. See the Shipping Policy page for details.',
        '',
        '## Can I cancel my order?',
        '',
        'Yes. If you have not paid a deposit yet, contact us with your order code and we will cancel ' +
          'the request. No payment is received in that case and nothing is charged.',
        '',
        '## What are the return rules?',
        '',
        'Products can be returned when they are unopened and unused. Return shipping fees are paid by ' +
          'the customer. Contact us on WhatsApp with your order code to arrange a return.',
        '',
        '## What happens if I refuse the delivery?',
        '',
        'If you refuse the item at delivery, the deposit you already paid is retained and the ' +
          'remaining balance is not collected. Stock is only restored to us once the item is ' +
          'physically returned.',
      ].join('\n'),
    },
    contact: {
      title: 'Contact Us',
      body: [
        'Questions about a product or an existing order? Reach us on WhatsApp or by phone — ' +
          'please have your order code ready if you have one.',
        '',
        '(Final contact details to be confirmed — see docs/DECISIONS.md.)',
      ].join('\n'),
    },
    'returns-policy': {
      title: 'Cancellations & Returns',
      body: [
        '## Cancelling before payment',
        '',
        'If you have not paid a deposit, you can cancel your order request at any time by contacting ' +
          'us with your order code. Nothing is charged.',
        '',
        '## Returns after delivery',
        '',
        'Products may be returned when they are unopened and unused. Return shipping fees are paid ' +
          'by the customer.',
        '',
        'Return windows, refund amounts and the treatment of deposits on accepted returns are being ' +
          'finalized — our team will explain the applicable terms when you contact us.',
        '',
        '## Refused delivery',
        '',
        'If you refuse the item at delivery, the deposit already received is retained and the ' +
          'remaining balance is not collected.',
      ].join('\n'),
    },
  };
  for (const [slug, page] of Object.entries(pages)) {
    run('INSERT INTO content_pages (slug, title, body, updated_at) VALUES (?, ?, ?, ?)',
      slug, page.title, page.body, ts);
  }

  return { seeded: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = seed();
  console.log(result.seeded ? `Database seeded. Admin login: ${config.adminUsername} / ${config.adminPassword}` : 'Database already seeded — nothing to do.');
}
