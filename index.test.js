const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class StripeMock {
  constructor() {
    this.checkout = {
      sessions: {
        retrieve: async (sessionId) => {
          if (StripeMock.retrieveError) throw StripeMock.retrieveError;
          return StripeMock.sessions[sessionId] || null;
        },
        create: async () => ({})
      }
    };
    this.webhooks = {
      constructEvent: () => ({})
    };
  }
}
StripeMock.sessions = {};
StripeMock.retrieveError = null;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    return { onRequest: (_options, handler) => handler };
  }
  if (request === 'firebase-functions/params') {
    return {
      defineSecret: () => ({ value: () => 'sk_test' }),
      defineString: (_name, options = {}) => ({ value: () => options.default || '' })
    };
  }
  if (request === 'firebase-admin') {
    return {
      initializeApp: () => {},
      firestore: {
        FieldValue: { serverTimestamp: () => 'timestamp' }
      }
    };
  }
  if (request === 'stripe') {
    return StripeMock;
  }
  return originalLoad(request, parent, isMain);
};

const functions = require('./index.js');
Module._load = originalLoad;

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('getCheckoutConversionSummary responds to OPTIONS', async () => {
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'OPTIONS', body: {} }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
});

test('getCheckoutConversionSummary rejects non-POST methods', async () => {
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'GET', body: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(response.body, { error: 'Method not allowed' });
});

test('getCheckoutConversionSummary requires sessionId', async () => {
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'POST', body: {} }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'sessionId is required.' });
});

test('getCheckoutConversionSummary returns product order summary', async () => {
  StripeMock.sessions = {
    sess_product: {
      payment_status: 'paid',
      amount_total: 24900,
      currency: 'sek',
      metadata: { orderId: 'order_123' },
      client_reference_id: ''
    }
  };
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'POST', body: { sessionId: 'sess_product' } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    transactionId: 'order_123',
    amount: 249,
    currency: 'SEK'
  });
});

test('getCheckoutConversionSummary returns booking summary when bookingId matches session', async () => {
  StripeMock.sessions = {
    sess_booking: {
      payment_status: 'paid',
      amount_total: 39900,
      currency: 'sek',
      metadata: {},
      client_reference_id: 'booking_456'
    }
  };
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'POST', body: { sessionId: 'sess_booking', bookingId: 'booking_456' } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    transactionId: 'booking_456',
    amount: 399,
    currency: 'SEK'
  });
});

test('getCheckoutConversionSummary rejects unpaid sessions', async () => {
  StripeMock.sessions = {
    sess_unpaid: {
      payment_status: 'unpaid',
      amount_total: 39900,
      currency: 'sek',
      metadata: { orderId: 'order_999' },
      client_reference_id: 'booking_999'
    }
  };
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'POST', body: { sessionId: 'sess_unpaid' } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'No paid checkout summary found.' });
});

test('getCheckoutConversionSummary rejects mismatched booking sessions', async () => {
  StripeMock.sessions = {
    sess_mismatch: {
      payment_status: 'paid',
      amount_total: 39900,
      currency: 'sek',
      metadata: {},
      client_reference_id: 'booking_123'
    }
  };
  const response = createResponse();
  await functions.getCheckoutConversionSummary({ method: 'POST', body: { sessionId: 'sess_mismatch', bookingId: 'booking_456' } }, response);
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'No verified checkout summary found.' });
});
