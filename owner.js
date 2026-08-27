const OWNER_LOGIN_REDIRECT = 'index.html';

const SERVICE_LABELS = {
  'basic': 'Utvändig Handtvätt',
  'interior-wash': 'Invändig Tvätt',
  'premium': 'Komplett In- & Utvändig Tvätt',
  'inout': 'In- & Utvändig Tvätt Med Sätten',
  'interior': 'Hel Glans',
  'full': 'Fullservice Rekond',
  'tire-change': 'Däckbyte',
  'tire-storage': 'Däckhotell',
  'tire-repair': 'Däckreparation',
  'basic-service': 'Basservice',
  'major-service': 'Storservice',
  'brake-service': 'Bromsservice',
  'pre-inspection': 'Förbered Besiktning',
  'inspection-fix': 'Åtgärda Besiktningsanmärkningar',
  'computer-diagnosis': 'Datordiagnos',
  'electrical-diagnosis': 'Eldiagnos',
  'engine-diagnosis': 'Motordiagnos',
  'ac-service': 'AC-Service'
};

const WASH_SERVICES = new Set(['basic', 'interior-wash', 'premium', 'inout', 'interior', 'full']);

const OWNER_SESSION_KEY = 'primabilvard_owner_session_v2';
const OWNER_SESSION_MAX_AGE_MS = 5 * 60 * 60 * 1000;
const LEGACY_BOOKINGS_KEY = 'primabilvard_bookings';
const LEGACY_PENDING_BOOKINGS_KEY = 'primabilvard_pendingBookings';

function setOwnerSession() {
  try {
    localStorage.setItem(OWNER_SESSION_KEY, JSON.stringify({ ts: Date.now() }));
  } catch (_) {}
}

function clearOwnerSession() {
  try {
    localStorage.removeItem(OWNER_SESSION_KEY);
  } catch (_) {}
}

