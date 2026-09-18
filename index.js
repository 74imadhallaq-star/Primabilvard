const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const resendApiKey = defineSecret('RESEND_API_KEY');
const ownerNotificationEmail = defineString('OWNER_NOTIFICATION_EMAIL', { default: 'foretag@primabilvard.com' });

function allowCors(response) {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function productOrderId() {
  return `order_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

exports.createProductCheckout = onRequest(
  { region: 'europe-west1', secrets: [stripeSecretKey], invoker: 'public' },
  async (request, response) => {
    allowCors(response);
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const requestedItems = Array.isArray(request.body?.items) ? request.body.items : [];
      const normalizedItems = requestedItems
        .map(item => ({ id: String(item.id || ''), quantity: Math.max(1, Math.min(20, Math.floor(Number(item.quantity) || 0))) }))
        .filter(item => item.id && item.quantity > 0);
      if (!normalizedItems.length) {
        response.status(400).json({ error: 'Varukorgen är tom.' });
        return;
      }

      const database = admin.firestore();
      const productSnapshots = await Promise.all(normalizedItems.map(item => database.collection('products').doc(item.id).get()));
      const items = [];
      const lineItems = [];
      let allItemsSupportPickup = true;
      productSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) throw new Error('En produkt finns inte längre.');
        const product = snapshot.data();
        const price = Number(product.price);
        if (!product.active || product.outOfStock || !Number.isInteger(price) || price < 5 || !product.name) {
          throw new Error(`Produkten "${product.name || 'okänd'}" kan inte köpas just nu.`);
        }
        if (product.pickupAvailable !== true && product.pickupAvailable !== undefined) allItemsSupportPickup = false;
        const requested = normalizedItems[index];
        items.push({ productId: snapshot.id, name: String(product.name), quantity: requested.quantity, unitPrice: price });
        lineItems.push({
          quantity: requested.quantity,
          price_data: {
            currency: 'sek',
            unit_amount: price * 100,
            product_data: {
              name: String(product.name),
              ...(String(product.description || '').trim() ? { description: String(product.description).trim().slice(0, 500) } : {})
            }
          }
        });
      });

      const orderId = productOrderId();
      await database.collection('orders').doc(orderId).set({
        id: orderId,
        items,
        status: 'pending',
        fulfillment: 'not_selected',
        subtotal: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
        currency: 'SEK',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const stripe = new Stripe(stripeSecretKey.value());
      const siteUrl = 'https://primabilvard.com';
      const fulfillmentOptions = allItemsSupportPickup
        ? [{ label: 'Skickas', value: 'shipping' }, { label: 'Hämtas hos Prima Bilvård', value: 'pickup' }]
        : [{ label: 'Skickas', value: 'shipping' }];
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        client_reference_id: orderId,
        metadata: { orderId },
        customer_creation: 'always',
        billing_address_collection: 'required',
        shipping_address_collection: { allowed_countries: ['SE'] },
        phone_number_collection: { enabled: true },
        custom_fields: [{
          key: 'fulfillment',
          label: { type: 'custom', custom: 'Hur vill du få din beställning?' },
          type: 'dropdown',
          dropdown: { options: fulfillmentOptions }
        }],
        success_url: `${siteUrl}/product-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/product-cancel.html`
      });
      await database.collection('orders').doc(orderId).update({ stripeCheckoutSessionId: session.id });
      response.status(200).json({ url: session.url, sessionId: session.id, amount: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), currency: 'SEK' });
    } catch (error) {
      console.error('Product checkout creation error:', error);
      response.status(400).json({ error: error.message || 'Kassan kunde inte startas.' });
    }
  }
);

// Server-side source of truth for prices/durations, so a client can never dictate what it pays.
const SERVICE_CATALOG = {
  'stripe-test': { small: 1, medium: 1, large: 1 },
  basic: { small: 199, medium: 249, large: 279 },
  'interior-wash': { small: 249, medium: 279, large: 300 },
  premium: { small: 399, medium: 449, large: 479 },
  inout: { small: 1000, medium: 1300, large: 1500 },
  interior: { small: 1500, medium: 1700, large: 1900 },
  full: { small: 2000, medium: 2300, large: 2600 },
  ceramic: { small: 3499, medium: 3799, large: 3999 },
  'tire-change': { small: 500, medium: 500, large: 500 },
  'tire-storage': { small: 750, medium: 750, large: 750 },
  'tire-repair': { small: 200, medium: 200, large: 200 },
  'basic-service': { small: 1800, medium: 1800, large: 1800 },
  'major-service': { small: 3500, medium: 3500, large: 3500 },
  'brake-service': { small: 1200, medium: 1200, large: 1200 },
  'pre-inspection': { small: 1000, medium: 1000, large: 1000 },
  'computer-diagnosis': { small: 600, medium: 600, large: 600 },
  'electrical-diagnosis': { small: 900, medium: 900, large: 900 },
  'engine-diagnosis': { small: 1200, medium: 1200, large: 1200 }
};

const SERVICE_LABELS_MAP = {
  'stripe-test': 'Testköp',
  basic: 'Utvändig Handtvätt',
  'interior-wash': 'Invändig Tvätt',
  premium: 'Komplett In- & Utvändig Tvätt',
  inout: 'In- & Utvändig Tvätt Med Säten',
  interior: 'Hel Glans',
  full: 'Fullservice Rekond',
  ceramic: 'Keramiskt Lackskydd',
  'tire-change': 'Däckbyte',
  'tire-storage': 'Däckhotell',
  'tire-repair': 'Däckreparation',
  'basic-service': 'Basservice',
  'major-service': 'Storservice',
  'brake-service': 'Bromsservice',
  'pre-inspection': 'Förbered Besiktning',
  'computer-diagnosis': 'Datordiagnos',
  'electrical-diagnosis': 'Eldiagnos',
  'engine-diagnosis': 'Motordiagnos'
};

const CAR_SERVICE_IDS = new Set([
  'tire-change', 'tire-storage', 'tire-repair', 'basic-service', 'major-service',
  'brake-service', 'pre-inspection', 'computer-diagnosis', 'electrical-diagnosis', 'engine-diagnosis'
]);

function serviceSupportsSeatAddon(service) {
  return service === 'interior' || service === 'full' || service === 'ceramic';
}

function serviceSupportsAsphaltAddon(service) {
  return service === 'basic' || service === 'premium' || service === 'inout';
}

function getSeatAddonPrice(service, addonType) {
  if (!serviceSupportsSeatAddon(service)) return 0;
  if (service === 'ceramic' && addonType === '2') return 0;
  if (service === 'ceramic' && addonType === '5') return 399;
  const prices = { '2': 399, '3': 399, '5': 699 };
  return prices[addonType] || 0;
}

function getAsphaltAddonPrice(service, size, addonType) {
  if (!serviceSupportsAsphaltAddon(service) || addonType !== 'yes') return 0;
  const prices = { small: 250, medium: 300, large: 350 };
  return prices[size] || 0;
}

function computeBookingPrice(services, size, seatAddon, asphaltAddon) {
  const chosenSize = size || 'small';
  const washService = services.find(id => !CAR_SERVICE_IDS.has(id));
  const base = services.reduce((sum, id) => {
    const prices = SERVICE_CATALOG[id];
    if (!prices) throw new Error(`Okänd tjänst: ${id}`);
    const price = prices[chosenSize] != null ? prices[chosenSize] : prices.small;
    return sum + price;
  }, 0);
  const seatPrice = washService ? getSeatAddonPrice(washService, seatAddon || 'none') : 0;
  const asphaltPrice = washService ? getAsphaltAddonPrice(washService, chosenSize, asphaltAddon || 'none') : 0;
  return base + seatPrice + asphaltPrice;
}

// Combo bookings (wash + car service) have no pre-made Stripe Payment Link, since every
// combination would need its own static link. Instead we create a Checkout Session on
// demand here, recomputing the price server-side so the client can never alter what it pays.
exports.createBookingCheckout = onRequest(
  { region: 'europe-west1', secrets: [stripeSecretKey], invoker: 'public' },
  async (request, response) => {
    allowCors(response);
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const bookingId = String(request.body?.bookingId || '').trim();
      if (!bookingId) throw new Error('Bokning saknas.');

      const database = admin.firestore();
      const pendingRef = database.collection('pendingBookings').doc(bookingId);
      const snapshot = await pendingRef.get();
      if (!snapshot.exists) throw new Error('Bokningen kunde inte hittas.');

      const booking = snapshot.data();
      const services = Array.isArray(booking.services) && booking.services.length
        ? booking.services
        : [booking.service];
      if (!services.length || services.some(id => !SERVICE_CATALOG[id])) {
        throw new Error('Ogiltig tjänst i bokningen.');
      }

      const size = booking.size || 'small';
      const seatAddon = booking.seatAddon || 'none';
      const asphaltAddon = booking.asphaltAddon || 'none';
      const price = computeBookingPrice(services, size, seatAddon, asphaltAddon);
      if (!Number.isInteger(price) || price < 1) throw new Error('Ogiltigt pris för denna bokning.');

      const label = services.map(id => SERVICE_LABELS_MAP[id] || id).join(' + ');

      const stripe = new Stripe(stripeSecretKey.value());
      const siteUrl = 'https://primabilvard.com';
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'sek',
            unit_amount: price * 100,
            product_data: { name: label }
          }
        }],
        client_reference_id: bookingId,
        customer_creation: 'always',
        success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/cancel.html`
      });

      // Store the server-computed price as the authoritative value before Stripe redirects the customer.
      await pendingRef.set({ price, serviceLabel: label, stripeCheckoutSessionId: session.id }, { merge: true });

      response.status(200).json({ url: session.url, sessionId: session.id, amount: price, currency: 'SEK' });
    } catch (error) {
      console.error('Booking checkout creation error:', error);
      response.status(400).json({ error: error.message || 'Betalningen kunde inte startas.' });
    }
  }
);

