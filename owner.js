const OWNER_LOGIN_REDIRECT = 'index.html';

const SERVICE_LABELS = {
  'test': 'TEST',
  'basic': 'Utvändig Handtvätt',
  'interior-wash': 'Invändig Tvätt',
  'premium': 'Komplett In- & Utvändig Tvätt',
  'inout': 'In- & Utvändig Tvätt Med Sätten',
  'interior': 'Hel Glans',
  'full': 'Fullservice Rekond'
};

const servicePrices = {
  'test': { small: 1, medium: 1, large: 1 },
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

function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/[&<>\"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
}

function getServiceLabel(service) {
  return SERVICE_LABELS[service] || service || '-';
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
    return true;
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

    const snapshot = await window.db.collection('bookings').get();
    cachedBookings = snapshot.docs.map(doc => doc.data());
    cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  } catch (error) {
    console.error('Firebase bookings load error:', error);
    cachedBookings = [];
    if (error && error.code === 'permission-denied') {
      alert('Ditt admin-konto saknar läsbehörighet till bokningar i Firestore. Uppdatera Firestore-regler så att alla admin-konton kan läsa bookings.');
    }
  }
}

async function saveBooking(booking) {
  if (!canUseFirestore()) throw new Error('Firestore unavailable');

  await window.db.collection('bookings').doc(String(booking.id)).set(booking);
  cachedBookings.push(booking);
  cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
}

async function deleteBooking(id) {
  if (!canUseFirestore()) throw new Error('Firestore unavailable');

  await window.db.collection('bookings').doc(String(id)).delete();
  cachedBookings = cachedBookings.filter(b => String(b.id) !== String(id));
  renderBookingsTable();
}

function renderBookingsTable() {
  const tbody = document.querySelector('#bookingsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!cachedBookings.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding:12px;color:var(--text-secondary);">Inga bokningar</td></tr>';
    return;
  }

  cachedBookings.forEach(b => {
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

  updateStorageStatus();
  await loadBookings();
  await loadBlockedDates();
  await loadBlockedTimes();
  renderBookingsTable();
  renderBlockedDatesList();
  renderBlockedTimesList();

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

      await saveBooking(booking);
      renderBookingsTable();
      ownerManualBookingForm.reset();
      alert('Manuell bokning sparad.');
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
    window.location.href = OWNER_LOGIN_REDIRECT;
  });

  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('Rensa alla bokningar?')) return;

    try {
      const batch = window.db.batch();
      const snapshot = await window.db.collection('bookings').get();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
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
});