function hasValidOwnerSession() {
  try {
    const raw = localStorage.getItem(OWNER_SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return false;
    const age = Date.now() - parsed.ts;
    if (age > OWNER_SESSION_MAX_AGE_MS) {
      localStorage.removeItem(OWNER_SESSION_KEY);
      return false;
    }
    // Sliding expiration while active
    localStorage.setItem(OWNER_SESSION_KEY, JSON.stringify({ ts: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

const servicePrices = {
  'basic': { small: 199, medium: 249, large: 279 },
  'interior-wash': { small: 249, medium: 279, large: 300 },
  'premium': { small: 399, medium: 449, large: 479 },
  'inout': { small: 1000, medium: 1300, large: 1500 },
  'interior': { small: 1500, medium: 1700, large: 1900 },
  'full': { small: 2000, medium: 2300, large: 2600 }
};

let cachedBookings = [];
let blockedDateIds = new Set();
let blockedTimeIds = new Set();

function canUseFirestore() {
  return !!(window.db && typeof window.db.collection === 'function');
}

function canUseAuth() {
  return !!(window.auth && typeof window.auth.signInWithEmailAndPassword === 'function');
}

function readLegacyBookings(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function syncAvailabilityRecords(bookingsResult, pendingResult) {
  const records = new Map();
  [bookingsResult, pendingResult].forEach(result => {
    if (result.status !== 'fulfilled') return;
    result.value.docs.forEach(doc => records.set(String(doc.id), doc.data()));
  });

  const entries = Array.from(records.entries());
  for (let start = 0; start < entries.length; start += 450) {
    const batch = window.db.batch();
    entries.slice(start, start + 450).forEach(([id, booking]) => {
      if (!booking.date || !booking.time || !booking.service) return;
      batch.set(
        window.db.collection('availability').doc(id),
        availabilityFromBooking(booking),
        { merge: true }
      );
    });
    await batch.commit();
  }
}

function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/[&<>\"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
}

function getServiceLabel(service) {
  return SERVICE_LABELS[service] || service || '-';
}

function availabilityFromBooking(booking) {
  return {
    service: booking.service,
    seatAddon: booking.seatAddon || 'none',
    asphaltAddon: booking.asphaltAddon || 'none',
    date: booking.date,
    time: booking.time,
    sortKey: booking.sortKey || 0,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

function getStatusNode() {
  return document.getElementById('storageStatus');
}

function updateStorageStatus() {
  const node = getStatusNode();
  if (!node) return;
  const userEmail = window.auth && window.auth.currentUser ? window.auth.currentUser.email : '';
  if (!canUseAuth() || !canUseFirestore()) {
    node.textContent = 'Firebase backend saknas eller är inte korrekt konfigurerad.';
    return;
  }
  node.textContent = userEmail
    ? `Inloggad som ${userEmail} • Datakälla: Firebase`
    : 'Datakälla: Firebase';
}

function showOwnerLoginOverlay() {
  return new Promise((resolve) => {
    const existing = document.querySelector('.owner-login-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'owner-login-overlay';
    overlay.innerHTML = `
      <div class="owner-login-card" role="dialog" aria-modal="true" aria-label="Ägarinloggning">
        <img src="logo.png" alt="Prima Bilvård" class="owner-login-logo" />
        <h2>Ägarinloggning</h2>
        <p>Logga in med din Firebase e-post och ditt lösenord</p>
        <form class="owner-login-form">
          <input type="email" class="owner-login-input owner-login-email" placeholder="E-post" autocomplete="username" required />
          <input type="password" class="owner-login-input owner-login-password" placeholder="Lösenord" autocomplete="current-password" required style="margin-top:10px;" />
          <div class="owner-login-actions">
            <button type="button" class="owner-login-cancel">Avbryt</button>
            <button type="submit" class="owner-login-submit">Logga in</button>
          </div>
        </form>
      </div>
    `;

    document.body.classList.add('owner-login-active');
    document.body.appendChild(overlay);

    const emailInput = overlay.querySelector('.owner-login-email');
    const passwordInput = overlay.querySelector('.owner-login-password');
    const cancelBtn = overlay.querySelector('.owner-login-cancel');
    const form = overlay.querySelector('.owner-login-form');

    const close = (value) => {
      document.body.classList.remove('owner-login-active');
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => close(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close({
        email: (emailInput.value || '').trim(),
        password: passwordInput.value || ''
      });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    setTimeout(() => emailInput.focus(), 40);
  });
}

function getFirebaseAuthErrorMessage(error) {
  switch (error && error.code) {
    case 'auth/invalid-email':
      return 'E-postadressen är ogiltig.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Fel e-post eller lösenord.';
    case 'auth/too-many-requests':
      return 'För många försök. Vänta en stund och försök igen.';
    case 'auth/network-request-failed':
      return 'Nätverksfel. Kontrollera uppkopplingen och försök igen.';
    default:
      return 'Kunde inte logga in just nu.';
  }
}

async function ensureOwnerAccess() {
  if (!canUseAuth() || !canUseFirestore()) {
    alert('Firebase Auth eller Firestore är inte korrekt laddat på sidan.');
    window.location.href = OWNER_LOGIN_REDIRECT;
    return false;
  }

  if (window.auth.currentUser) {
    if (hasValidOwnerSession()) return true;
    try {
      await window.auth.signOut();
    } catch (_) {}
    clearOwnerSession();
  }

  while (true) {
    const credentials = await showOwnerLoginOverlay();
    if (credentials === null) {
      window.location.href = OWNER_LOGIN_REDIRECT;
      return false;
    }

    if (!credentials.email || !credentials.password) {
      alert('Fyll i både e-post och lösenord.');
      continue;
    }

    try {
      await window.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await window.auth.signInWithEmailAndPassword(credentials.email, credentials.password);
      setOwnerSession();
      alert('✓ Inloggning lyckad!');
      return true;
    } catch (error) {
      console.error('Firebase owner auth error:', error);
      const retry = confirm(`${getFirebaseAuthErrorMessage(error)}\n\nTryck OK för att försöka igen eller Avbryt för att gå tillbaka.`);
      if (!retry) {
        window.location.href = OWNER_LOGIN_REDIRECT;
        return false;
      }
    }
  }
}

function blockedTimeDocId(dateId, time) {
  return `${String(dateId)}_${String(time).replace(':', '-')}`;
}

function blockedTimeKey(dateId, time) {
  return `${String(dateId)}|${String(time)}`;
}

function dateIdToDisplay(dateId) {
  const [y, m, d] = String(dateId).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString('sv-SE');
}

async function loadBlockedDates() {
  try {
    const snapshot = await window.db.collection('blockedDates').get();
    blockedDateIds = new Set(snapshot.docs.map(doc => String(doc.id)));
  } catch (error) {
    console.error('Firebase blockedDates load error:', error);
    blockedDateIds = new Set();
  }
}

async function loadBlockedTimes() {
  try {
    const snapshot = await window.db.collection('blockedTimes').get();
    blockedTimeIds = new Set(
      snapshot.docs.map(doc => {
        const data = doc.data() || {};
        const dateId = String(data.dateId || '').trim();
        const time = String(data.time || '').trim();
        return dateId && time ? blockedTimeKey(dateId, time) : '';
      }).filter(Boolean)
    );
  } catch (error) {
    console.error('Firebase blockedTimes load error:', error);
    blockedTimeIds = new Set();
  }
}

async function loadBookings() {
  try {
    if (!canUseFirestore()) throw new Error('Firestore unavailable');

    const [bookingsResult, pendingResult, availabilityResult] = await Promise.allSettled([
      window.db.collection('bookings').get(),
      window.db.collection('pendingBookings').get(),
      window.db.collection('availability').get()
    ]);

    const bookingsById = new Map();
    if (bookingsResult.status === 'fulfilled') {
      bookingsResult.value.docs.forEach(doc => bookingsById.set(String(doc.id), doc.data()));
    }
    if (pendingResult.status === 'fulfilled') {
      pendingResult.value.docs.forEach(doc => {
        const pendingBooking = doc.data();
        if (!bookingsById.has(String(doc.id))) {
          bookingsById.set(String(doc.id), pendingBooking);
        }
      });
    }
    if (availabilityResult.status === 'fulfilled') {
      availabilityResult.value.docs.forEach(doc => {
        const availabilityBooking = doc.data();
        if (!bookingsById.has(String(doc.id))) {
          bookingsById.set(String(doc.id), availabilityBooking);
        }
      });
    }

    [...readLegacyBookings(LEGACY_BOOKINGS_KEY), ...readLegacyBookings(LEGACY_PENDING_BOOKINGS_KEY)]
      .forEach(legacyBooking => {
        const legacyId = String(legacyBooking.id || '');
        if (legacyId && !bookingsById.has(legacyId)) {
          bookingsById.set(legacyId, legacyBooking);
        }
      });

    if (bookingsResult.status === 'rejected'
      && pendingResult.status === 'rejected'
      && availabilityResult.status === 'rejected') {
      throw bookingsResult.reason;
    }
    if (bookingsResult.status === 'rejected') {
      console.warn('Firebase bookings load error:', bookingsResult.reason);
    }
    if (pendingResult.status === 'rejected') {
      console.warn('Firebase pendingBookings load error:', pendingResult.reason);
    }
    if (availabilityResult.status === 'rejected') {
      console.warn('Firebase availability load error:', availabilityResult.reason);
    }

    try {
      await syncAvailabilityRecords(bookingsResult, pendingResult);
    } catch (error) {
      console.warn('Firebase availability sync error:', error);
    }

    cachedBookings = Array.from(bookingsById.values());
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
  } catch (error) {
    console.error('Firebase bookings load error:', error);
    cachedBookings = [];
    if (error && error.code === 'permission-denied') {
      alert('Ditt konto saknar läsbehörighet till bokningar i Firestore. Kontrollera Firestore-reglerna och publicera den senaste versionen.');
    }
  }
}

async function saveBooking(booking) {
  if (!canUseFirestore()) throw new Error('Firestore unavailable');

  const database = window.db;
  const bookingRef = database.collection('bookings').doc(String(booking.id));
  const availabilityRef = database.collection('availability').doc(String(booking.id));
  await database.runTransaction(async (transaction) => {
    transaction.set(bookingRef, booking);
    transaction.set(availabilityRef, availabilityFromBooking(booking));
  });
  cachedBookings.push(booking);
  cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
}

async function deleteBooking(id) {
  if (!canUseFirestore()) throw new Error('Firestore unavailable');

  await window.db.collection('bookings').doc(String(id)).delete();
  await window.db.collection('availability').doc(String(id)).delete();
  cachedBookings = cachedBookings.filter(b => String(b.id) !== String(id));
  renderBookingsTable();
}

function renderBookingsTable() {
  const tbody = document.querySelector('#bookingsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const typeFilter = document.getElementById('bookingTypeFilter')?.value || 'all';
  const statusFilter = document.getElementById('bookingStatusFilter')?.value || 'all';
  const filteredBookings = cachedBookings.filter((booking) => {
    const service = String(booking.service || '').trim();
    const paymentStatus = String(booking.paymentStatus || 'Pending').trim().toLowerCase();

    if (typeFilter === 'wash' && !WASH_SERVICES.has(service)) return false;
    if (typeFilter === 'service' && WASH_SERVICES.has(service)) return false;
    if (statusFilter !== 'all' && paymentStatus !== statusFilter.trim().toLowerCase()) return false;
    return true;
  });

  if (!filteredBookings.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:12px;color:var(--text-secondary);">Inga bokningar matchar filtret</td></tr>';
    return;
  }

  filteredBookings.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.name)}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.email || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.phone || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.registration || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(getServiceLabel(b.service))}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.size || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.date || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.time || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);"><span style="background:#3d3d00;padding:4px 8px;border-radius:4px;font-size:0.85rem;">${escapeHtml(b.paymentStatus || 'Pending')} - ${b.price ? b.price + ' kr' : '-'}</span></td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${b.pickup ? ('🚗 ' + escapeHtml(b.pickupAddress || '-')) : '-'}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);"><button class="delete-btn" data-id="${b.id}" style="background:#aa3333;padding:6px 10px;border-radius:6px;border:none;color:#fff;cursor:pointer;">Ta bort</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBooking(btn.dataset.id));
  });
}

function renderBlockedDatesList() {
  const list = document.getElementById('blockedDatesList');
  if (!list) return;
  list.innerHTML = '';
  const sorted = Array.from(blockedDateIds).sort((a, b) => a.localeCompare(b));
  if (!sorted.length) {
    list.innerHTML = '<li style="color:var(--text-secondary);">Inga blockerade datum</li>';
    return;
  }
  sorted.forEach(dateId => {
    const li = document.createElement('li');
    li.textContent = `${dateIdToDisplay(dateId)} (${dateId})`;
    list.appendChild(li);
  });
}

function renderBlockedTimesList() {
  const list = document.getElementById('blockedTimesList');
  if (!list) return;
  list.innerHTML = '';
  const sorted = Array.from(blockedTimeIds).sort((a, b) => a.localeCompare(b));
  if (!sorted.length) {
    list.innerHTML = '<li style="color:var(--text-secondary);">Inga blockerade tider</li>';
    return;
  }
  sorted.forEach(entry => {
    const [dateId, time] = String(entry).split('|');
    const li = document.createElement('li');
    li.textContent = `${dateIdToDisplay(dateId)} kl ${time}`;
    list.appendChild(li);
  });
}

async function addBlockedDate(dateId) {
  if (!dateId) return;
  if (!canUseFirestore()) throw new Error('Firestore unavailable');
  await window.db.collection('blockedDates').doc(String(dateId)).set({ dateId: String(dateId), createdAt: Date.now() });
  blockedDateIds.add(String(dateId));
}

async function removeBlockedDate(dateId) {
  if (!dateId) return;
  if (!canUseFirestore()) throw new Error('Firestore unavailable');
  await window.db.collection('blockedDates').doc(String(dateId)).delete();
  blockedDateIds.delete(String(dateId));
}

async function addBlockedTime(dateId, time) {
  if (!dateId || !time) return;
  if (!canUseFirestore()) throw new Error('Firestore unavailable');
  await window.db.collection('blockedTimes').doc(blockedTimeDocId(dateId, time)).set({ dateId: String(dateId), time: String(time), createdAt: Date.now() });
  blockedTimeIds.add(blockedTimeKey(dateId, time));
}

async function removeBlockedTime(dateId, time) {
  if (!dateId || !time) return;
  if (!canUseFirestore()) throw new Error('Firestore unavailable');
  await window.db.collection('blockedTimes').doc(blockedTimeDocId(dateId, time)).delete();
  blockedTimeIds.delete(blockedTimeKey(dateId, time));
}

function exportCSV() {
  if (!cachedBookings.length) { alert('Inga bokningar att exportera.'); return; }
  let csv = 'Namn,E-post,Telefon,Registreringsnummer,Tjänst,Storlek,Pris,Datum,Tid,Betalningsstatus\n';
  cachedBookings.forEach(b => {
    const safe = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    csv += [safe(b.name), safe(b.email), safe(b.phone), safe(b.registration), safe(getServiceLabel(b.service)), safe(b.size), safe(b.price), safe(b.date), safe(b.time), safe(b.paymentStatus || 'Pending')].join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bookings.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', async () => {
  document.body.classList.remove('owner-login-active');
  document.querySelectorAll('.owner-login-overlay').forEach(el => el.remove());

  const ok = await ensureOwnerAccess();
  if (!ok) return;

  const ownerSection = document.querySelector('.owner-section');
  if (ownerSection) ownerSection.style.display = 'block';

  // Keep manual booking above bookings without rewriting the whole HTML.
  const sectionCards = ownerSection ? ownerSection.querySelectorAll(':scope > div') : [];
  if (sectionCards.length >= 3) {
    const manualCard = sectionCards[2];
    const bookingsCard = sectionCards[1];
    if (manualCard && bookingsCard && manualCard.contains(document.getElementById('ownerManualBookingForm'))) {
      ownerSection.insertBefore(manualCard, bookingsCard);
    }
  }

  const bookingsToggle = document.getElementById('ownerBookingsToggle');
  const bookingsContent = document.getElementById('ownerBookingsContent');
  const bookingsChevron = document.getElementById('ownerBookingsChevron');
  if (bookingsToggle && bookingsContent && bookingsChevron) {
    bookingsToggle.addEventListener('click', () => {
      const isCollapsed = bookingsContent.style.maxHeight === '0px';
      bookingsContent.style.maxHeight = isCollapsed ? '3000px' : '0px';
      bookingsContent.style.opacity = isCollapsed ? '1' : '0';
      bookingsChevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
    });
  }

  updateStorageStatus();
  await loadBookings();
  await loadBlockedDates();
  await loadBlockedTimes();
  renderBookingsTable();
  renderBlockedDatesList();
  renderBlockedTimesList();

  document.getElementById('bookingTypeFilter')?.addEventListener('change', renderBookingsTable);
  document.getElementById('bookingStatusFilter')?.addEventListener('change', renderBookingsTable);

  const ownerManualBookingForm = document.getElementById('ownerManualBookingForm');
  if (ownerManualBookingForm) {
    ownerManualBookingForm.addEventListener('submit', async function(e) {
      e.preventDefault();

      const name = (document.getElementById('ownerName')?.value || '').trim();
      const phone = (document.getElementById('ownerPhone')?.value || '').trim();
      const email = (document.getElementById('ownerEmail')?.value || '').trim();
      const registration = (document.getElementById('ownerReg')?.value || '').trim();
      const service = document.getElementById('ownerService')?.value || '';
      const size = document.getElementById('ownerSize')?.value || '';
      const dateId = document.getElementById('ownerDate')?.value || '';
      const time = document.getElementById('ownerTime')?.value || '';
      const priceInput = document.getElementById('ownerPrice')?.value || '';
      const paymentStatus = document.getElementById('ownerPaymentStatus')?.value || 'Manuell (Telefon)';

      if (!name || !phone || !service || !size || !dateId || !time) {
        alert('Fyll i alla obligatoriska fält.');
        return;
      }

      const [y, m, d] = dateId.split('-').map(Number);
      const bookingDate = new Date(y, (m || 1) - 1, d || 1);
      const dateSv = bookingDate.toLocaleDateString('sv-SE');

      if (blockedDateIds.has(dateId) || blockedTimeIds.has(blockedTimeKey(dateId, time))) {
        alert('Datum/tid är blockerad.');
        return;
      }

      const computedPrice = priceInput !== ''
        ? Math.max(0, Number(priceInput))
        : ((servicePrices[service] && servicePrices[service][size]) || 0);

      const sortKey = new Date(
        bookingDate.getFullYear(),
        bookingDate.getMonth(),
        bookingDate.getDate(),
        parseInt(time.split(':')[0], 10),
        parseInt(time.split(':')[1] || '0', 10)
      ).getTime();

      const booking = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        name,
        email,
        phone,
        registration,
        service,
        seatAddon: 'none',
        asphaltAddon: 'none',
        addonLabel: '',
        seatAddonPrice: 0,
        seatAddonMinutes: 0,
        asphaltAddonPrice: 0,
        asphaltAddonMinutes: 0,
        size,
        date: dateSv,
        time,
        price: computedPrice,
        paymentStatus,
        sortKey,
        source: 'owner-manual'
      };

      try {
        await saveBooking(booking);
        renderBookingsTable();
        ownerManualBookingForm.reset();
        alert('Manuell bokning sparad.');
      } catch (error) {
        console.error('Firebase manual booking save error:', error);
        alert(error && error.code === 'permission-denied'
          ? 'Bokningen kunde inte sparas. Kontrollera att du är inloggad och att de senaste Firestore-reglerna är deployade.'
          : 'Kunde inte spara manuell bokning just nu.');
      }
    });
  }

  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);

  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', async () => {
    try {
      if (window.auth) await window.auth.signOut();
    } catch (error) {
      console.error('Firebase sign-out error:', error);
    }
    clearOwnerSession();
    window.location.href = OWNER_LOGIN_REDIRECT;
  });

  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('Rensa alla bokningar?')) return;

    try {
      const batch = window.db.batch();
      const snapshot = await window.db.collection('bookings').get();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      const availabilitySnapshot = await window.db.collection('availability').get();
      availabilitySnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.error('Firebase clear error:', e);
      alert('Kunde inte rensa bokningar just nu.');
      return;
    }

    cachedBookings = [];
    renderBookingsTable();
    alert('Bokningar rensade');
  });

  const addBlockedDateBtn = document.getElementById('addBlockedDateBtn');
  const removeBlockedDateBtn = document.getElementById('removeBlockedDateBtn');
  const blockDateInput = document.getElementById('blockDateInput');

  if (addBlockedDateBtn) addBlockedDateBtn.addEventListener('click', async () => {
    const dateId = blockDateInput ? blockDateInput.value : '';
    if (!dateId) return alert('Välj ett datum.');
    try {
      await addBlockedDate(dateId);
      renderBlockedDatesList();
      alert('Datum blockerat.');
    } catch (e) {
      console.error(e);
      alert('Kunde inte blockera datum.');
    }
  });

  if (removeBlockedDateBtn) removeBlockedDateBtn.addEventListener('click', async () => {
    const dateId = blockDateInput ? blockDateInput.value : '';
    if (!dateId) return alert('Välj ett datum.');
    try {
      await removeBlockedDate(dateId);
      renderBlockedDatesList();
      alert('Blockering borttagen.');
    } catch (e) {
      console.error(e);
      alert('Kunde inte ta bort blockering.');
    }
  });

  const addBlockedTimeBtn = document.getElementById('addBlockedTimeBtn');
  const removeBlockedTimeBtn = document.getElementById('removeBlockedTimeBtn');
  const blockTimeDateInput = document.getElementById('blockTimeDateInput');
  const blockTimeInput = document.getElementById('blockTimeInput');

  if (addBlockedTimeBtn) addBlockedTimeBtn.addEventListener('click', async () => {
    const dateId = blockTimeDateInput ? blockTimeDateInput.value : '';
    const time = blockTimeInput ? blockTimeInput.value : '';
    if (!dateId || !time) return alert('Välj både datum och tid.');
    try {
      await addBlockedTime(dateId, time);
      renderBlockedTimesList();
      alert('Tid blockerad.');
    } catch (e) {
      console.error(e);
      alert('Kunde inte blockera tid.');
    }
  });

  if (removeBlockedTimeBtn) removeBlockedTimeBtn.addEventListener('click', async () => {
    const dateId = blockTimeDateInput ? blockTimeDateInput.value : '';
    const time = blockTimeInput ? blockTimeInput.value : '';
    if (!dateId || !time) return alert('Välj både datum och tid.');
    try {
      await removeBlockedTime(dateId, time);
      renderBlockedTimesList();
      alert('Tidsblockering borttagen.');
    } catch (e) {
      console.error(e);
      alert('Kunde inte ta bort tidsblockering.');
    }
  });

  // ===== AD CONFIGURATION SYSTEM =====
  ensureAdStyles();
  await loadAdConfigFromFirebase();
  renderAdConfigControls();
  if (shouldShowAdOnLoad()) {
    showAdPopup(adConfig.html);
  }
});

// ===== AD CONFIGURATION FUNCTIONS =====
let adConfig = {
  enabled: false,
  html: '',
  maxPerDay: 1,
  showOnLoad: false
};

const LOCAL_STORAGE_KEYS_AD = {
  adConfig: 'primabilvard_adConfig',
  adStats: 'primabilvard_adStats'
};

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readAdConfigLocal() {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEYS_AD.adConfig);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    console.error('Error reading ad config from localStorage:', e);
    return null;
  }
}