function availabilityFromBooking(booking) {
  const data = {
    service: booking.service,
    seatAddon: booking.seatAddon || 'none',
    asphaltAddon: booking.asphaltAddon || 'none',
    date: booking.date,
    time: booking.time,
    sortKey: booking.sortKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (Number.isFinite(booking.duration) && booking.duration > 0) data.duration = booking.duration;
  if (Array.isArray(booking.services) && booking.services.length) data.services = booking.services;
  return data;
}

exports.stripeWebhook = onRequest(
  { region: 'europe-west1', secrets: [stripeSecretKey, stripeWebhookSecret, resendApiKey], invoker: 'public' },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }

    const signature = request.headers['stripe-signature'];
    let event;
    try {
      const stripe = new Stripe(stripeSecretKey.value());
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        stripeWebhookSecret.value()
      );
    } catch (error) {
      console.error('Invalid Stripe webhook signature:', error.message);
      response.status(400).send('Invalid webhook signature');
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const bookingId = session.client_reference_id;

      if (session.metadata?.orderId) {
        if (session.payment_status !== 'paid') {
          response.status(200).send('Product payment is not complete');
          return;
        }
        const orderId = String(session.metadata.orderId);
        const database = admin.firestore();
        const orderRef = database.collection('orders').doc(orderId);
        const orderSnapshot = await orderRef.get();
        if (orderSnapshot.exists && orderSnapshot.data().status !== 'paid') {
          const fulfillmentField = (session.custom_fields || []).find(field => field.key === 'fulfillment');
          await orderRef.update({
            status: 'paid',
            customerEmail: session.customer_details?.email || '',
            customerName: session.customer_details?.name || '',
            customerPhone: session.customer_details?.phone || '',
            billingAddress: session.customer_details?.address || null,
            shippingAddress: session.shipping_details?.address || null,
            fulfillment: fulfillmentField?.dropdown?.value || 'not_selected',
            stripePaymentIntentId: session.payment_intent || null,
            paidAt: admin.firestore.FieldValue.serverTimestamp()
          });
          await sendProductOrderNotification({ orderId, ...orderSnapshot.data(), customerEmail: session.customer_details?.email || '' });
        }
        response.status(200).send('Received');
        return;
      }

      if (!bookingId || session.payment_status !== 'paid') {
        response.status(200).send('No paid booking to process');
        return;
      }

      const database = admin.firestore();
      const pendingRef = database.collection('pendingBookings').doc(String(bookingId));
      const bookingRef = database.collection('bookings').doc(String(bookingId));
      const availabilityRef = database.collection('availability').doc(String(bookingId));

      await database.runTransaction(async (transaction) => {
        const pendingSnapshot = await transaction.get(pendingRef);
        if (!pendingSnapshot.exists) return;

        const booking = pendingSnapshot.data();
        transaction.set(bookingRef, {
          ...booking,
          paymentStatus: 'Paid',
          stripeCheckoutSessionId: session.id,
          paidAt: admin.firestore.FieldValue.serverTimestamp()
        });
        transaction.set(availabilityRef, availabilityFromBooking(booking));
        transaction.delete(pendingRef);
      });
    }

    response.status(200).send('Received');
  }
);

async function sendProductOrderNotification(order) {
  let apiKey = '';
  try {
    apiKey = resendApiKey.value();
  } catch (_) {
    console.warn('RESEND_API_KEY is not configured; skipping product order email.');
  }
  if (!apiKey) return;
  const itemLines = (order.items || []).map(item => `${item.quantity} × ${item.name} (${item.unitPrice} kr)`).join('\n');
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Prima Bilvård <onboarding@resend.dev>',
        to: [ownerNotificationEmail.value()],
        subject: `Ny produktorder ${order.id}`,
        text: `Ny betald produktorder\n\nOrder: ${order.id}\nKund: ${order.customerEmail || 'Ej angiven'}\n\n${itemLines}\n\nSumma: ${order.subtotal} kr`
      })
    });
  } catch (error) {
    console.error('Product order notification error:', error);
  }
}