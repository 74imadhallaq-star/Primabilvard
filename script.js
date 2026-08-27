// ===== MOBILE HAMBURGER MENU =====
(function() {
  const hamburger = document.getElementById('hamburger');
  const navMenu = document.getElementById('navMenu');
  const navOverlay = document.getElementById('navOverlay');

  function openMenu() {
    hamburger.classList.add('open');
    navMenu.classList.add('open');
    navOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    hamburger.classList.remove('open');
    navMenu.classList.remove('open');
    navOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.contains('open') ? closeMenu() : openMenu();
    });
  }

  if (navOverlay) {
    navOverlay.addEventListener('click', closeMenu);
  }

  // Close menu when a nav link is clicked
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', closeMenu);
  });
})();

// ===== CALENDAR FUNCTIONALITY =====

let currentDate = new Date();
let selectedDate = null;
let selectedTime = null;
const MAX_CONCURRENT_BOOKINGS = 2;
const SLOT_STEP_MINUTES = 30;

// ===== OWNER ACCESS SECURITY (client-side hardening) =====
// NOTE: On a static frontend this is only a deterrent, not true security.
// For real security, use Firebase Auth + Firestore rules.
const OWNER_ACCESS_CONFIG = {
  // SHA-256 hash of owner code (case-sensitive)
  codeHashSha256: 'eca285b5a4a15ad8fabcf65748d80fdcb774c1920623fe1ea4aa2a4f6d2a95e5',
  // Fallback only when crypto.subtle is unavailable (e.g. file:// in Safari)
  fallbackPlainCode: 'Mido0762367753',
  maxAttempts: 5,
  lockoutMs: 10 * 60 * 1000,
  authSessionMs: 3 * 60 * 60 * 1000
};

const ownerAccessState = {
  failedAttempts: 0,
  lockedUntil: 0,
  authenticatedUntil: 0
};

function isOwnerTemporarilyLocked() {
  return Date.now() < ownerAccessState.lockedUntil;
}

function isOwnerAuthenticated() {
  // Check in-memory session (same page visit)
  if (Date.now() < ownerAccessState.authenticatedUntil) return true;
  // Check persisted 5-hour localStorage session (survives refresh)
  if (window.ownerSession && window.ownerSession.isValid()) {
    // Restore in-memory state too
    ownerAccessState.authenticatedUntil = Date.now() + OWNER_ACCESS_CONFIG.authSessionMs;
    return true;
  }
  return false;
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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
        <p>Ange kod för att öppna adminpanelen</p>
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

const DEFAULT_SERVICE_DURATIONS = {
  'stripe-test': 30,
  'basic': 20,
  'interior-wash': 40,
  'premium': 100,
  'inout': 240,
  'interior': 180,
  'full': 210,
  // Car service durations
  'tire-change': 30,
  'tire-storage': 15,
  'tire-repair': 20,
  'basic-service': 60,
  'major-service': 150,
  'brake-service': 90,
  'pre-inspection': 45,
  'inspection-fix': 60,
  'computer-diagnosis': 30,
  'electrical-diagnosis': 60,
  'engine-diagnosis': 90
};
let serviceDurations = { ...DEFAULT_SERVICE_DURATIONS };

const SERVICE_LABELS = {
  'stripe-test': 'Testköp',
  'basic': 'Utvändig Handtvätt',
  'interior-wash': 'Invändig Tvätt',
  'premium': 'Komplett In- & Utvändig Tvätt',
  'inout': 'In- & Utvändig Tvätt Med Sätten',
  'interior': 'Hel Glans',
  'full': 'Fullservice Rekond',
  // Car service labels
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
  'engine-diagnosis': 'Motordiagnos'
};

// Global list of bilservice (non-wash) services
const SERVICE_SERVICES = ['tire-change', 'tire-storage', 'tire-repair', 'basic-service', 'major-service', 'brake-service', 'pre-inspection', 'inspection-fix', 'computer-diagnosis', 'electrical-diagnosis', 'engine-diagnosis'];

const SEAT_ADDON_OPTIONS = {
  none: { label: 'Ingen', price: 0, minutes: 0 },
  '2': { label: '2 säten', price: 399, minutes: 150 },
  '5': { label: '5 säten', price: 699, minutes: 210 }
};

const ASPHALT_ADDON_OPTIONS = {
  none: { label: 'Ingen', minutes: 0, pricesBySize: { small: 0, medium: 0, large: 0 } },
  yes: { label: 'Asfaltrengöring', minutes: 30, pricesBySize: { small: 250, medium: 300, large: 350 } }
};

function serviceSupportsSeatAddon(service) {
  return service === 'interior' || service === 'full';
}

function serviceSupportsAsphaltAddon(service) {
  return service === 'basic' || service === 'premium' || service === 'inout';
}

function getSelectedSeatAddon() {
  const active = document.querySelector('#seatAddonButtons .addon-btn.active');
  return active ? active.dataset.addon : 'none';
}

function getSelectedAsphaltAddon() {
  const active = document.querySelector('#asphaltAddonButtons .addon-btn.active');
  return active ? active.dataset.addon : 'none';
}

function getSeatAddonInfo(addonType) {
  return SEAT_ADDON_OPTIONS[addonType] || SEAT_ADDON_OPTIONS.none;
}

function getSeatAddonPrice(service, addonType) {
  if (!serviceSupportsSeatAddon(service)) return 0;
  return getSeatAddonInfo(addonType).price;
}

function getSeatAddonMinutes(service, addonType) {
  if (!serviceSupportsSeatAddon(service)) return 0;
  return getSeatAddonInfo(addonType).minutes;
}

function getSeatAddonLabel(service, addonType) {
  if (!serviceSupportsSeatAddon(service) || !addonType || addonType === 'none') return '';
  return `Tvätt av ${getSeatAddonInfo(addonType).label}`;
}

function getAsphaltAddonInfo(addonType) {
  return ASPHALT_ADDON_OPTIONS[addonType] || ASPHALT_ADDON_OPTIONS.none;
}

function getAsphaltAddonPrice(service, size, addonType) {
  if (!serviceSupportsAsphaltAddon(service)) return 0;
  const selectedSize = size || 'small';
  const info = getAsphaltAddonInfo(addonType);
  return (info.pricesBySize && info.pricesBySize[selectedSize]) || 0;
}

function getAsphaltAddonMinutes(service, addonType) {
  if (!serviceSupportsAsphaltAddon(service)) return 0;
  return getAsphaltAddonInfo(addonType).minutes;
}

function getAsphaltAddonLabel(service, addonType) {
  if (!serviceSupportsAsphaltAddon(service) || !addonType || addonType === 'none') return '';
  return getAsphaltAddonInfo(addonType).label;
}

function getSelectedService() {
  const serviceInput = document.getElementById('service');
  return serviceInput ? serviceInput.value : '';
}

function isExteriorOnlyService(service) {
  return service === 'basic';
}

function isInteriorService(service) {
  return !!service && !isExteriorOnlyService(service);
}

function getOpeningHours(date) {
  const day = date.getDay(); // 0=Sun,1=Mon,...6=Sat
  if (day === 0) return null; // Söndag stängt
  if (closedDays.includes(day)) return null;
  if (isDateBlocked(date)) return null;
  if (day === 6) return { startHour: 10, endHour: 16 }; // Lördag
  return { startHour: 8, endHour: 18 }; // Mån-fre
}

function getBookingsForDate(date) {
  const dateString = date.toLocaleDateString('sv-SE');
  return loadBookings().filter(b => b.date === dateString).map(b => {
    const start = slotToMinutes(b.time);
    return {
      ...b,
      start,
      end: start + bookingDuration(b.service, b.seatAddon || 'none', b.asphaltAddon || 'none')
    };
  });
}

// Funktion för att boka tjänst direkt
function setSeatAddonSelection(addonType = 'none') {
  const target = addonType || 'none';
  document.querySelectorAll('#seatAddonButtons .addon-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.addon === target);
  });
}

function setAsphaltAddonSelection(addonType = 'none') {
  const target = addonType || 'none';
  document.querySelectorAll('#asphaltAddonButtons .addon-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.addon === target);
  });
}

function bookService(serviceId, chosenSize, chosenSeatAddon = 'none', chosenAsphaltAddon = 'none') {
  document.dispatchEvent(new CustomEvent('serviceCardSelected', {
    detail: {
      service: serviceId,
      size: chosenSize || 'small',
      seatAddon: chosenSeatAddon || 'none',
      asphaltAddon: chosenAsphaltAddon || 'none'
    }
  }));
  document.getElementById('booking').scrollIntoView({ behavior: 'smooth' });
}

// Available hours for booking (08:00 - 18:00, 1 hour slots)
// time slots will be generated based on day and step
function generateTimeSlots(startHour, endHour, stepMinutes) {
  const slots = [];
  let minutes = startHour * 60;
  const end = endHour * 60;
  while (minutes <= end - stepMinutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    minutes += stepMinutes;
  }
  return slots;
}

let availableHours = [];


// Days that are closed by weekday (empty array means all weekdays are available)
const closedDays = [];

// Specific blocked dates managed by owner panel (YYYY-MM-DD)
let blockedDateIds = new Set();
// Specific blocked times managed by owner panel (key: YYYY-MM-DD|HH:MM)
let blockedTimeIds = new Set();

const LOCAL_STORAGE_KEYS = {
  bookings: 'primabilvard_bookings',
  pendingBookings: 'primabilvard_pendingBookings',
  blockedDates: 'primabilvard_blockedDates',
  blockedTimes: 'primabilvard_blockedTimes'
};

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
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(arr) ? arr : []));
  } catch (e) {
    console.error('LocalStorage write error:', e);
  }
}

function toDateId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateIdToDisplay(dateId) {
  const [y, m, d] = String(dateId).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString('sv-SE');
}

function isDateBlocked(date) {
  return blockedDateIds.has(toDateId(date));
}

function blockedTimeKey(dateId, time) {
  return `${String(dateId)}|${String(time)}`;
}

function blockedTimeDocId(dateId, time) {
  return `${String(dateId)}_${String(time).replace(':', '-')}`;
}

function isTimeBlocked(date, time) {
  return blockedTimeIds.has(blockedTimeKey(toDateId(date), time));
}