function writeAdConfigLocal(config) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEYS_AD.adConfig, JSON.stringify(config));
  } catch (e) {
    console.error('Error writing ad config to localStorage:', e);
  }
}

function readAdStats() {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEYS_AD.adStats);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Error reading ad stats from localStorage:', e);
    return {};
  }
}

function writeAdStats(stats) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEYS_AD.adStats, JSON.stringify(stats));
  } catch (e) {
    console.error('Error writing ad stats to localStorage:', e);
  }
}

function getAdCountToday() {
  const stats = readAdStats();
  const todayKey = getTodayKey();
  return stats[todayKey] || 0;
}

function incrementAdCount() {
  const stats = readAdStats();
  const todayKey = getTodayKey();
  stats[todayKey] = (stats[todayKey] || 0) + 1;
  writeAdStats(stats);
  return stats[todayKey];
}

function shouldShowAdOnLoad() {
  if (!adConfig.enabled || !adConfig.html) return false;
  if (!adConfig.showOnLoad) return false;
  const count = getAdCountToday();
  return count < adConfig.maxPerDay;
}

async function loadAdConfigFromFirebase() {
  try {
    if (canUseFirestore() && window.db) {
      const doc = await window.db.collection('settings').doc('adConfig').get();
      if (doc.exists) {
        adConfig = { ...adConfig, ...doc.data() };
        writeAdConfigLocal(adConfig);
        updateAdConfigUI();
        return;
      }
    }
  } catch (e) {
    console.error('Error loading ad config from Firebase:', e);
  }
  // Fallback to localStorage
  const local = readAdConfigLocal();
  if (local) {
    adConfig = { ...adConfig, ...local };
    updateAdConfigUI();
  }
}

