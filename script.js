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


// Days that are closed (empty array means all days are available)
const closedDays = [];

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
    const openingHours = getOpeningHours(dayDate);
    
    // Check if date is in the past
    if (dayDate < today) {
      day.className = 'day past';
      day.textContent = date;
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
document.getElementById('prevMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
  updateMonthYear();
});

// Next month
document.getElementById('nextMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
  updateMonthYear();
});

// convert HH:MM to minutes past midnight
function slotToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
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

  const hours = getOpeningHours(date);
  if (!hours) return false;

  const bookings = getBookingsForDate(date);

  const requestStart = slotToMinutes(time);
  const requestDuration = bookingDuration(requestedService, seatAddonType, asphaltAddonType);
  const requestEnd = requestStart + requestDuration;

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
document.getElementById('bookBtn').addEventListener('click', () => {
  document.getElementById('services').scrollIntoView({ behavior: 'smooth' });
});

// Service prices by size
const servicePrices = {
  'basic': { small: 199, medium: 249, large: 279 },
  'interior-wash': { small: 249, medium: 279, large: 300 },
  'premium': { small: 399, medium: 449, large: 479 },
  'inout': { small: 1000, medium: 1300, large: 1500 },
  'interior': { small: 1500, medium: 1700, large: 1900 },
  'full': { small: 2000, medium: 2300, large: 2600 }
};

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
}

document.getElementById('service').addEventListener('change', handleServiceChange);
document.getElementById('size').addEventListener('change', updatePriceDisplay);
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
document.getElementById('bookingForm').addEventListener('submit', async function(e) {
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

  // Save to Firebase for owner view
  await saveBooking(booking);

  // Send email notification via Formspree (to owner)
  fetch('https://formspree.io/f/mgoydkqd', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      email: email,
      phone: phone,
      registration: registration,
      service: service,
      serviceLabel: SERVICE_LABELS[service] || service,
      seatAddon: seatAddonLabel || 'Ingen',
      asphaltAddon: asphaltAddonLabel || 'Ingen',
      price: computedPrice + ' kr',
      size: size,
      date: dateString,
      time: selectedTime,
      paymentStatus: 'Pending',
      _replyto: email,
      _subject: `Ny bokning från ${name}`
    })
  })
  .then(response => {
    if (response.ok) {
      console.log('Formspree: Email sent successfully');
    } else {
      console.error('Formspree error:', response.status);
    }
    return response.json();
  })
  .then(data => {
    console.log('Formspree response:', data);
  })
  .catch(err => {
    console.error('Formspree fetch error:', err);
  });

  const serviceLabel = SERVICE_LABELS[service] || service;
  const message = `Bokning mottagen!\n\nNamn: ${name}\nE-post: ${email}\nTelefon: ${phone}\nRegistreringsnummer: ${registration}\nTjänst: ${serviceLabel}${addonLabel ? ` + ${addonLabel}` : ''} (${size})\nPris: ${computedPrice} kr\nDatum: ${dateString}\nTid: ${selectedTime}\n\nBetalning: Väntar på Stripe-integrering\n\nVi kontaktar dig snart för bekräftelse!`;
  alert(message);

  // Reset form
  document.getElementById('bookingForm').reset();
  document.querySelectorAll('#seatAddonButtons .addon-btn').forEach(b => b.classList.remove('active'));
  const noneBtn = document.querySelector('#seatAddonButtons .addon-btn[data-addon="none"]');
  if (noneBtn) noneBtn.classList.add('active');
  document.querySelectorAll('#asphaltAddonButtons .addon-btn').forEach(b => b.classList.remove('active'));
  const asphaltNoneBtn = document.querySelector('#asphaltAddonButtons .addon-btn[data-addon="none"]');
  if (asphaltNoneBtn) asphaltNoneBtn.classList.add('active');
  updateSeatAddonVisibility();
  updateAsphaltAddonVisibility();
  document.getElementById('totalPrice').textContent = '-';
  selectedDate = null;
  selectedTime = null;
  document.getElementById('timesSection').style.display = 'none';
  renderCalendar();
  updateCalendarHint();
});

// ===== BOOKING STORAGE & OWNER VIEW HELPERS =====
let cachedBookings = [];

async function saveBooking(booking) {
  try {
    await window.db.collection('bookings').doc(String(booking.id)).set(booking);
    cachedBookings.push(booking);
    cachedBookings.sort((a, b) => a.sortKey - b.sortKey);
  } catch (e) {
    console.error('Firebase save error:', e);
  }
}

function loadBookings() {
  return cachedBookings;
}

async function loadBookingsFromFirebase() {
  try {
    const snapshot = await window.db.collection('bookings').get();
    cachedBookings = snapshot.docs.map(doc => doc.data());
    cachedBookings.sort((a, b) => a.sortKey - b.sortKey);
  } catch (e) {
    console.error('Firebase load error:', e);
    cachedBookings = [];
  }
}

async function deleteBooking(id) {
  try {
    await window.db.collection('bookings').doc(String(id)).delete();
    cachedBookings = cachedBookings.filter(b => String(b.id) !== String(id));
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
  // Reset scroll to top
  window.scrollTo(0, 0);
  // Load bookings from Firebase so calendar availability is correct
  await loadBookingsFromFirebase();
  loadServiceDurationsFromCards();
  initCalendar();
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
    ownerLink.addEventListener('click', function(e) {
      e.preventDefault();
      const pin = prompt('Ange ägar-PIN för att visa bokningar:');
      if (pin === '1234') {
        const ownerSection = document.getElementById('ownerSection');
        if (ownerSection) {
          ownerSection.style.display = 'block';
          renderBookingsTable();
          ownerSection.scrollIntoView({ behavior: 'smooth' });
        }
      } else if (pin !== null) {
        alert('Fel PIN');
      }
    });
  }

  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);

  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', async function() {
    if (confirm('Rensa alla bokningar? Detta kan inte ångras.')) {
      try {
        const batch = window.db.batch();
        const snapshot = await window.db.collection('bookings').get();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        cachedBookings = [];
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