async function loadBlockedDatesFromFirebase() {
  if (!canUseFirestore()) {
    blockedDateIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedDates).map(v => String(v)));
    return;
  }
  try {
    const snapshot = await window.db.collection('blockedDates').get();
    blockedDateIds = new Set(snapshot.docs.map(doc => String(doc.id)));
  } catch (e) {
    console.error('Firebase blockedDates load error:', e);
    blockedDateIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedDates).map(v => String(v)));
  }
}

async function loadBlockedTimesFromFirebase() {
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
        if (dateId && time) return blockedTimeKey(dateId, time);

        const [fallbackDate, fallbackTimeRaw] = String(doc.id).split('_');
        const fallbackTime = String(fallbackTimeRaw || '').replace('-', ':');
        return blockedTimeKey(fallbackDate || '', fallbackTime || '');
      }).filter(v => v && !v.startsWith('|') && !v.endsWith('|'))
    );
  } catch (e) {
    console.error('Firebase blockedTimes load error:', e);
    blockedTimeIds = new Set(readLocalArray(LOCAL_STORAGE_KEYS.blockedTimes).map(v => String(v)).filter(Boolean));
  }
}

function renderBlockedDatesList() {
  const list = document.getElementById('blockedDatesList');
  if (!list) return;
  list.innerHTML = '';

  const sorted = Array.from(blockedDateIds).sort((a, b) => a.localeCompare(b));
  if (!sorted.length) {
    const li = document.createElement('li');
    li.textContent = 'Inga blockerade datum';
    li.style.color = 'var(--text-secondary)';
    list.appendChild(li);
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
    const li = document.createElement('li');
    li.textContent = 'Inga blockerade tider';
    li.style.color = 'var(--text-secondary)';
    list.appendChild(li);
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
    await window.db.collection('blockedDates').doc(String(dateId)).set({
      dateId: String(dateId),
      createdAt: Date.now()
    });
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
    await window.db.collection('blockedTimes').doc(blockedTimeDocId(dateId, time)).set({
      dateId: String(dateId),
      time: String(time),
      createdAt: Date.now()
    });
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

// Initialize calendar
function initCalendar() {
  renderCalendar();
  updateMonthYear();
  updateCalendarHint();
}

// Update month/year display
function updateMonthYear() {
  const months = [
    'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
    'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
  ];
  const monthYear = document.getElementById('monthYear');
  monthYear.textContent = `${months[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
}

// Render calendar
function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const selectedService = getSelectedService();
  const selectedSeatAddon = getSelectedSeatAddon();
  const selectedAsphaltAddon = getSelectedAsphaltAddon();
  
  // First day of month (convert JS Sunday-first to Monday-first index)
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  // Last day of month
  const lastDate = new Date(year, month + 1, 0).getDate();
  // Last day of previous month
  const lastDatePrev = new Date(year, month, 0).getDate();
  
  const calendarDays = document.getElementById('calendarDays');
  calendarDays.innerHTML = '';
  
  // Previous month's days
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = document.createElement('div');
    day.className = 'day other-month';
    day.textContent = lastDatePrev - i;
    calendarDays.appendChild(day);
  }
  
  // Current month's days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let date = 1; date <= lastDate; date++) {
    const day = document.createElement('div');
    const dayDate = new Date(year, month, date);
    const isBlocked = isDateBlocked(dayDate);
    const openingHours = getOpeningHours(dayDate);
    
    // Check if date is in the past
    if (dayDate < today) {
      day.className = 'day past';
      day.textContent = date;
    }
    // Check if specific date is blocked by owner
    else if (isBlocked) {
      day.className = 'day unavailable-date';
      day.textContent = date;
      day.title = 'Detta datum är blockerat av ägaren';
    }
    // Check if day is closed
    else if (!openingHours) {
      day.className = 'day';
      day.textContent = date;
    }
    // Must choose service first
    else if (!selectedService) {
      day.className = 'day locked';
      day.textContent = date;
    }
    // Check if day has at least one available time for selected service
    else if (!hasAnyAvailableSlot(dayDate, selectedService, selectedSeatAddon, selectedAsphaltAddon)) {
      day.className = 'day unavailable-date';
      day.textContent = date;
    }
    // Available for booking
    else {
      day.className = 'day available';
      day.textContent = date;
      day.addEventListener('click', () => selectDate(dayDate, day));
    }
    
    calendarDays.appendChild(day);
  }
  
  // Next month's days
  const totalCells = calendarDays.children.length;
  const remainingCells = 42 - totalCells;
  for (let date = 1; date <= remainingCells; date++) {
    const day = document.createElement('div');
    day.className = 'day other-month';
    day.textContent = date;
    calendarDays.appendChild(day);
  }
}

// Select a date
function selectDate(date, element) {
  const selectedService = getSelectedService();
  if (!selectedService) {
    alert('Välj tjänst först för att se tillgängliga datum och tider.');
    return;
  }

  // Remove previous selection
  document.querySelectorAll('.day.selected').forEach(el => {
    el.classList.remove('selected');
    el.classList.add('available');
  });
  
  // Add selection
  element.classList.remove('available');
  element.classList.add('selected');
  
  selectedDate = date;
  showTimeSlots(date);
}

// Show available time slots
function showTimeSlots(date) {
  const timesSection = document.getElementById('timesSection');
  const selectedDateSpan = document.getElementById('selectedDate');
  const timeSlots = document.getElementById('timeSlots');
  const selectedService = getSelectedService();
  const selectedSeatAddon = getSelectedSeatAddon();
  const selectedAsphaltAddon = getSelectedAsphaltAddon();

  if (!selectedService) {
    timesSection.style.display = 'none';
    return;
  }
  
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateString = date.toLocaleDateString('sv-SE', options);
  selectedDateSpan.textContent = dateString;
  
  // determine slots for this date based on selected service duration
  timeSlots.innerHTML = '';
  availableHours = getTimeSlotsForService(date, selectedService, selectedSeatAddon, selectedAsphaltAddon);

  if (!availableHours.length) {
    const noTimes = document.createElement('p');
    noTimes.className = 'slot-info';
    noTimes.textContent = 'Inga tider tillgängliga för vald tjänst denna dag.';
    timeSlots.appendChild(noTimes);
    timesSection.style.display = 'block';
    return;
  }

  availableHours.forEach(hour => {
    const slot = document.createElement('div');
    slot.className = 'time-slot';
    slot.textContent = hour;
    if (isSlotAvailable(date, hour, selectedService, selectedSeatAddon, selectedAsphaltAddon)) {
      slot.addEventListener('click', () => selectTime(hour, slot));
    } else {
      slot.classList.add('unavailable');
    }
    timeSlots.appendChild(slot);
  });
  
  timesSection.style.display = 'block';
}

// Select time
function selectTime(time, element) {
  // Remove previous selection
  document.querySelectorAll('.time-slot.selected').forEach(el => {
    el.classList.remove('selected');
  });
  
  // Add selection
  element.classList.add('selected');
  selectedTime = time;
}

// Previous month
const prevMonthBtn = document.getElementById('prevMonth');
if (prevMonthBtn) {
  prevMonthBtn.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
    updateMonthYear();
  });
}

// Next month
const nextMonthBtn = document.getElementById('nextMonth');
if (nextMonthBtn) {
  nextMonthBtn.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
    updateMonthYear();
  });
}

// convert HH:MM to minutes past midnight
function slotToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// duration in minutes based on service type
function bookingDuration(service, seatAddonType = 'none', asphaltAddonType = 'none') {
  const base = serviceDurations[service] || DEFAULT_SERVICE_DURATIONS[service] || 100;
  return base + getSeatAddonMinutes(service, seatAddonType) + getAsphaltAddonMinutes(service, asphaltAddonType);
}

function parseDurationTextToMinutes(text) {
  if (!text) return null;
  const normalized = text
    .toLowerCase()
    .replace(',', '.')
    .replace(/\s+/g, ' ')
    .trim();

  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*timm/);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    if (!Number.isNaN(hours)) return Math.round(hours * 60);
  }

  const minuteMatch = normalized.match(/(\d+)\s*min/);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    if (!Number.isNaN(minutes)) return minutes;
  }

  return null;
}

function loadServiceDurationsFromCards() {
  const cards = document.querySelectorAll('.service-card[data-service]');
  if (!cards.length) return;

  cards.forEach(card => {
    const serviceId = card.dataset.service;
    if (!serviceId) return;

    const timeNode = Array.from(card.querySelectorAll('p')).find(p =>
      p.textContent && p.textContent.toLowerCase().includes('tid:')
    );

    const parsed = parseDurationTextToMinutes(timeNode ? timeNode.textContent : '');
    if (parsed) serviceDurations[serviceId] = parsed;
  });
}

function isCapacityAvailable(bookings, requestStart, requestEnd) {
  for (let minute = requestStart; minute < requestEnd; minute++) {
    let overlapping = 0;
    bookings.forEach(b => {
      if (minute >= b.start && minute < b.end) overlapping++;
    });

    if (overlapping >= MAX_CONCURRENT_BOOKINGS) return false;
  }

  return true;
}

function getTimeSlotsForService(date, service, seatAddonType = 'none', asphaltAddonType = 'none') {
  const hours = getOpeningHours(date);
  if (!hours) return [];
  const duration = bookingDuration(service, seatAddonType, asphaltAddonType);
  const slots = [];
  let minutes = hours.startHour * 60;
  const end = hours.endHour * 60;

  while (minutes <= end - duration) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    minutes += SLOT_STEP_MINUTES;
  }

  return slots;
}

function hasAnyAvailableSlot(date, service, seatAddonType = 'none', asphaltAddonType = 'none') {
  const slots = getTimeSlotsForService(date, service, seatAddonType, asphaltAddonType);
  return slots.some(time => isSlotAvailable(date, time, service, seatAddonType, asphaltAddonType));
}

// check if a given slot is available according to existing bookings
function isSlotAvailable(date, time, requestedService, seatAddonType = 'none', asphaltAddonType = 'none') {
  if (!requestedService) return false;

  if (isTimeBlocked(date, time)) return false;

  const hours = getOpeningHours(date);
  if (!hours) return false;

  const bookings = getBookingsForDate(date);

  const requestStart = slotToMinutes(time);
  const requestDuration = bookingDuration(requestedService, seatAddonType, asphaltAddonType);
  const requestEnd = requestStart + requestDuration;

  // On current day: don't allow times that already passed
  const now = new Date();
  if (isSameCalendarDay(date, now)) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (requestStart < nowMinutes) return false;
  }

  // must fit in opening hours
  if (requestStart < hours.startHour * 60 || requestEnd > hours.endHour * 60) return false;

  // Global rule: max 2 samtidiga bokningar (alla tjänster), baserat på faktisk tidsåtgång
  if (!isCapacityAvailable(bookings, requestStart, requestEnd)) return false;

  return true;
}

function resetDateTimeSelection() {
  selectedDate = null;
  selectedTime = null;
  const timesSection = document.getElementById('timesSection');
  if (timesSection) timesSection.style.display = 'none';
}

function updateCalendarHint() {
  const hint = document.getElementById('calendarHint');
  if (!hint) return;

  const service = getSelectedService();
  if (!service) {
    hint.textContent = 'Välj tjänst först för att se möjliga datum och tider.';
    return;
  }

  const seatAddonType = getSelectedSeatAddon();
  const asphaltAddonType = getSelectedAsphaltAddon();
  const seatAddonLabel = getSeatAddonLabel(service, seatAddonType);
  const asphaltAddonLabel = getAsphaltAddonLabel(service, asphaltAddonType);
  const extraParts = [seatAddonLabel, asphaltAddonLabel].filter(Boolean);
  const duration = bookingDuration(service, seatAddonType, asphaltAddonType);
  const serviceLabel = SERVICE_LABELS[service] || service;
  hint.textContent = `Vald tjänst: ${serviceLabel}${extraParts.length ? ` + ${extraParts.join(' + ')}` : ''}. Tidsåtgång: ca ${duration} minuter. Starttider visas var ${SLOT_STEP_MINUTES}:e minut och max 2 bokningar kan pågå samtidigt.`;
}

function updateSeatAddonVisibility() {
  const group = document.getElementById('seatAddonGroup');
  if (!group) return;
  const help = document.getElementById('seatAddonHelp');
  const buttons = document.querySelectorAll('#seatAddonButtons .addon-btn');

  const service = getSelectedService();
  const show = serviceSupportsSeatAddon(service);
  group.style.display = 'block';

  buttons.forEach(btn => {
    btn.disabled = !show;
  });

  if (help) {
    help.textContent = show
      ? 'Tillval aktivt för vald tjänst.'
      : 'Välj Hel Glans eller Fullservice Rekond för att aktivera tillval.';
  }

  if (!show) {
    const active = document.querySelector('#seatAddonButtons .addon-btn.active');
    if (active) active.classList.remove('active');
    const noneBtn = document.querySelector('#seatAddonButtons .addon-btn[data-addon="none"]');
    if (noneBtn) noneBtn.classList.add('active');
  }
}

function updateAsphaltAddonVisibility() {
  const group = document.getElementById('asphaltAddonGroup');
  if (!group) return;
  const help = document.getElementById('asphaltAddonHelp');
  const buttons = document.querySelectorAll('#asphaltAddonButtons .addon-btn');

  const service = getSelectedService();
  const show = serviceSupportsAsphaltAddon(service);
  group.style.display = 'block';

  buttons.forEach(btn => {
    btn.disabled = !show;
  });

  if (help) {
    help.textContent = show
      ? 'Tillval aktivt för vald tjänst. Pris: +250 kr (Liten), +300 kr (Mellan), +350 kr (Stor).'
      : 'Välj Utvändig Handtvätt, Komplett In- & Utvändig Tvätt eller In- & Utvändig Tvätt Med Sätten för att aktivera tillval.';
  }

  if (!show) {
    const active = document.querySelector('#asphaltAddonButtons .addon-btn.active');
    if (active) active.classList.remove('active');
    const noneBtn = document.querySelector('#asphaltAddonButtons .addon-btn[data-addon="none"]');
    if (noneBtn) noneBtn.classList.add('active');
  }
}

function handleSeatAddonChange() {
  updatePriceDisplay();
  resetDateTimeSelection();
  renderCalendar();
  updateCalendarHint();
}

function handleAsphaltAddonChange() {
  updatePriceDisplay();
  resetDateTimeSelection();
  renderCalendar();
  updateCalendarHint();
}

function handleServiceChange() {
  updateSeatAddonVisibility();
  updateAsphaltAddonVisibility();
  updatePriceDisplay();
  resetDateTimeSelection();
  renderCalendar();
  updateCalendarHint();
}

// Scroll to services section
const bookBtn = document.getElementById('bookBtn');
if (bookBtn) {
  bookBtn.addEventListener('click', () => {
    const servicesSection = document.getElementById('services');
    if (servicesSection) servicesSection.scrollIntoView({ behavior: 'smooth' });
  });
}

// Service prices by size
const servicePrices = {
  'stripe-test': { small: 1, medium: 1, large: 1 },
  'basic': { small: 199, medium: 249, large: 279 },
  'interior-wash': { small: 249, medium: 279, large: 300 },
  'premium': { small: 399, medium: 449, large: 479 },
  'inout': { small: 1000, medium: 1300, large: 1500 },
  'interior': { small: 1500, medium: 1700, large: 1900 },
  'full': { small: 2000, medium: 2300, large: 2600 },
  // Car service prices (fixed prices, not size-dependent but we use 'small' for consistency)
  'tire-change': { small: 500, medium: 500, large: 500 },
  'tire-storage': { small: 750, medium: 750, large: 750 },
  'tire-repair': { small: 200, medium: 200, large: 200 },
  'basic-service': { small: 1800, medium: 1800, large: 1800 },
  'major-service': { small: 3500, medium: 3500, large: 3500 },
  'brake-service': { small: 1200, medium: 1200, large: 1200 },
  'pre-inspection': { small: 1000, medium: 1000, large: 1000 },
  'inspection-fix': { small: 0, medium: 0, large: 0 }, // Custom quote
  'computer-diagnosis': { small: 600, medium: 600, large: 600 },
  'electrical-diagnosis': { small: 900, medium: 900, large: 900 },
  'engine-diagnosis': { small: 1200, medium: 1200, large: 1200 }
};

// Stripe Payment Links per kombination (lägg till fler länkar här)
const STRIPE_PAYMENT_LINKS = {
  // Invändig Tvätt - Liten
  'interior-wash|small|none|none': 'https://buy.stripe.com/cNifZj0J20o421P35Zasg00',
  // Invändig Tvätt - Mellan
  'interior-wash|medium|none|none': 'https://buy.stripe.com/28E9AVfDWdaQfSFayrasg01',
  // Invändig Tvätt - Stor
  'interior-wash|large|none|none': 'https://buy.stripe.com/eVq6oJ3Veb2I9uh35Zasg02',
  // Utvändig Handtvätt - Liten
  'basic|small|none|none': 'https://buy.stripe.com/eVqdRbfDWc6MdKx6ibasg03',
  // Utvändig Handtvätt - Liten + Asfaltrengöring
  'basic|small|none|yes': 'https://buy.stripe.com/eVqdRbcrKfiY5e1cGzasg0i',
  // Utvändig Handtvätt - Mellan
  'basic|medium|none|none': 'https://buy.stripe.com/8x2cN71N6gn26i5dKDasg04',
  // Utvändig Handtvätt - Mellan + Asfaltrengöring
  'basic|medium|none|yes': 'https://buy.stripe.com/5kQdRbgI0fiY21P6ibasg0j',
  // Utvändig Handtvätt - Stor
  'basic|large|none|none': 'https://buy.stripe.com/14AdRb3Ve7Qw5e121Vasg05',
  // Utvändig Handtvätt - Stor + Asfaltrengöring
  'basic|large|none|yes': 'https://buy.stripe.com/3cI5kFfDW4EkdKx0XRasg0k',
  // Komplett In- & Utvändig Tvätt - Liten
  'premium|small|none|none': 'https://buy.stripe.com/fZu14pcrK1s8eOB8qjasg06',
  // Komplett In- & Utvändig Tvätt - Liten + Asfaltrengöring
  'premium|small|none|yes': 'https://buy.stripe.com/7sYbJ38bugn2dKx4a3asg0l',
  // Komplett In- & Utvändig Tvätt - Mellan
  'premium|medium|none|none': 'https://buy.stripe.com/6oUfZj8bu6Ms6i59unasg07',
  // Komplett In- & Utvändig Tvätt - Mellan + Asfaltrengöring
  'premium|medium|none|yes': 'https://buy.stripe.com/aFadRb8bu9YE8qd35Zasg0m',
  // Komplett In- & Utvändig Tvätt - Stor
  'premium|large|none|none': 'https://buy.stripe.com/5kQ8wRajC5IogWJgWPasg08',
  // Komplett In- & Utvändig Tvätt - Stor + Asfaltrengöring
  'premium|large|none|yes': 'https://buy.stripe.com/9B6dRbfDW5IogWJgWPasg0n',
  // In- & Utvändig Tvätt Med Sätten - Liten
  'inout|small|none|none': 'https://buy.stripe.com/eVqfZjfDW3Ag7m9dKDasg09',
  // In- & Utvändig Tvätt Med Sätten - Liten + Asfaltrengöring
  'inout|small|none|yes': 'https://buy.stripe.com/eVqcN78bu1s8dKx8qjasg0o',
  // In- & Utvändig Tvätt Med Sätten - Mellan
  'inout|medium|none|none': 'https://buy.stripe.com/cNi3cx0J20o4eOBfSLasg0a',
  // In- & Utvändig Tvätt Med Sätten - Mellan + Asfaltrengöring
  'inout|medium|none|yes': 'https://buy.stripe.com/00waEZ8buc6M0XLgWPasg0p',
  // In- & Utvändig Tvätt Med Sätten - Stor
  'inout|large|none|none': 'https://buy.stripe.com/aFa00l9fy3AgdKx21Vasg0b',
  // In- & Utvändig Tvätt Med Sätten - Stor + Asfaltrengöring
  'inout|large|none|yes': 'https://buy.stripe.com/3cIaEZfDW1s88qd4a3asg0q',
  // Hel Glans - Liten
  'interior|small|none|none': 'https://buy.stripe.com/3cIbJ3ajCgn26i56ibasg0c',
  // Hel Glans - Liten + 2-Säten
  'interior|small|2|none': 'https://buy.stripe.com/00wfZj1N62wcfSF0XRasg0r',
  // Hel Glans - Liten + 5-Säten
  'interior|small|5|none': 'https://buy.stripe.com/28E5kF9fy3Ag35T21Vasg0w',
  // Hel Glans - Mellan
  'interior|medium|none|none': 'https://buy.stripe.com/fZu9AV77q8UAgWJayrasg0d',
  // Hel Glans - Mellan + 2-Säten
  'interior|medium|2|none': 'https://buy.stripe.com/cNi14p2Ra2wcgWJ7mfasg0s',
  // Hel Glans - Mellan + 5-Säten
  'interior|medium|5|none': 'https://buy.stripe.com/9B69AVcrKc6M35T35Zasg0v',
  // Hel Glans - Stor
  'interior|large|none|none': 'https://buy.stripe.com/7sYbJ377q0o421PdKDasg0e',
  // Hel Glans - Stor + 2-Säten
  'interior|large|2|none': 'https://buy.stripe.com/dRm9AV77q4EkbCp21Vasg0t',
  // Hel Glans - Stor + 5-Säten
  'interior|large|5|none': 'https://buy.stripe.com/8x2cN7dvOgn235T8qjasg0u',
  // Fullservice Rekond - Liten
  'full|small|none|none': 'https://buy.stripe.com/7sYaEZgI09YEcGtgWPasg0f',
  // Fullservice Rekond - Liten + 2-Säten
  'full|small|2|none': 'https://buy.stripe.com/aFafZjcrK5IobCp8qjasg0x',
  // Fullservice Rekond - Liten + 5-Säten
  'full|small|5|none': 'https://buy.stripe.com/fZu3cxajC0o40XLdKDasg0C',
  // Fullservice Rekond - Mellan
  'full|medium|none|none': 'https://buy.stripe.com/9B64gBezS7Qw49X5e7asg0g',
  // Fullservice Rekond - Mellan + 2-Säten
  'full|medium|2|none': 'https://buy.stripe.com/28E6oJ77q7QwfSF8qjasg0y',
  // Fullservice Rekond - Mellan + 5-Säten
  'full|medium|5|none': 'https://buy.stripe.com/fZu00lfDW4Ek6i5dKDasg0B',
  // Fullservice Rekond - Stor
    'full|large|none|none': 'https://buy.stripe.com/dRmfZj3VefiY49X8qjasg0h',
    // Fullservice Rekond - Stor + 2-Säten
  'full|large|2|none': 'https://buy.stripe.com/dRmeVf9fy0o4fSFeOHasg0z',
  // Fullservice Rekond - Stor + 5-Säten
  'full|large|5|none': 'https://buy.stripe.com/00wdRb9fy7QwaylbCvasg0A',
  // Verkstadstjänster har ett fast Stripe-pris oavsett bilstorlek.
  'tire-change|any|none|none': 'https://buy.stripe.com/4gM7sN9fyeeU21PcGzasg0E',
  'tire-storage|any|none|none': 'https://buy.stripe.com/5kQ4gB77q5Io6i57mfasg0F',
  'tire-repair|any|none|none': 'https://buy.stripe.com/8x29AV3Ve3Ag5e1eOHasg0G',
  'basic-service|any|none|none': 'https://buy.stripe.com/4gM6oJbnGgn2bCp7mfasg0H',
  'major-service|any|none|none': 'https://buy.stripe.com/dRmeVf77qdaQ6i5cGzasg0I',
  'brake-service|any|none|none': 'https://buy.stripe.com/bJe8wRajC1s8gWJ7mfasg0J',
  'pre-inspection|any|none|none': 'https://buy.stripe.com/aFadRbbnG3AgbCp5e7asg0K',
  'computer-diagnosis|any|none|none': 'https://buy.stripe.com/3cI7sNbnG6Ms7m97mfasg0L',
  'electrical-diagnosis|any|none|none': 'https://buy.stripe.com/6oU9AVajCfiY49XcGzasg0M',
  'engine-diagnosis|any|none|none': 'https://buy.stripe.com/bJe3cx8bueeUdKxcGzasg0N'
};

function buildStripeLinkKey(service, size, seatAddonType, asphaltAddonType) {
  return `${service}|${size}|${seatAddonType || 'none'}|${asphaltAddonType || 'none'}`;
}

function getStripePaymentLink(service, size, seatAddonType, asphaltAddonType) {
  if (!service) return null;
  if (service === 'stripe-test') return 'https://buy.stripe.com/test_3cI00ldvYfwY3C55Vd0Ba01';
  const fixedPriceKey = buildStripeLinkKey(service, 'any', 'none', 'none');
  if (!size) return STRIPE_PAYMENT_LINKS[fixedPriceKey] || null;
  const key = buildStripeLinkKey(service, size, seatAddonType, asphaltAddonType);
  return STRIPE_PAYMENT_LINKS[key] || STRIPE_PAYMENT_LINKS[fixedPriceKey] || null;
}

function getStripeCheckoutUrl(paymentLink, bookingId) {
  const checkoutUrl = new URL(paymentLink);
  checkoutUrl.searchParams.set('client_reference_id', String(bookingId));
  return checkoutUrl.toString();
}

function updateStripePayButton() {
  const btn = document.getElementById('stripePayBtn');
  if (!btn) return;

  const service = document.getElementById('service').value;
  const size = document.getElementById('size').value;
  const seatAddonType = getSelectedSeatAddon();
  const asphaltAddonType = getSelectedAsphaltAddon();
  const paymentLink = getStripePaymentLink(service, size, seatAddonType, asphaltAddonType);

  // Innan användaren valt tjänst/storlek: visa normal knapptext,
  // så att formuläret beter sig som andra obligatoriska fält.
  if (!service || !size) {
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.style.opacity = '1';
    btn.textContent = 'Betala & Bekräfta Bokning';
    btn.dataset.paymentLink = '';
    return;
  }

  if (paymentLink) {
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.style.opacity = '1';
    btn.textContent = 'Betala & Bekräfta Bokning';
    btn.dataset.paymentLink = paymentLink;
  } else {
    btn.disabled = true;
    btn.style.cursor = 'not-allowed';
    btn.style.opacity = '0.6';
    btn.textContent = 'Betala & Bekräfta Bokning (ej konfigurerad för detta val)';
    btn.dataset.paymentLink = '';
  }
}

// helper to compute displayed price (lowest value)
function getBasePrice(service) {
  if (!servicePrices[service]) return null;
  const sizes = servicePrices[service];
  return Math.min(...Object.values(sizes));
}

// Update price when service or size is selected
function updatePriceDisplay() {
  const service = document.getElementById('service').value;
  const size = document.getElementById('size').value;
  const seatAddonType = getSelectedSeatAddon();
  const asphaltAddonType = getSelectedAsphaltAddon();
  const priceDisplay = document.getElementById('totalPrice');

  if (!service) {
    priceDisplay.textContent = '-';
    return;
  }
  if (size && servicePrices[service] && servicePrices[service][size] != null) {
    const totalPrice = servicePrices[service][size] + getSeatAddonPrice(service, seatAddonType) + getAsphaltAddonPrice(service, size, asphaltAddonType);
    priceDisplay.textContent = totalPrice + ' kr';
  } else {
    const base = getBasePrice(service);
    const estimatedAsphalt = getAsphaltAddonPrice(service, 'small', asphaltAddonType);
    const totalBase = base ? base + getSeatAddonPrice(service, seatAddonType) + estimatedAsphalt : null;
    priceDisplay.textContent = totalBase ? 'Från ' + totalBase + ' kr' : '-';
  }

  updateStripePayButton();
}

function syncMobilePaymentSection() {
  const paymentSection = document.getElementById('paymentSection');
  const paymentHome = document.getElementById('paymentSectionHome');
  const mobilePaymentMount = document.getElementById('mobilePaymentMount');

  if (!paymentSection || !paymentHome || !mobilePaymentMount) return;

  if (window.matchMedia('(max-width: 768px)').matches) {
    if (paymentSection.parentElement !== mobilePaymentMount) {
      mobilePaymentMount.appendChild(paymentSection);
    }
    return;
  }

  if (paymentSection.parentElement !== paymentHome.parentElement) {
    paymentHome.parentElement.insertBefore(paymentSection, paymentHome.nextSibling);
  }
}

const serviceSelect = document.getElementById('service');
if (serviceSelect) serviceSelect.addEventListener('change', handleServiceChange);

const sizeSelectMain = document.getElementById('size');
if (sizeSelectMain) sizeSelectMain.addEventListener('change', updatePriceDisplay);
document.querySelectorAll('#seatAddonButtons .addon-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#seatAddonButtons .addon-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    handleSeatAddonChange();
  });
});

document.querySelectorAll('#asphaltAddonButtons .addon-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#asphaltAddonButtons .addon-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    handleAsphaltAddonChange();
  });
});

// Form submission
const bookingForm = document.getElementById('bookingForm');
if (bookingForm) bookingForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const phone = document.getElementById('phone').value;
  const service = document.getElementById('service').value;
  const size = document.getElementById('size').value;
  const registration = document.getElementById('registration').value;
  const seatAddon = getSelectedSeatAddon();
  const asphaltAddon = getSelectedAsphaltAddon();
  
  if (!selectedDate || !selectedTime) {
    alert('Vänligen välj datum och tid.');
    return;
  }
  
  if (!name || !email || !phone || !service || !size || !registration) {
    alert('Vänligen fyll i alla fält.');
    return;
  }

  if (!isSlotAvailable(selectedDate, selectedTime, service, seatAddon, asphaltAddon)) {
    alert('Den valda tiden är inte längre tillgänglig. Välj en annan tid.');
    showTimeSlots(selectedDate);
    return;
  }
  
  const dateString = selectedDate.toLocaleDateString('sv-SE');

  const sortKey = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), parseInt(selectedTime.split(':')[0], 10), parseInt(selectedTime.split(':')[1] || '0', 10)).getTime();

  const seatAddonPrice = getSeatAddonPrice(service, seatAddon);
  const seatAddonMinutes = getSeatAddonMinutes(service, seatAddon);
  const asphaltAddonPrice = getAsphaltAddonPrice(service, size, asphaltAddon);
  const asphaltAddonMinutes = getAsphaltAddonMinutes(service, asphaltAddon);
  const computedPrice = servicePrices[service][size] + seatAddonPrice + asphaltAddonPrice;
  const seatAddonLabel = getSeatAddonLabel(service, seatAddon);
  const asphaltAddonLabel = getAsphaltAddonLabel(service, asphaltAddon);
  const addonParts = [seatAddonLabel, asphaltAddonLabel].filter(Boolean);
  const addonLabel = addonParts.join(' + ');
  const booking = {
    id: Date.now(),
    name,
    email,
    phone,
    registration,
    service,
    seatAddon,
    asphaltAddon,
    addonLabel,
    seatAddonPrice,
    seatAddonMinutes,
    asphaltAddonPrice,
    asphaltAddonMinutes,
    size,
    date: dateString,
    time: selectedTime,
    price: computedPrice,
    paymentStatus: 'Pending',
    sortKey
  };

  const paymentLink = getStripePaymentLink(service, size, seatAddon, asphaltAddon);
  if (!paymentLink) {
    alert('Ingen Stripe-länk är konfigurerad för den valda tjänsten/storleken ännu.');
    return;
  }

  try {
    await savePendingBooking(booking);
    setPendingBookingCookie(booking.id);
    sessionStorage.setItem('pendingBooking', JSON.stringify(booking));
  } catch (err) {
    console.error('Pending booking save error:', err);
    alert('Kunde inte starta betalningen just nu. Försök igen om en stund.');
    return;
  }

  window.location.href = getStripeCheckoutUrl(paymentLink, booking.id);
});

// ===== BOOKING STORAGE & OWNER VIEW HELPERS =====
let cachedBookings = [];
let unsubscribeAvailability = null;

async function saveBooking(booking) {
  if (!canUseFirestore()) {
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
    return;
  }
  try {
    await window.db.collection('bookings').doc(String(booking.id)).set(booking);
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  } catch (e) {
    console.error('Firebase save error:', e);
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  }
}

async function savePendingBooking(booking) {
  if (!canUseFirestore()) throw new Error('Firestore unavailable');

  try {
    await window.db.collection('pendingBookings').doc(String(booking.id)).set(booking);
  } catch (e) {
    console.error('Firebase save pending error:', e);
    throw e;
  }
}

function setPendingBookingCookie(bookingId) {
  document.cookie = `pendingBookingId=${encodeURIComponent(String(bookingId))}; Path=/; Max-Age=1800; SameSite=Lax`;
}

function loadBookings() {
  return cachedBookings;
}

async function loadBookingsFromFirebase() {
  if (!canUseFirestore()) {
    cachedBookings = readLocalArray(LOCAL_STORAGE_KEYS.bookings);
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
    return;
  }
  try {
    const snapshot = await window.db.collection('availability').get();
    cachedBookings = snapshot.docs.map(doc => doc.data());
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  } catch (e) {
    console.error('Firebase load error:', e);
    cachedBookings = readLocalArray(LOCAL_STORAGE_KEYS.bookings);
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
  }
}

function subscribeToAvailability() {
  if (!canUseFirestore() || typeof window.db.collection('availability').onSnapshot !== 'function') return;
  if (unsubscribeAvailability) unsubscribeAvailability();

  unsubscribeAvailability = window.db.collection('availability').onSnapshot(snapshot => {
    cachedBookings = snapshot.docs.map(doc => doc.data());
    cachedBookings.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
    renderCalendar();
    if (selectedDate) showTimeSlots(selectedDate);
  }, error => {
    console.error('Firebase realtime availability error:', error);
  });
}

async function deleteBooking(id) {
  if (!canUseFirestore()) {
    cachedBookings = cachedBookings.filter(b => String(b.id) !== String(id));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
    renderBookingsTable();
    return;
  }
  try {
    await window.db.collection('bookings').doc(String(id)).delete();
    cachedBookings = cachedBookings.filter(b => String(b.id) !== String(id));
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  } catch (e) {
    console.error('Firebase delete error:', e);
  }
  renderBookingsTable();
}

function renderBookingsTable(serverBookings) {
  const tbody = document.querySelector('#bookingsTable tbody');
  if (!tbody) return;
  
  const bookings = Array.isArray(serverBookings) ? serverBookings : loadBookings();
  
  // Get filter values
  const typeFilter = document.getElementById('bookingTypeFilter')?.value || 'all';
  const statusFilter = document.getElementById('bookingStatusFilter')?.value || 'all';
  
  // Define wash and service categories
  const washServices = ['basic', 'interior-wash', 'premium', 'inout', 'interior', 'full'];
  const serviceServices = ['tire-change', 'tire-storage', 'tire-repair', 'basic-service', 'major-service', 'brake-service', 'pre-inspection', 'inspection-fix', 'computer-diagnosis', 'electrical-diagnosis', 'engine-diagnosis'];
  
  // Filter bookings
  let filteredBookings = bookings.filter(b => {
    // Type filter
    if (typeFilter === 'wash' && !washServices.includes(b.service)) return false;
    if (typeFilter === 'service' && !serviceServices.includes(b.service)) return false;
    
    // Status filter
    if (statusFilter !== 'all' && b.paymentStatus !== statusFilter) return false;
    
    return true;
  });
  
  tbody.innerHTML = '';
  if (!filteredBookings.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:var(--text-secondary);">Inga bokningar matchar filtret</td></tr>';
    return;
  }

  filteredBookings.forEach(b => {
    const tr = document.createElement('tr');
    tr.style.transition = 'all 0.2s ease';
    tr.innerHTML = `
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.name)}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.email || '-')}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.phone)}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.registration || '-')}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(getServiceLabel(b.service, b.seatAddon, b.asphaltAddon))}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.size || '-')}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.date)}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.time)}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);"><span style="background:${getStatusColor(b.paymentStatus)};padding:6px 12px;border-radius:6px;font-size:0.85rem;font-weight:600;">${escapeHtml(b.paymentStatus || 'Pending')} - ${b.price ? b.price + ' kr' : '-'}</span></td>
      <td style="padding:12px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.pickup ? ('🚗 ' + (b.pickupAddress || '-')) : '-')}</td>
      <td style="padding:12px;border-bottom:1px solid var(--border);text-align:center;"><button class="delete-btn" data-id="${b.id}" style="background:#dc3545;padding:8px 14px;border-radius:8px;border:none;color:#fff;cursor:pointer;font-weight:600;transition:all 0.2s;">🗑️ Ta bort</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBooking(btn.dataset.id));
    btn.addEventListener('mouseenter', (e) => {
      e.target.style.background = '#c82333';
      e.target.style.transform = 'scale(1.05)';
    });
    btn.addEventListener('mouseleave', (e) => {
      e.target.style.background = '#dc3545';
      e.target.style.transform = 'scale(1)';
    });
  });
}