async function saveAdConfigToFirebase() {
  writeAdConfigLocal(adConfig);
  try {
    if (canUseFirestore() && window.db) {
      await window.db.collection('settings').doc('adConfig').set(adConfig, { merge: true });
    }
  } catch (e) {
    console.error('Error saving ad config to Firebase:', e);
  }
}

function updateAdConfigUI() {
  const htmlField = document.getElementById('ownerAdHtml');
  const enabledCheck = document.getElementById('ownerAdEnabled');
  const maxPerDayField = document.getElementById('ownerAdMaxPerDay');
  const showOnLoadCheck = document.getElementById('ownerAdShowOnLoad');

  if (htmlField) htmlField.value = adConfig.html || '';
  if (enabledCheck) enabledCheck.checked = adConfig.enabled;
  if (maxPerDayField) maxPerDayField.value = adConfig.maxPerDay || 1;
  if (showOnLoadCheck) showOnLoadCheck.checked = adConfig.showOnLoad;
}

function showAdPopup(html, isPreview = false) {
  if (!html) return;

  if (!isPreview) {
    const count = incrementAdCount();
    if (count > adConfig.maxPerDay) {
      console.log('Ad daily quota reached');
      return;
    }
  }

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'ad-popup-overlay';
  
  // Create card
  const card = document.createElement('div');
  card.className = 'ad-popup-card';
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ad-popup-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => overlay.remove());
  
  // Content
  const body = document.createElement('div');
  body.className = 'ad-popup-body';
  body.innerHTML = html;
  
  card.appendChild(closeBtn);
  card.appendChild(body);
  overlay.appendChild(card);
  
  // Close on background click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  
  document.body.appendChild(overlay);
}

