const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

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
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
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