function getStatusColor(status) {
  switch(status) {
    case 'Paid': return '#28a745';
    case 'Pending': return '#ffc107';
    case 'Manuell (Telefon)': return '#17a2b8';
    default: return '#6c757d';
  }
}

function exportCSV() {
  const bookings = loadBookings();
  if (!bookings.length) { alert('Inga bokningar att exportera.'); return; }
  let csv = 'Namn,E-post,Telefon,Registreringsnummer,Tjänst,Storlek,Pris,Datum,Tid,Betalningsstatus\n';
  bookings.forEach(b => {
    const safe = v => '"' + String(v).replace(/"/g, '""') + '"';
    csv += [safe(b.name), safe(b.email || ''), safe(b.phone), safe(b.registration || ''), safe(getServiceLabel(b.service, b.seatAddon, b.asphaltAddon)), safe(b.size || ''), safe(b.price || ''), safe(b.date), safe(b.time), safe(b.paymentStatus || 'Pending')].join(',') + '\n';
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

function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/[&<>\"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
}

function getServiceLabel(service, seatAddonType = 'none', asphaltAddonType = 'none') {
  const base = SERVICE_LABELS[service] || service || '-';
  const seatAddon = getSeatAddonLabel(service, seatAddonType);
  const asphaltAddon = getAsphaltAddonLabel(service, asphaltAddonType);
  const extras = [seatAddon, asphaltAddon].filter(Boolean);
  return extras.length ? `${base} + ${extras.join(' + ')}` : base;
}

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

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
  document.body.classList.remove('owner-login-active');
  document.querySelectorAll('.owner-login-overlay').forEach(el => el.remove());

  syncMobilePaymentSection();
  window.addEventListener('resize', syncMobilePaymentSection);

  // Reset scroll to top
  window.scrollTo(0, 0);
  
  // Check if service is specified in URL parameter and pre-select it
  const urlParams = new URLSearchParams(window.location.search);
  const serviceParam = urlParams.get('service');
  if (serviceParam) {
    const serviceSelect = document.getElementById('service');
    if (serviceSelect) {
      serviceSelect.value = serviceParam;
      // Scroll to booking section
      setTimeout(() => {
        document.getElementById('booking').scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }
  
  // Load bookings + blocked dates from Firebase so calendar availability is correct
  await loadBookingsFromFirebase();
  subscribeToAvailability();
  await loadBlockedDatesFromFirebase();
  await loadBlockedTimesFromFirebase();
  loadServiceDurationsFromCards();
  initCalendar();
  renderBlockedDatesList();
  renderBlockedTimesList();
  updateSeatAddonVisibility();
  updateAsphaltAddonVisibility();
  
  // hook up service cards to select pricing & scroll
  document.querySelectorAll('.service-card').forEach(card => {
    const service = card.dataset.service;
    const sizeSelect = card.querySelector('.card-size');
    const seatAddonSelect = card.querySelector('.card-addon-seat');
    const asphaltAddonSelect = card.querySelector('.card-addon-asphalt');

    const updateCardPrice = () => {
      if (!sizeSelect) return;
      const chosenSize = sizeSelect.value;
      const seatAddonType = seatAddonSelect ? seatAddonSelect.value : 'none';
      const asphaltAddonType = asphaltAddonSelect ? asphaltAddonSelect.value : 'none';
      const base = servicePrices[service] && servicePrices[service][chosenSize] ? servicePrices[service][chosenSize] : 0;
      const total = base + getSeatAddonPrice(service, seatAddonType) + getAsphaltAddonPrice(service, chosenSize, asphaltAddonType);
      const priceSpan = card.querySelector('.price');
      if (priceSpan) priceSpan.textContent = total ? 'Från ' + total + ' kr' : '';
    };

    // click on card background also works
    card.addEventListener('click', () => {
      const chosenSize = sizeSelect ? sizeSelect.value : 'small';
      const chosenSeatAddon = seatAddonSelect ? seatAddonSelect.value : 'none';
      const chosenAsphaltAddon = asphaltAddonSelect ? asphaltAddonSelect.value : 'none';
      bookService(service, chosenSize, chosenSeatAddon, chosenAsphaltAddon);
    });
    // change size inside card updates price display and keeps card selected
    if (sizeSelect) {
      sizeSelect.addEventListener('click', (e) => e.stopPropagation());
      sizeSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        updateCardPrice();
      });
    }

    if (seatAddonSelect) {
      seatAddonSelect.addEventListener('click', (e) => e.stopPropagation());
      seatAddonSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        updateCardPrice();
      });
    }

    if (asphaltAddonSelect) {
      asphaltAddonSelect.addEventListener('click', (e) => e.stopPropagation());
      asphaltAddonSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        updateCardPrice();
      });
    }

    updateCardPrice();
  });
  
  // Owner / admin wiring (client-side PIN protection)
  const ownerLink = document.getElementById('ownerLink');
  if (ownerLink) {
    ownerLink.addEventListener('click', async function(e) {
      e.preventDefault();

      if (isOwnerAuthenticated()) {
        const ownerSection = document.getElementById('ownerSection');
        if (ownerSection) {
          ownerSection.style.display = 'block';
          renderBookingsTable();
          ownerSection.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      if (isOwnerTemporarilyLocked()) {
        const secondsLeft = Math.ceil((ownerAccessState.lockedUntil - Date.now()) / 1000);
        alert(`För många försök. Vänta ${secondsLeft} sekunder innan du försöker igen.`);
        return;
      }

      const code = await showOwnerLoginOverlay();
      if (code === null) return;

      const isValid = await verifyOwnerCode(code);
      if (isValid) {
        ownerAccessState.failedAttempts = 0;
        ownerAccessState.authenticatedUntil = Date.now() + OWNER_ACCESS_CONFIG.authSessionMs;
        // Persist session so refresh doesn't log out (expires after 5 hours)
        if (window.ownerSession) window.ownerSession.set();

        alert('✓ Inloggning lyckad!');

        const ownerSection = document.getElementById('ownerSection');
        if (ownerSection) {
          ownerSection.style.display = 'block';
          renderBookingsTable();
          ownerSection.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        ownerAccessState.failedAttempts += 1;

        if (ownerAccessState.failedAttempts >= OWNER_ACCESS_CONFIG.maxAttempts) {
          ownerAccessState.failedAttempts = 0;
          ownerAccessState.lockedUntil = Date.now() + OWNER_ACCESS_CONFIG.lockoutMs;
          alert('✗ För många felaktiga försök. Åtkomst är tillfälligt låst i 10 minuter.');
          return;
        }

        const remaining = OWNER_ACCESS_CONFIG.maxAttempts - ownerAccessState.failedAttempts;
        alert(`✗ Felaktig kod. ${remaining} försök kvar.`);
      }
    });
  }

  const blockDateInput = document.getElementById('blockDateInput');
  const addBlockedDateBtn = document.getElementById('addBlockedDateBtn');
  const removeBlockedDateBtn = document.getElementById('removeBlockedDateBtn');
  const blockTimeDateInput = document.getElementById('blockTimeDateInput');
  const blockTimeInput = document.getElementById('blockTimeInput');
  const addBlockedTimeBtn = document.getElementById('addBlockedTimeBtn');
  const removeBlockedTimeBtn = document.getElementById('removeBlockedTimeBtn');
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
        alert('Fyll i alla obligatoriska fält för manuell bokning.');
        return;
      }

      const [y, m, d] = dateId.split('-').map(Number);
      const bookingDate = new Date(y, (m || 1) - 1, d || 1);
      const dateSv = bookingDate.toLocaleDateString('sv-SE');

      if (!isSlotAvailable(bookingDate, time, service, 'none', 'none')) {
        alert('Tiden är inte tillgänglig (upptagen, blockerad eller passerad). Välj annan tid.');
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

      const manualBooking = {
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
        await saveBooking(manualBooking);
        renderBookingsTable();
        renderCalendar();
        if (selectedDate && toDateId(selectedDate) === dateId) {
          showTimeSlots(selectedDate);
        }
        ownerManualBookingForm.reset();
        alert('Manuell bokning sparad.');
      } catch (err) {
        console.error('Kunde inte spara manuell bokning:', err);
        alert('Kunde inte spara manuell bokning just nu.');
      }
    });
  }

  if (addBlockedDateBtn) {
    addBlockedDateBtn.addEventListener('click', async function() {
      const dateId = blockDateInput ? blockDateInput.value : '';
      if (!dateId) {
        alert('Välj ett datum att blockera.');
        return;
      }
      try {
        await addBlockedDate(dateId);
        renderBlockedDatesList();
        renderCalendar();
        if (selectedDate && isDateBlocked(selectedDate)) {
          resetDateTimeSelection();
          selectedDate = null;
        }
        alert('Datum blockerat.');
      } catch (e) {
        console.error('Kunde inte blockera datum:', e);
        alert('Kunde inte blockera datum just nu.');
      }
    });
  }

  if (removeBlockedDateBtn) {
    removeBlockedDateBtn.addEventListener('click', async function() {
      const dateId = blockDateInput ? blockDateInput.value : '';
      if (!dateId) {
        alert('Välj ett datum att ta bort blockering för.');
        return;
      }
      try {
        await removeBlockedDate(dateId);
        renderBlockedDatesList();
        renderCalendar();
        alert('Blockering borttagen.');
      } catch (e) {
        console.error('Kunde inte ta bort blockering:', e);
        alert('Kunde inte ta bort blockering just nu.');
      }
    });
  }

  if (addBlockedTimeBtn) {
    addBlockedTimeBtn.addEventListener('click', async function() {
      const dateId = blockTimeDateInput ? blockTimeDateInput.value : '';
      const time = blockTimeInput ? blockTimeInput.value : '';
      if (!dateId || !time) {
        alert('Välj både datum och tid att blockera.');
        return;
      }
      try {
        await addBlockedTime(dateId, time);
        renderBlockedTimesList();
        renderCalendar();

        if (selectedDate && toDateId(selectedDate) === dateId) {
          if (selectedTime === time) selectedTime = null;
          showTimeSlots(selectedDate);
        }

        alert('Tid blockerad.');
      } catch (e) {
        console.error('Kunde inte blockera tid:', e);
        alert('Kunde inte blockera tid just nu.');
      }
    });
  }

  if (removeBlockedTimeBtn) {
    removeBlockedTimeBtn.addEventListener('click', async function() {
      const dateId = blockTimeDateInput ? blockTimeDateInput.value : '';
      const time = blockTimeInput ? blockTimeInput.value : '';
      if (!dateId || !time) {
        alert('Välj både datum och tid för att ta bort tidsblockering.');
        return;
      }
      try {
        await removeBlockedTime(dateId, time);
        renderBlockedTimesList();
        renderCalendar();

        if (selectedDate && toDateId(selectedDate) === dateId) {
          showTimeSlots(selectedDate);
        }

        alert('Tidsblockering borttagen.');
      } catch (e) {
        console.error('Kunde inte ta bort tidsblockering:', e);
        alert('Kunde inte ta bort tidsblockering just nu.');
      }
    });
  }

  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);

  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', async function() {
    if (confirm('Rensa alla bokningar? Detta kan inte ångras.')) {
      if (!canUseFirestore()) {
        cachedBookings = [];
        writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
        renderBookingsTable();
        alert('Bokningar rensade');
      } else {
        try {
          const snapshot = await db.collection('bookings').get();
          const batch = db.batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          cachedBookings = [];
          renderBookingsTable();
          alert('Bokningar rensade');
        } catch (e) {
          console.error('Firebase clear error:', e);
        }
      }
    }
  });

  // Booking filters event listeners
  const bookingTypeFilter = document.getElementById('bookingTypeFilter');
  const bookingStatusFilter = document.getElementById('bookingStatusFilter');
  
  if (bookingTypeFilter) {
    bookingTypeFilter.addEventListener('change', () => {
      renderBookingsTable();
    });
  }
  
  if (bookingStatusFilter) {
    bookingStatusFilter.addEventListener('change', () => {
      renderBookingsTable();
    });
  }

  const closeOwnerBtn = document.getElementById('closeOwnerBtn');
  if (closeOwnerBtn) closeOwnerBtn.addEventListener('click', function() {
    const ownerSection = document.getElementById('ownerSection');
    if (ownerSection) ownerSection.style.display = 'none';
    // Clear persisted session on explicit logout
    if (window.ownerSession) window.ownerSession.clear();
    ownerAccessState.authenticatedUntil = 0;
  });

  // ===== AD CONFIGURATION SYSTEM =====
  ensureAdStyles();
  await loadAdConfigFromFirebase();
  renderAdConfigControls();
  if (shouldShowAdOnLoad()) {
    showAdPopup(adConfig.html);
  }

  // ===== CAR SERVICE INTERACTIONS =====
  // Handle both service-item (old cards) and service-card clicks
  document.querySelectorAll('.service-item, .service-card').forEach(item => {
    const serviceName = item.dataset.service;
    
    item.addEventListener('click', () => {
      console.log('Service clicked:', serviceName);
      
      // Set service in wizard data
      wizardData.service = serviceName;
      
      // Find and click the corresponding service option in wizard
      const wizardServiceOption = document.querySelector(`.service-option[data-service="${serviceName}"]`);
      if (wizardServiceOption) {
        // Remove selected from all options
        document.querySelectorAll('.service-option').forEach(opt => opt.classList.remove('selected'));
        // Select this one
        wizardServiceOption.classList.add('selected');
        console.log('Wizard service selected:', serviceName);
      }
      
      // Show toast notification
      const toast = document.createElement('div');
      toast.textContent = `✓ ${SERVICE_LABELS[serviceName] || serviceName} vald`;
      toast.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: linear-gradient(135deg, var(--primary), var(--accent));
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        font-weight: 600;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideInRight 0.3s ease, slideOutRight 0.3s ease 2.7s;
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      
      // Scroll to wizard booking section
      const wizardSection = document.querySelector('.booking-wizard');
      if (wizardSection) {
        setTimeout(() => {
          wizardSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    });

    // Add hover effect enhancement
    item.addEventListener('mouseenter', () => {
      item.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    });
  });

  // ===== TABS FUNCTIONALITY =====
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(targetTab) {
    // Remove active class from all buttons and contents
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Add active class to target button and content
    const targetButton = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    const targetContent = document.getElementById(targetTab);
    
    if (targetButton && targetContent) {
      targetButton.classList.add('active');
      targetContent.classList.add('active');
    }
  }

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
    });
  });

  // Handle navigation links to the matching service tab.
  document.querySelectorAll('.nav-link-service').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('services').scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => {
        switchTab(link.dataset.tab || 'car-service');
      }, 300);
    });
  });

  // ===== ACCORDION FUNCTIONALITY =====
  const accordionHeaders = document.querySelectorAll('.accordion-header');
  
  accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const accordionItem = header.parentElement;
      const isOpen = accordionItem.classList.contains('open');
      
      // Close all accordions
      document.querySelectorAll('.accordion-item').forEach(item => {
        item.classList.remove('open');
      });
      
      // Open clicked accordion if it was closed
      if (!isOpen) {
        accordionItem.classList.add('open');
      }
    });
  });

  // Open first accordion by default
  const firstAccordion = document.querySelector('.accordion-item');
  if (firstAccordion) {
    firstAccordion.classList.add('open');
  }

  // ===== BOOKING WIZARD =====
  const wizardData = {
    currentStep: 1,
    service: '',
    size: '',
    seatAddon: 'none',
    asphaltAddon: 'none',
    registration: '',
    date: null,
    time: '',
    name: '',
    phone: '',
    email: '',
    pickup: false,
    pickupAddress: ''
  };

  let wizardCurrentDate = new Date();
  let wizardSelectedDate = null;
  let wizardSelectedTime = null;

  function updateWizardSizePrices(service) {
    document.querySelectorAll('[data-size-price]').forEach((priceNode) => {
      const price = servicePrices[service]?.[priceNode.dataset.sizePrice];
      priceNode.textContent = price != null ? `${price} kr` : '';
    });
  }

  function selectWizardService(service, size = '', seatAddon = 'none', asphaltAddon = 'none') {
    wizardData.service = service;
    wizardData.size = size;
    wizardData.seatAddon = seatAddon;
    wizardData.asphaltAddon = asphaltAddon;
    updateWizardSizePrices(service);

    document.querySelectorAll('.service-option').forEach((option) => {
      option.classList.toggle('selected', option.dataset.service === service);
    });
    document.querySelectorAll('.size-option').forEach((option) => {
      option.classList.toggle('selected', option.dataset.size === size);
    });
  }

  document.addEventListener('serviceCardSelected', (event) => {
    const selection = event.detail;
    if (!selection) return;
    selectWizardService(selection.service, selection.size, selection.seatAddon, selection.asphaltAddon);
    updateWizardStep(2);
  });

  function updateWizardStep(step) {
    wizardData.currentStep = step;
    
    // Update progress
    document.querySelectorAll('.wizard-step').forEach((stepEl, index) => {
      const stepNum = index + 1;
      stepEl.classList.remove('active', 'completed');
      
      if (stepNum < step) {
        stepEl.classList.add('completed');
      } else if (stepNum === step) {
        stepEl.classList.add('active');
      }
    });
    
    // Update panels
    document.querySelectorAll('.wizard-panel').forEach((panel, index) => {
      panel.classList.remove('active');
      if (index + 1 === step) {
        panel.classList.add('active');
      }
    });
    
    // Update buttons
    const prevBtn = document.getElementById('wizardPrevBtn');
    const nextBtn = document.getElementById('wizardNextBtn');
    const submitBtn = document.getElementById('wizardSubmitBtn');
    
    if (prevBtn) prevBtn.style.display = step > 1 ? 'block' : 'none';
    if (nextBtn) nextBtn.style.display = step < 5 ? 'block' : 'none';
    if (submitBtn) submitBtn.style.display = step === 5 ? 'block' : 'none';
    
    // Load step-specific data
    if (step === 3) {
      renderWizardCalendar();
    } else if (step === 5) {
      updateBookingSummary();
    }
  }

  function validateWizardStep(step) {
    const isServiceBooking = SERVICE_SERVICES.includes(wizardData.service);
    switch(step) {
      case 1:
        return !!wizardData.service;
      case 2:
        if (isServiceBooking) return !!wizardData.registration;
        return !!wizardData.size && !!wizardData.registration;
      case 3:
        return !!wizardData.date && !!wizardData.time;
      case 4:
        const baseValid = !!wizardData.name && wizardData.name.trim() !== '' && 
               !!wizardData.phone && wizardData.phone.trim() !== '' && 
               !!wizardData.email && wizardData.email.trim() !== '';
        if (wizardData.pickup && (!wizardData.pickupAddress || wizardData.pickupAddress.trim() === '')) return false;
        return baseValid;
      default:
        return true;
    }
  }

  // Step 1: Service Selection
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const category = btn.dataset.category;
      document.getElementById('serviceOptionsWash').style.display = category === 'wash' ? 'grid' : 'none';
      document.getElementById('serviceOptionsService').style.display = category === 'service' ? 'grid' : 'none';
    });
  });

  document.querySelectorAll('.service-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.service-option').forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      wizardData.service = option.dataset.service;
      updateWizardSizePrices(wizardData.service);
      
      // Show/hide inspection-fix contact panel
      const inspectionPanel = document.getElementById('wizardInspectionFixPanel');
      const nextBtn = document.getElementById('wizardNextBtn');
      if (option.dataset.service === 'inspection-fix') {
        if (inspectionPanel) inspectionPanel.style.display = 'block';
        if (nextBtn) nextBtn.style.display = 'none';
      } else {
        if (inspectionPanel) inspectionPanel.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'block';
      }
    });
  });

  // Step 2: Details
  document.querySelectorAll('.size-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.size-option').forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      wizardData.size = option.dataset.size;
    });
  });

  document.querySelectorAll('#wizardSeatAddon .addon-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('#wizardSeatAddon .addon-option').forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
      wizardData.seatAddon = option.dataset.addon;
    });
  });

  document.querySelectorAll('#wizardAsphaltAddon .addon-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('#wizardAsphaltAddon .addon-option').forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
      wizardData.asphaltAddon = option.dataset.addon;
    });
  });

  const wizardRegInput = document.getElementById('wizardRegistration');
  if (wizardRegInput) {
    wizardRegInput.addEventListener('input', (e) => {
      wizardData.registration = e.target.value;
    });
  }

  // Step 3: Date & Time
  function renderWizardCalendar() {
    const calendarDays = document.getElementById('wizardCalendarDays');
    const monthYear = document.getElementById('wizardMonthYear');
    
    if (!calendarDays || !monthYear) return;
    
    const year = wizardCurrentDate.getFullYear();
    const month = wizardCurrentDate.getMonth();
    
    monthYear.textContent = new Date(year, month).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDay = (firstDay.getDay() + 6) % 7;
    
    calendarDays.innerHTML = '';
    
    for (let i = 0; i < startDay; i++) {
      const emptyDay = document.createElement('div');
      emptyDay.className = 'day empty';
      calendarDays.appendChild(emptyDay);
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayEl = document.createElement('div');
      dayEl.className = 'day';
      dayEl.textContent = day;
      
      if (date < today) {
        dayEl.classList.add('past');
      } else {
        dayEl.classList.add('available');
        dayEl.addEventListener('click', () => {
          wizardSelectedDate = date;
          wizardData.date = date;
          showWizardTimeSlots(date);
          
          document.querySelectorAll('#wizardCalendarDays .day').forEach(d => d.classList.remove('selected'));
          dayEl.classList.add('selected');
        });
      }
      
      calendarDays.appendChild(dayEl);
    }
  }

  async function showWizardTimeSlots(date) {
    const timesSection = document.getElementById('wizardTimesSection');
    const timeSlots = document.getElementById('wizardTimeSlots');
    const selectedDateEl = document.getElementById('wizardSelectedDate');
    
    if (!timesSection || !timeSlots || !selectedDateEl) return;
    
    selectedDateEl.textContent = date.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    timesSection.style.display = 'block';
    
    // Use the same logic as the regular calendar
    const selectedService = wizardData.service;
    const selectedSeatAddon = wizardData.seatAddon || 'none';
    const selectedAsphaltAddon = wizardData.asphaltAddon || 'none';
    
    if (!selectedService) {
      timeSlots.innerHTML = '<p class="slot-info">Välj tjänst först</p>';
      return;
    }
    
    // Get available time slots using the existing function
    const availableHours = getTimeSlotsForService(date, selectedService, selectedSeatAddon, selectedAsphaltAddon);
    
    timeSlots.innerHTML = '';
    
    if (!availableHours.length) {
      timeSlots.innerHTML = '<p class="slot-info">Inga tider tillgängliga för vald tjänst denna dag.</p>';
      return;
    }
    
    availableHours.forEach(hour => {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'time-slot';
      slot.textContent = hour;
      
      if (isSlotAvailable(date, hour, selectedService, selectedSeatAddon, selectedAsphaltAddon)) {
        slot.addEventListener('click', () => {
          wizardSelectedTime = hour;
          wizardData.time = hour;
          document.querySelectorAll('#wizardTimeSlots .time-slot').forEach(s => s.classList.remove('selected'));
          slot.classList.add('selected');
        });
      } else {
        slot.classList.add('unavailable');
      }
      
      timeSlots.appendChild(slot);
    });
  }

  const wizardPrevMonth = document.getElementById('wizardPrevMonth');
  const wizardNextMonth = document.getElementById('wizardNextMonth');
  
  if (wizardPrevMonth) {
    wizardPrevMonth.addEventListener('click', () => {
      wizardCurrentDate.setMonth(wizardCurrentDate.getMonth() - 1);
      renderWizardCalendar();
    });
  }
  
  if (wizardNextMonth) {
    wizardNextMonth.addEventListener('click', () => {
      wizardCurrentDate.setMonth(wizardCurrentDate.getMonth() + 1);
      renderWizardCalendar();
    });
  }

  // Step 4: Contact Info
  const wizardNameInput = document.getElementById('wizardName');
  const wizardPhoneInput = document.getElementById('wizardPhone');
  const wizardEmailInput = document.getElementById('wizardEmail');
  
  if (wizardNameInput) wizardNameInput.addEventListener('input', (e) => {
    wizardData.name = e.target.value.trim();
  });
  if (wizardPhoneInput) wizardPhoneInput.addEventListener('input', (e) => {
    wizardData.phone = e.target.value.trim();
  });
  if (wizardEmailInput) wizardEmailInput.addEventListener('input', (e) => {
    wizardData.email = e.target.value.trim();
  });

  const wizardPickupCheckbox = document.getElementById('wizardPickupCheckbox');
  const wizardPickupAddressSection = document.getElementById('wizardPickupAddressSection');
  const wizardPickupAddress = document.getElementById('wizardPickupAddress');
  if (wizardPickupCheckbox) {
    wizardPickupCheckbox.addEventListener('change', (e) => {
      wizardData.pickup = e.target.checked;
      if (wizardPickupAddressSection) {
        wizardPickupAddressSection.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }
  if (wizardPickupAddress) {
    wizardPickupAddress.addEventListener('input', (e) => {
      wizardData.pickupAddress = e.target.value;
    });
  }


  // Step 5: Summary
  function updateBookingSummary() {
    document.getElementById('summaryService').textContent = SERVICE_LABELS[wizardData.service] || wizardData.service;
    
    const sizeLabels = { small: 'Liten', medium: 'Mellan', large: 'Stor' };
    document.getElementById('summarySize').textContent = sizeLabels[wizardData.size] || wizardData.size;
    
    let addons = [];
    if (wizardData.seatAddon && wizardData.seatAddon !== 'none') {
      addons.push(getSeatAddonLabel(wizardData.service, wizardData.seatAddon));
    }
    if (wizardData.asphaltAddon && wizardData.asphaltAddon !== 'none') {
      addons.push(getAsphaltAddonLabel(wizardData.service, wizardData.asphaltAddon));
    }
    
    const addonRow = document.getElementById('summaryAddonRow');
    if (addons.length > 0) {
      document.getElementById('summaryAddons').textContent = addons.join(', ');
      addonRow.style.display = 'flex';
    } else {
      addonRow.style.display = 'none';
    }
    
    document.getElementById('summaryReg').textContent = wizardData.registration;
    document.getElementById('summaryDate').textContent = wizardData.date ? wizardData.date.toLocaleDateString('sv-SE') : '-';
    document.getElementById('summaryTime').textContent = wizardData.time;
    
    const duration = serviceDurations[wizardData.service] || 60;
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    let durationText = '';
    if (hours > 0) durationText += `${hours} timme${hours > 1 ? 'r' : ''}`;
    if (minutes > 0) durationText += ` ${minutes} min`;
    document.getElementById('summaryDuration').textContent = durationText.trim();
    
    document.getElementById('summaryName').textContent = wizardData.name;
    document.getElementById('summaryPhone').textContent = wizardData.phone;
    document.getElementById('summaryEmail').textContent = wizardData.email;
    
    // Calculate total price
    const basePrice = (servicePrices[wizardData.service] || {})[wizardData.size] || 0;
    const seatPrice = getSeatAddonPrice(wizardData.service, wizardData.seatAddon);
    const asphaltPrice = getAsphaltAddonPrice(wizardData.service, wizardData.size, wizardData.asphaltAddon);
    const totalPrice = basePrice + seatPrice + asphaltPrice;
    
    document.getElementById('summaryTotal').textContent = `${totalPrice} kr`;
  }

  // Navigation
  const wizardPrevBtn = document.getElementById('wizardPrevBtn');
  const wizardNextBtn = document.getElementById('wizardNextBtn');
  const wizardSubmitBtn = document.getElementById('wizardSubmitBtn');
  
  if (wizardPrevBtn) {
    wizardPrevBtn.addEventListener('click', () => {
      if (wizardData.currentStep > 1) {
        updateWizardStep(wizardData.currentStep - 1);
      }
    });
  }
  
  if (wizardNextBtn) {
    wizardNextBtn.addEventListener('click', () => {
      if (!validateWizardStep(wizardData.currentStep)) {
        alert('Vänligen fyll i alla obligatoriska fält.');
        return;
      }
      
      // Show/hide addons based on service
      if (wizardData.currentStep === 1 && wizardData.service) {
        const seatAddon = document.getElementById('wizardSeatAddon');
        const asphaltAddon = document.getElementById('wizardAsphaltAddon');
        const sizeSection = document.getElementById('wizardSizeSection');
        
        if (seatAddon) {
          seatAddon.style.display = serviceSupportsSeatAddon(wizardData.service) ? 'block' : 'none';
        }
        if (asphaltAddon) {
          asphaltAddon.style.display = serviceSupportsAsphaltAddon(wizardData.service) ? 'block' : 'none';
        }
        // Hide size selector for bilservice bookings
        if (sizeSection) {
          const isServiceBooking = SERVICE_SERVICES.includes(wizardData.service);
          sizeSection.style.display = isServiceBooking ? 'none' : 'block';
          if (isServiceBooking) wizardData.size = 'small'; // default size for pricing
        }
        // Show/hide pickup option
        const pickupSection = document.getElementById('wizardPickupSection');
        if (pickupSection) {
          pickupSection.style.display = SERVICE_SERVICES.includes(wizardData.service) ? 'block' : 'none';
        }
      }
      
      if (wizardData.currentStep < 5) {
        updateWizardStep(wizardData.currentStep + 1);
      }
    });
  }
  
  if (wizardSubmitBtn) {
    wizardSubmitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Wizard submit clicked', wizardData);
      
      // Validate all required data with detailed error messages
      const validationErrors = [];
      const isServiceBooking = SERVICE_SERVICES.includes(wizardData.service);
      
      if (!wizardData.service) validationErrors.push('Tjänst saknas');
      if (!isServiceBooking && !wizardData.size) validationErrors.push('Bilstorlek saknas');
      if (!wizardData.registration) validationErrors.push('Registreringsnummer saknas');
      if (!wizardData.date) validationErrors.push('Datum saknas');
      if (!wizardData.time) validationErrors.push('Tid saknas');
      if (!wizardData.name || wizardData.name.trim() === '') validationErrors.push('Namn saknas');
      if (!wizardData.phone || wizardData.phone.trim() === '') validationErrors.push('Telefonnummer saknas');
      if (!wizardData.email || wizardData.email.trim() === '') validationErrors.push('E-post saknas');
      if (wizardData.pickup && (!wizardData.pickupAddress || wizardData.pickupAddress.trim() === '')) validationErrors.push('Adress för hemhämtning saknas');
      
      if (validationErrors.length > 0) {
        console.log('Validation errors:', validationErrors);
        alert('Följande uppgifter saknas:\n\n' + validationErrors.join('\n'));
        return;
      }

      // Check if slot is still available
      try {
        const slotAvailable = await isSlotAvailable(wizardData.date, wizardData.time, wizardData.service, wizardData.seatAddon || 'none', wizardData.asphaltAddon || 'none');
        if (!slotAvailable) {
          alert('Den valda tiden är inte längre tillgänglig. Välj en annan tid.');
          updateWizardStep(3);
          return;
        }
      } catch (error) {
        console.error('Error checking slot availability:', error);
      }

      // Show loading state
      wizardSubmitBtn.disabled = true;
      wizardSubmitBtn.textContent = 'Bearbetar...';
      
      try {
        const dateString = wizardData.date.toLocaleDateString('sv-SE');
        
        // Calculate price using servicePrices object
        const servicePriceData = servicePrices[wizardData.service];
        const servicePrice = servicePriceData
          ? (servicePriceData[wizardData.size] ?? servicePriceData.small ?? 0)
          : 0;
        const seatAddonPrice = getSeatAddonPrice(wizardData.service, wizardData.seatAddon || 'none') || 0;
        const asphaltAddonPrice = getAsphaltAddonPrice(wizardData.service, wizardData.size, wizardData.asphaltAddon || 'none') || 0;
        const totalPrice = servicePrice + seatAddonPrice + asphaltAddonPrice;

        console.log('Creating booking:', {
          service: wizardData.service,
          size: wizardData.size,
          servicePrice,
          seatAddonPrice,
          asphaltAddonPrice,
          totalPrice
        });

        // Get Stripe payment link FIRST
        const paymentLink = getStripePaymentLink(
          wizardData.service,
          wizardData.size,
          wizardData.seatAddon,
          wizardData.asphaltAddon
        );

        console.log('Payment link:', paymentLink);

        const booking = {
          id: Date.now(),
          name: wizardData.name.trim(),
          email: wizardData.email.trim(),
          phone: wizardData.phone.trim(),
          service: wizardData.service,
          size: wizardData.size,
          registration: wizardData.registration.trim(),
          date: dateString,
          time: wizardData.time,
          seatAddon: wizardData.seatAddon || 'none',
          asphaltAddon: wizardData.asphaltAddon || 'none',
          price: totalPrice,
          paymentStatus: 'Pending',
          timestamp: new Date().toISOString(),
          pickup: wizardData.pickup || false,
          pickupAddress: wizardData.pickup ? (wizardData.pickupAddress || '') : '',
          sortKey: new Date(
            wizardData.date.getFullYear(),
            wizardData.date.getMonth(),
            wizardData.date.getDate(),
            parseInt(wizardData.time.split(':')[0], 10),
            parseInt(wizardData.time.split(':')[1] || '0', 10)
          ).getTime()
        };

        if (paymentLink) {
          console.log('Redirecting to Stripe:', paymentLink);
          await savePendingBooking(booking);
          setPendingBookingCookie(booking.id);
          sessionStorage.setItem('pendingBooking', JSON.stringify(booking));
          window.location.href = getStripeCheckoutUrl(paymentLink, booking.id);
        } else {
          console.log('No payment link, saving booking as pending');
          
          if (canUseFirestore()) {
            await savePendingBooking(booking);
            console.log('Pending booking saved to Firestore');
          } else {
            if (!Array.isArray(cachedBookings)) cachedBookings = [];
            cachedBookings.push({ id: Date.now().toString(), ...booking });
            writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
            console.log('Booking saved to localStorage');
          }
          
          alert('✅ Bokning mottagen!\n\nVi kontaktar dig snart angående betalning.\nBekräftelse skickas till: ' + wizardData.email);
          location.reload();
        }
      } catch (error) {
        console.error('Booking error:', error);
        wizardSubmitBtn.disabled = false;
        wizardSubmitBtn.textContent = 'Betala & Bekräfta';
        alert('❌ Något gick fel vid bokningen.\n\nFörsök igen eller ring oss på 073-754 22 20.\n\nFelmeddelande: ' + error.message);
      }
    });
  }
  
  // Initialize wizard
  updateWizardStep(1);
});