function ensureAdStyles() {
  if (document.getElementById('ad-popup-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'ad-popup-styles';
  style.textContent = `
    .ad-popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.25s ease-out;
      padding: 20px;
      backdrop-filter: blur(2px);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .ad-popup-card {
      position: relative;
      width: 100%;
      max-width: 300px;
      height: auto;
      overflow: hidden;
      animation: bounceIn 0.5s ease-out;
      display: flex;
      flex-direction: column;
    }

    @keyframes bounceIn {
      0% {
        opacity: 0;
        transform: scale(0.3) translateY(30px);
      }
      50% {
        transform: scale(1.05);
      }
      70% {
        transform: scale(0.95);
      }
      100% {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .ad-popup-image-wrapper {
      position: relative;
      width: 100%;
      margin-bottom: 0;
      perspective: 1000px;
    }

    .ad-popup-body img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 40px rgba(90, 122, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
    }

    .ad-popup-content-wrapper {
      background: linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%);
      padding: 16px 14px;
      border-radius: 0 0 12px 12px;
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.6);
      flex-grow: 1;
      display: flex;
      flex-direction: column;
    }

    .ad-popup-body {
      color: #1a1a1a;
      margin: 0;
      padding: 0;
    }

    .ad-popup-body h1,
    .ad-popup-body h2,
    .ad-popup-body h3 {
      margin: 0 0 10px 0;
      font-size: 1.3rem;
      color: #000;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .ad-popup-body p {
      margin: 0 0 12px 0;
      line-height: 1.6;
      font-size: 0.95rem;
      color: #666;
    }

    .ad-popup-body a {
      color: #5a7aff;
      text-decoration: none;
      font-weight: 600;
      transition: color 0.2s;
    }

    .ad-popup-body a:hover {
      color: #3d5aff;
      text-decoration: underline;
    }

    .ad-popup-body button {
      background: linear-gradient(135deg, #2f2f2f 0%, #1a1a1a 100%);
      color: white;
      border: none;
      padding: 14px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.95rem;
      text-transform: uppercase;
      margin-top: 16px;
      transition: all 0.3s;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      letter-spacing: 0.5px;
      width: 100%;
    }

    .ad-popup-body button:hover {
      background: linear-gradient(135deg, #5a7aff 0%, #3d5aff 100%);
      transform: translateY(-4px);
      box-shadow: 0 12px 35px rgba(90, 122, 255, 0.5);
    }

    .ad-popup-body button:active {
      transform: translateY(-2px);
    }

    .ad-popup-price-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }

    .ad-popup-price-current {
      font-size: 1.8rem;
      font-weight: 700;
      color: #2f2f2f;
      margin: 8px 0;
    }

    .ad-popup-price-old {
      color: #999;
      text-decoration: line-through;
      font-size: 0.95rem;
      margin-top: 4px;
    }

    .ad-popup-discount {
      color: #d32f2f;
      font-weight: 600;
      font-size: 0.9rem;
      margin-top: 8px;
    }

    .ad-popup-close {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(90, 122, 255, 0.9);
      backdrop-filter: blur(10px);
      border: 2px solid white;
      color: #fff;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      z-index: 10002;
      transition: all 0.25s ease;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(90, 122, 255, 0.3);
    }

    .ad-popup-close:hover {
      background: rgba(90, 122, 255, 1);
      transform: scale(1.15) rotate(90deg);
      box-shadow: 0 8px 25px rgba(90, 122, 255, 0.5);
    }
  `;
  document.head.appendChild(style);
}

function renderAdConfigControls() {
  const saveBtn = document.getElementById('saveAdConfigBtn');
  const showBtn = document.getElementById('showAdNowBtn');
  const generateBtn = document.getElementById('generateAdBtn');
  const htmlField = document.getElementById('ownerAdHtml');
  const enabledCheck = document.getElementById('ownerAdEnabled');
  const maxPerDayField = document.getElementById('ownerAdMaxPerDay');
  const showOnLoadCheck = document.getElementById('ownerAdShowOnLoad');
  const imageInput = document.getElementById('ownerAdImage');
  const imageDropZone = document.getElementById('imageDropZone');
  const textField = document.getElementById('ownerAdText');

  updateAdConfigUI();

  // Image upload handler
  if (imageInput) {
    imageInput.addEventListener('change', handleImageUpload);
  }

  // Drag and drop handler
  if (imageDropZone) {
    imageDropZone.addEventListener('click', () => imageInput?.click());
    
    imageDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      imageDropZone.style.background = '#1a1a1a';
      imageDropZone.style.borderColor = 'var(--text-primary)';
    });
    
    imageDropZone.addEventListener('dragleave', () => {
      imageDropZone.style.background = '#0a0a0a';
      imageDropZone.style.borderColor = 'var(--border)';
    });
    
    imageDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      imageDropZone.style.background = '#0a0a0a';
      imageDropZone.style.borderColor = 'var(--border)';
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        imageInput.files = files;
        handleImageUpload();
      }
    });
  }

  // Generate button
  if (generateBtn) {
    generateBtn.addEventListener('click', generateAdFromImageAndText);
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async function() {
      // adConfig.html är redan satt av generateAdFromImageAndText()
      adConfig.enabled = enabledCheck ? enabledCheck.checked : false;
      adConfig.maxPerDay = maxPerDayField ? parseInt(maxPerDayField.value, 10) || 1 : 1;
      adConfig.showOnLoad = showOnLoadCheck ? showOnLoadCheck.checked : false;
      
      await saveAdConfigToFirebase();
      alert('Annons inställningar sparade!');
    });
  }

  if (showBtn) {
    showBtn.addEventListener('click', function() {
      const currentHtml = adConfig.html || '';
      
      console.log('Preview clicked. HTML:', currentHtml);
      
      if (!currentHtml) {
        alert('Skapa en annons från bild och text först');
        return;
      }
      showAdPopup(currentHtml, true);
    });
  }
}

