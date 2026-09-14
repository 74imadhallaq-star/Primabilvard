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
      response.status(200).json({ url: session.url });
    } catch (error) {
      console.error('Product checkout creation error:', error);
      response.status(400).json({ error: error.message || 'Kassan kunde inte startas.' });
    }
  }
);

function availabilityFromBooking(booking) {
  return {
    service: booking.service,
    seatAddon: booking.seatAddon || 'none',
    asphaltAddon: booking.asphaltAddon || 'none',
    date: booking.date,
    time: booking.time,
    sortKey: booking.sortKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
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