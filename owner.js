const OWNER_ACCESS_CONFIG = {
  codeHashSha256: 'eca285b5a4a15ad8fabcf65748d80fdcb774c1920623fe1ea4aa2a4f6d2a95e5',
  fallbackPlainCode: 'Mido0762367753',
  maxAttempts: 5,
  lockoutMs: 10 * 60 * 1000,
  authSessionMs: 3 * 60 * 60 * 1000
};

const OWNER_KEYS = {
  attempts: 'primabilvard_owner_failedAttempts',
  lockedUntil: 'primabilvard_owner_lockedUntil',
  authUntil: 'primabilvard_owner_authenticatedUntil'
};

const LOCAL_STORAGE_KEYS = {
  bookings: 'primabilvard_bookings',
  blockedDates: 'primabilvard_blockedDates',
  blockedTimes: 'primabilvard_blockedTimes'
};

const SERVICE_LABELS = {
  'basic': 'Utvändig Handtvätt',
  'interior-wash': 'Invändig Tvätt',
  'premium': 'Komplett In- & Utvändig Tvätt',
  'inout': 'In- & Utvändig Tvätt Med Sätten',
  'interior': 'Hel Glans',
  'full': 'Fullservice Rekond'
};

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

function readLocalArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalArray(key, arr) {
  localStorage.setItem(key, JSON.stringify(Array.isArray(arr) ? arr : []));
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
  node.textContent = canUseFirestore()
    ? 'Datakälla: Firebase (online)'
    : 'Datakälla: Lokal lagring i denna webbläsare (offline fallback)';
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function sha256Hex(text) {
  if (!window.crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new Error('WebCrypto unavailable');
  }
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyOwnerCode(inputCode) {
  const normalizedInput = String(inputCode ?? '');
  try {
    const hash = await sha256Hex(normalizedInput);
    return timingSafeEqual(hash, OWNER_ACCESS_CONFIG.codeHashSha256);
  } catch (e) {
    console.warn('WebCrypto saknas, använder fallback-verifiering:', e);
    return timingSafeEqual(normalizedInput, OWNER_ACCESS_CONFIG.fallbackPlainCode);
  }
}

function getNum(key, fallback = 0) {
  const val = Number(localStorage.getItem(key));
  return Number.isFinite(val) ? val : fallback;
}

function setNum(key, value) {
  localStorage.setItem(key, String(value));
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
        <p>Ange kod för att fortsätta</p>
        <form class="owner-login-form">
          <input type="password" class="owner-login-input" placeholder="Ägarkod" autocomplete="current-password" required />
          <div class="owner-login-actions">
            <button type="button" class="owner-login-cancel">Avbryt</button>
            <button type="submit" class="owner-login-submit">Logga in</button>
          </div>
        </form>
      </div>
    `;

    document.body.classList.add('owner-login-active');
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.owner-login-input');
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
      close((input.value || '').trim());
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    setTimeout(() => input.focus(), 40);
  });
}

async function ensureOwnerAccess() {
  const now = Date.now();
  const authUntil = getNum(OWNER_KEYS.authUntil, 0);
  if (authUntil > now) return true;

  const lockedUntil = getNum(OWNER_KEYS.lockedUntil, 0);
  if (lockedUntil > now) {
    const secondsLeft = Math.ceil((lockedUntil - now) / 1000);
    alert(`För många försök. Vänta ${secondsLeft} sekunder.`);
    window.location.href = 'index.html';
    return false;
  }

  const code = await showOwnerLoginOverlay();
  if (code === null) {
    window.location.href = 'index.html';
    return false;
  }

  const isValid = await verifyOwnerCode(code);
  if (isValid) {
    setNum(OWNER_KEYS.attempts, 0);
    setNum(OWNER_KEYS.authUntil, Date.now() + OWNER_ACCESS_CONFIG.authSessionMs);
    alert('✓ Inloggning lyckad!');
    return true;
  }

  let failedAttempts = getNum(OWNER_KEYS.attempts, 0) + 1;
  if (failedAttempts >= OWNER_ACCESS_CONFIG.maxAttempts) {
    failedAttempts = 0;
    setNum(OWNER_KEYS.attempts, failedAttempts);
    setNum(OWNER_KEYS.lockedUntil, Date.now() + OWNER_ACCESS_CONFIG.lockoutMs);
    alert('✗ För många felaktiga försök. Åtkomst är låst i 10 minuter.');
  } else {
    setNum(OWNER_KEYS.attempts, failedAttempts);
    const remaining = OWNER_ACCESS_CONFIG.maxAttempts - failedAttempts;
    alert(`✗ Felaktig kod. ${remaining} försök kvar.`);
  }

  window.location.href = 'index.html';
  return false;
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
  if (!canUseFirestore()) {
    blockedDateIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedDates).map(v => String(v)));
    return;
  }
  try {
    const snapshot = await window.db.collection('blockedDates').get();
    blockedDateIds = new Set(snapshot.docs.map(doc => String(doc.id)));
    writeLocalArray(LOCAL_STORAGE_KEYS.blockedDates, Array.from(blockedDateIds));
  } catch {
    blockedDateIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedDates).map(v => String(v)));
  }
}

async function loadBlockedTimes() {
  if (!canUseFirestore()) {
    blockedTimeIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedTimes).map(v => String(v)).filter(Boolean));
    return;
  }
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
    writeLocalArray(LOCAL_STORAGE_KEYS.blockedTimes, Array.from(blockedTimeIds));
  } catch {
    blockedTimeIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedTimes).map(v => String(v)).filter(Boolean));
  }
}

async function loadBookings() {
  if (!canUseFirestore()) {
    cachedBookings = readLocalArray(LOCAL_STORAGE_KEYS.bookings);
    cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
    return;
  }
  try {
    const snapshot = await window.db.collection('bookings').get();
    cachedBookings = snapshot.docs.map(doc => doc.data());
    cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  } catch {
    cachedBookings = readLocalArray(LOCAL_STORAGE_KEYS.bookings);
    cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  }
}

async function saveBooking(booking) {
  if (canUseFirestore()) {
    try {
      await window.db.collection('bookings').doc(String(booking.id)).set(booking);
    } catch (e) {
      console.error('Firebase save booking error:', e);
    }
  }
  cachedBookings.push(booking);
  cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
}

async function deleteBooking(id) {
  if (canUseFirestore()) {
    try {
      await window.db.collection('bookings').doc(String(id)).delete();
    } catch (e) {
      console.error('Firebase delete booking error:', e);
    }
  }
  cachedBookings = cachedBookings.filter(b => String(b.id) !== String(id));
  writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
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
  if (canUseFirestore()) {
    await window.db.collection('blockedDates').doc(String(dateId)).set({ dateId: String(dateId), createdAt: Date.now() });
  }
  blockedDateIds.add(String(dateId));
  writeLocalArray(LOCAL_STORAGE_KEYS.blockedDates, Array.from(blockedDateIds));
}

async function removeBlockedDate(dateId) {
  if (!dateId) return;
  if (canUseFirestore()) {
    await window.db.collection('blockedDates').doc(String(dateId)).delete();
  }
  blockedDateIds.delete(String(dateId));
  writeLocalArray(LOCAL_STORAGE_KEYS.blockedDates, Array.from(blockedDateIds));
}

async function addBlockedTime(dateId, time) {
  if (!dateId || !time) return;
  if (canUseFirestore()) {
    await window.db.collection('blockedTimes').doc(blockedTimeDocId(dateId, time)).set({ dateId: String(dateId), time: String(time), createdAt: Date.now() });
  }
  blockedTimeIds.add(blockedTimeKey(dateId, time));
  writeLocalArray(LOCAL_STORAGE_KEYS.blockedTimes, Array.from(blockedTimeIds));
}

async function removeBlockedTime(dateId, time) {
  if (!dateId || !time) return;
  if (canUseFirestore()) {
    await window.db.collection('blockedTimes').doc(blockedTimeDocId(dateId, time)).delete();
  }
  blockedTimeIds.delete(blockedTimeKey(dateId, time));
  writeLocalArray(LOCAL_STORAGE_KEYS.blockedTimes, Array.from(blockedTimeIds));
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
  const ok = await ensureOwnerAccess();
  if (!ok) return;

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

  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('Rensa alla bokningar?')) return;

    if (canUseFirestore()) {
      try {
        const batch = window.db.batch();
        const snapshot = await window.db.collection('bookings').get();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      } catch (e) {
        console.error('Firebase clear error:', e);
      }
    }

    cachedBookings = [];
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
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