function handleImageUpload() {
  const imageInput = document.getElementById('ownerAdImage');
  const imagePreview = document.getElementById('imagePreview');
  const file = imageInput?.files?.[0];
  
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    window.currentAdImageData = e.target.result;
    
    if (imagePreview) {
      imagePreview.innerHTML = `
        <img src="${e.target.result}" style="max-width:100%;max-height:150px;border-radius:6px;" alt="Preview" />
        <p style="margin:8px 0 0 0;color:var(--text-primary);font-size:0.85rem;">✓ Bild laddat</p>
      `;
    }
  };
  reader.readAsDataURL(file);
}

function generateAdFromImageAndText() {
  const imageData = window.currentAdImageData;
  const textField = document.getElementById('ownerAdText');
  const serviceField = document.getElementById('ownerAdService');
  const currentPriceField = document.getElementById('ownerAdCurrentPrice');
  const oldPriceField = document.getElementById('ownerAdOldPrice');
  const buttonTextField = document.getElementById('ownerAdButtonText');
  
  const textContent = textField ? textField.value.trim() : '';
  const service = serviceField ? serviceField.value : '';
  const currentPrice = currentPriceField ? parseInt(currentPriceField.value, 10) : 0;
  const oldPrice = oldPriceField ? parseInt(oldPriceField.value, 10) : 0;
  const buttonText = buttonTextField ? buttonTextField.value.trim() : 'Boka nu';
  
  // Get service name from dropdown
  let serviceName = '';
  if (service && serviceField) {
    const selectedOption = serviceField.querySelector(`option[value="${service}"]`);
    serviceName = selectedOption ? selectedOption.textContent : '';
  }
  
  if (!imageData && !textContent) {
    alert('Ladda upp en bild eller skriv text först');
    return;
  }
  
  let html = '';
  
  if (imageData) {
    html += `<img src="${imageData}" alt="Annons" style="max-width:100%;height:auto;border-radius:8px;margin-bottom:16px;" />`;
  }
  
  // Lägg till tjänstnamn om det finns
  if (serviceName) {
    html += `<div style="margin:0 0 8px 0;padding:12px 12px;background:#1a1a1a;border:2px solid #5a7aff;border-radius:8px;"><h3 style="margin:0;color:#ffffff;font-size:0.95rem;font-weight:700;">${escapeHtmlForAd(serviceName)}</h3></div>`;
  }
  
  // Lägg till pris och text tillsammans om det finns pris
  if (currentPrice > 0) {
    let priceTextHtml = `<div style="margin:0 0 0 0;padding:12px;background:#1a1a1a;border:2px solid #5a7aff;border-radius:8px;">`;
    
    // Pris
    priceTextHtml += `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:${textContent ? '8px' : '0'};">`;
    priceTextHtml += `<span style="font-size:1.6rem;font-weight:700;color:#4caf50;">${currentPrice} kr</span>`;
    
    if (oldPrice > currentPrice) {
      const discount = Math.round(((oldPrice - currentPrice) / oldPrice) * 100);
      priceTextHtml += `<span style="font-size:0.85rem;color:#d32f2f;text-decoration:line-through;font-weight:700;">${oldPrice}</span>`;
      priceTextHtml += `<span style="background:#d32f2f;color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;font-weight:700;margin-left:auto;">-${discount}%</span>`;
    }
    priceTextHtml += `</div>`;
    
    // Text under priset
    if (textContent) {
      priceTextHtml += `<p style="margin:0;color:#ffffff;line-height:1.4;font-size:0.85rem;">${escapeHtmlForAd(textContent)}</p>`;
    }
    
    priceTextHtml += `</div>`;
    html += priceTextHtml;
  }
  
  // Lägg till knapp om det finns tjänst
  if (service) {
    html += `<button onclick="window.location.href='index.html?service=${encodeURIComponent(service)}';" style="width:100%;cursor:pointer;background:linear-gradient(135deg, #5a7aff 0%, #3d5aff 100%);color:white;border:none;padding:12px 16px;border-radius:6px;font-weight:700;font-size:0.9rem;text-transform:uppercase;margin-top:12px;transition:all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);box-shadow:0 6px 20px rgba(90, 122, 255, 0.35);letter-spacing:0.5px;">🛒 ${escapeHtmlForAd(buttonText)}</button>`;
  }
  
  const htmlField = document.getElementById('ownerAdHtml');
  if (htmlField) {
    htmlField.value = html;
  }
  
  adConfig.html = html;
  alert('✓ Annons skapad! Du kan nu spara eller förhandsgranska den.');
}

function escapeHtmlForAd(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function scrollToBookingAndSelectService(service) {
  // Stäng eventuell popup
  const overlay = document.querySelector('.ad-popup-overlay');
  if (overlay) overlay.remove();
  
  // Scrolla till booking sektion
  const bookingSection = document.getElementById('booking');
  if (bookingSection) {
    bookingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  // Väl tjänsten automatiskt
  const serviceCards = document.querySelectorAll('.service-card');
  serviceCards.forEach(card => {
    const dataService = card.getAttribute('data-service');
    if (dataService === service) {
      card.style.border = '3px solid #5a7aff';
      card.style.boxShadow = '0 0 20px rgba(90, 122, 255, 0.5)';
      
      // Setta den som selected
      window.selectedService = service;
      window.selectedSize = card.querySelector('.card-size')?.value;
      
      // Scroll till service kort
      setTimeout(() => {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    } else {
      card.style.border = '';
      card.style.boxShadow = '';
    }
  });
}
