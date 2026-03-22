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
  return Date.now() < ownerAccessState.authenticatedUntil;
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
  'basic': 20,
  'interior-wash': 40,
  'premium': 100,
  'inout': 240,
  'interior': 180,
  'full': 210
};
let serviceDurations = { ...DEFAULT_SERVICE_DURATIONS };

const SERVICE_LABELS = {
  'basic': 'Utvändig Handtvätt',
  'interior-wash': 'Invändig Tvätt',
  'premium': 'Komplett In- & Utvändig Tvätt',
  'inout': 'In- & Utvändig Tvätt Med Sätten',
  'interior': 'Hel Glans',
  'full': 'Fullservice Rekond'
};

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
  // Välj tjänst i dropdown
  const serviceMap = {
    'basic': 'basic',
    'interior-wash': 'interior-wash',
    'premium': 'premium',
    'inout': 'inout',
    'interior': 'interior',
    'full': 'full'
  };

  document.getElementById('service').value = serviceMap[serviceId] || '';

  // set size if provided or default small
  const sizeInput = document.getElementById('size');
  sizeInput.value = chosenSize || 'small';

  // Uppdatera priset automatiskt
  handleServiceChange();

  // sync add-on from service card (for supported services)
  if (serviceSupportsSeatAddon(serviceId)) {
    setSeatAddonSelection(chosenSeatAddon || 'none');
    handleSeatAddonChange();
  }

  if (serviceSupportsAsphaltAddon(serviceId)) {
    setAsphaltAddonSelection(chosenAsphaltAddon || 'none');
    handleAsphaltAddonChange();
  }

  // Scrolla till booking-sektionen
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
  'basic': { small: 199, medium: 249, large: 279 },
  'interior-wash': { small: 249, medium: 279, large: 300 },
  'premium': { small: 399, medium: 449, large: 479 },
  'inout': { small: 1000, medium: 1300, large: 1500 },
  'interior': { small: 1500, medium: 1700, large: 1900 },
  'full': { small: 2000, medium: 2300, large: 2600 }
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
  'full|large|5|none': 'https://buy.stripe.com/00wdRb9fy7QwaylbCvasg0A'
};

function buildStripeLinkKey(service, size, seatAddonType, asphaltAddonType) {
  return `${service}|${size}|${seatAddonType || 'none'}|${asphaltAddonType || 'none'}`;
}

function getStripePaymentLink(service, size, seatAddonType, asphaltAddonType) {
  if (!service || !size) return null;
  const key = buildStripeLinkKey(service, size, seatAddonType, asphaltAddonType);
  return STRIPE_PAYMENT_LINKS[key] || null;
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
  } catch (err) {
    console.error('Pending booking save error:', err);
    alert('Kunde inte starta betalningen just nu. Försök igen om en stund.');
    return;
  }

  window.location.href = paymentLink;
});

// ===== BOOKING STORAGE & OWNER VIEW HELPERS =====
let cachedBookings = [];

async function saveBooking(booking) {
  if (!canUseFirestore()) {
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => a.sortKey - b.sortKey);
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
    return;
  }
  try {
    await window.db.collection('bookings').doc(String(booking.id)).set(booking);
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => a.sortKey - b.sortKey);
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  } catch (e) {
    console.error('Firebase save error:', e);
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => a.sortKey - b.sortKey);
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
    cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
    return;
  }
  try {
    const snapshot = await window.db.collection('bookings').get();
    cachedBookings = snapshot.docs.map(doc => doc.data());
    cachedBookings.sort((a, b) => a.sortKey - b.sortKey);
    writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
  } catch (e) {
    console.error('Firebase load error:', e);
    cachedBookings = readLocalArray(LOCAL_STORAGE_KEYS.bookings);
    cachedBookings.sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  }
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
  tbody.innerHTML = '';
  if (!bookings.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding:12px;color:var(--text-secondary);">Inga bokningar</td></tr>';
    return;
  }

  bookings.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.name)}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.email || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.phone)}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.registration || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(getServiceLabel(b.service, b.seatAddon, b.asphaltAddon))}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.size || '-')}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.date)}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);">${escapeHtml(b.time)}</td>
      <td style="padding:10px;border-bottom:1px solid var(--border);color:var(--text-primary);"><span style="background:#3d3d00;padding:4px 8px;border-radius:4px;font-size:0.85rem;">${escapeHtml(b.paymentStatus || 'Pending')} - ${b.price ? b.price + ' kr' : '-'}</span></td>
      <td style="padding:10px;border-bottom:1px solid var(--border);"><button class="delete-btn" data-id="${b.id}" style="background:#aa3333;padding:6px 10px;border-radius:6px;border:none;color:#fff;cursor:pointer;">Ta bort</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBooking(btn.dataset.id));
  });
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
  document.body.classList.remove('owner-login-active');
  document.querySelectorAll('.owner-login-overlay').forEach(el => el.remove());

  syncMobilePaymentSection();
  window.addEventListener('resize', syncMobilePaymentSection);

  // Reset scroll to top
  window.scrollTo(0, 0);
  // Load bookings + blocked dates from Firebase so calendar availability is correct
  await loadBookingsFromFirebase();
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
        return;
      }
      try {
        const batch = window.db.batch();
        const snapshot = await window.db.collection('bookings').get();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        cachedBookings = [];
        writeLocalArray(LOCAL_STORAGE_KEYS.bookings, cachedBookings);
      } catch (e) {
        console.error('Firebase clear error:', e);
      }
      renderBookingsTable();
      alert('Bokningar rensade');
    }
  });

  const closeOwnerBtn = document.getElementById('closeOwnerBtn');
  if (closeOwnerBtn) closeOwnerBtn.addEventListener('click', function() {
    const ownerSection = document.getElementById('ownerSection');
    if (ownerSection) ownerSection.style.display = 'none';
  });
});
