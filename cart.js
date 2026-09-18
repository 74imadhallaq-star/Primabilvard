(function () {
  const CART_KEY = 'primabilvard_product_cart_v1';

  function readCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && item.id && item.quantity > 0) : [];
    } catch (_) {
      return [];
    }
  }

  function writeCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent('productCartChanged', { detail: cart }));
  }

  function storePendingProductCheckout(checkout) {
    sessionStorage.setItem('pendingProductCheckout', JSON.stringify({
      sessionId: String(checkout && checkout.sessionId || ''),
      transactionId: String(checkout && checkout.transactionId || ''),
      amount: Number(checkout && checkout.amount) || 0,
      currency: String(checkout && checkout.currency || 'SEK')
    }));
  }

  function cartCount() {
    return readCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }

  function updateBadges() {
    const count = cartCount();
    const label = count > 9 ? '9+' : String(count);
    document.querySelectorAll('[data-cart-count]').forEach(node => {
      node.textContent = label;
      node.hidden = count === 0;
    });
  }

  const money = value => `${Number(value || 0).toLocaleString('sv-SE')} kr`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));

  function ensureSharedDrawer() {
    if (document.getElementById('sharedCartDrawer') || document.getElementById('cartDrawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <aside id="sharedCartDrawer" class="shared-cart-drawer" aria-label="Varukorg">
        <div class="shared-cart-header"><div><p class="shared-cart-eyebrow">Din beställning</p><h2>Varukorg</h2></div><button type="button" class="shared-cart-close" data-cart-close aria-label="Stäng varukorg">×</button></div>
        <div class="shared-cart-items" data-shared-cart-items></div>
        <div class="shared-cart-total"><span>Summa produkter</span><strong data-shared-cart-total>0 kr</strong></div>
        <p class="shared-cart-note">Frakt eller upphämtning väljs i kassan.</p>
        <button type="button" class="shared-cart-checkout" data-shared-cart-checkout disabled>Gå till kassan</button>
      </aside><div class="shared-cart-backdrop" data-cart-close></div>`);
  }

  function openDrawer() {
    ensureSharedDrawer();
    document.getElementById('sharedCartDrawer')?.classList.add('is-open');
  }

  function closeDrawer() {
    document.getElementById('sharedCartDrawer')?.classList.remove('is-open');
  }

  function renderSharedDrawer() {
    const itemsNode = document.querySelector('[data-shared-cart-items]');
    if (!itemsNode) return;
    const cart = readCart();
    itemsNode.innerHTML = cart.length ? cart.map(item => `
      <div class="shared-cart-line">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : '<span class="shared-cart-line-placeholder" aria-hidden="true"></span>'}
        <div><h3>${escapeHtml(item.name)}</h3><p>${money(item.price)} / st</p><div class="shared-cart-quantity"><button type="button" data-shared-decrease="${escapeHtml(item.id)}" aria-label="Minska antal">−</button><span>${item.quantity}</span><button type="button" data-shared-increase="${escapeHtml(item.id)}" aria-label="Öka antal">+</button></div><button type="button" class="shared-cart-remove" data-shared-remove="${escapeHtml(item.id)}">Ta bort</button></div>
        <strong>${money(item.price * item.quantity)}</strong>
      </div>`).join('') : '<div class="shared-cart-empty">Din varukorg är tom.</div>';
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const totalNode = document.querySelector('[data-shared-cart-total]');
    if (totalNode) totalNode.textContent = money(total);
    const checkout = document.querySelector('[data-shared-cart-checkout]');
    if (checkout) checkout.disabled = !cart.length;
    itemsNode.querySelectorAll('[data-shared-increase]').forEach(button => button.addEventListener('click', () => changeSharedQuantity(button.dataset.sharedIncrease, 1)));
    itemsNode.querySelectorAll('[data-shared-decrease]').forEach(button => button.addEventListener('click', () => changeSharedQuantity(button.dataset.sharedDecrease, -1)));
    itemsNode.querySelectorAll('[data-shared-remove]').forEach(button => button.addEventListener('click', () => { window.productCart.remove(button.dataset.sharedRemove); }));
  }

  function changeSharedQuantity(id, amount) {
    const item = readCart().find(entry => String(entry.id) === String(id));
    if (item) window.productCart.setQuantity(id, item.quantity + amount);
  }

  async function startSharedCheckout() {
    const cart = readCart();
    if (!cart.length) return;
    const button = document.querySelector('[data-shared-cart-checkout]');
    if (button) { button.disabled = true; button.textContent = 'Förbereder kassan...'; }
    try {
      const endpoint = window.PRODUCT_CHECKOUT_ENDPOINT || 'https://europe-west1-primabilvard-6c99e.cloudfunctions.net/createProductCheckout';
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.map(item => ({ id: item.id, quantity: item.quantity })) }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Checkout kunde inte startas');
      storePendingProductCheckout(result);
      window.location.href = result.url;
    } catch (error) {
      console.error('Product checkout error:', error);
      alert('Kassan kunde inte startas just nu. Försök igen om en stund.');
      if (button) { button.disabled = false; button.textContent = 'Gå till kassan'; }
    }
  }

  window.productCart = {
    get: readCart,
    add(product, quantity = 1) {
      const cart = readCart();
      const existing = cart.find(item => String(item.id) === String(product.id));
      if (existing) existing.quantity += quantity;
      else cart.push({
        id: String(product.id),
        name: String(product.name || ''),
        price: Number(product.price || 0),
        imageUrl: String(product.imageUrl || ''),
        quantity
      });
      writeCart(cart);
    },
    setQuantity(id, quantity) {
      const cart = readCart().map(item => String(item.id) === String(id)
        ? { ...item, quantity: Math.max(0, Math.floor(Number(quantity) || 0)) }
        : item
      ).filter(item => item.quantity > 0);
      writeCart(cart);
    },
    remove(id) {
      writeCart(readCart().filter(item => String(item.id) !== String(id)));
    },
    clear() {
      writeCart([]);
    },
    count: cartCount
  };
  window.storePendingProductCheckout = storePendingProductCheckout;

  function bindHamburgerMenu() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    const navOverlay = document.getElementById('navOverlay');
    if (!hamburger || !navMenu) return;

    function openMenu() {
      hamburger.classList.add('open');
      navMenu.classList.add('open');
      if (navOverlay) navOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
      hamburger.classList.remove('open');
      navMenu.classList.remove('open');
      if (navOverlay) navOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', () => {
      hamburger.classList.contains('open') ? closeMenu() : openMenu();
    });
    if (navOverlay) navOverlay.addEventListener('click', closeMenu);
    navMenu.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', closeMenu));
  }

  function bindButtons() {
    const noCart = document.body.hasAttribute('data-no-cart');

    document.querySelectorAll('[data-cart-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const drawer = document.getElementById('cartDrawer') || document.getElementById('sharedCartDrawer');
        if (drawer) drawer.classList.toggle('is-open');
        else if (!noCart) openDrawer();
      });
    });

    if (!noCart) {
      ensureSharedDrawer();
      document.querySelectorAll('[data-cart-close]').forEach(button => button.addEventListener('click', closeDrawer));
      document.querySelector('[data-shared-cart-checkout]')?.addEventListener('click', startSharedCheckout);
      renderSharedDrawer();
      updateBadges();
    }

    bindHamburgerMenu();
  }

  document.addEventListener('DOMContentLoaded', bindButtons);
  window.addEventListener('productCartChanged', () => {
    if (!document.body.hasAttribute('data-no-cart')) {
      updateBadges();
      renderSharedDrawer();
    }
  });
})();
