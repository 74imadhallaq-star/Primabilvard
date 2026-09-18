(function () {
  const checkoutEndpoint = window.PRODUCT_CHECKOUT_ENDPOINT || 'https://europe-west1-primabilvard-6c99e.cloudfunctions.net/createProductCheckout';
  let products = [];
  const demoProducts = [
    { id: 'demo-dvx-schampo', name: 'DVx Exempel: Snow Foam Schampo', category: 'Tvätt', description: 'Ett skummande bilschampo för en ren och blank finish.', price: 249, imageUrl: 'bil1.PNG', active: true },
    { id: 'demo-dvx-falg', name: 'DVx Exempel: Fälgrengöring', category: 'Fälg & däck', description: 'Effektiv rengöring för fälgar och bromsdamm.', price: 199, imageUrl: 'bil2.png', active: true },
    { id: 'demo-dvx-mikrofiber', name: 'DVx Exempel: Mikrofiberpaket', category: 'Tillbehör', description: 'Mjuka dukar för torkning, polering och finish.', price: 149, imageUrl: 'bil3.PNG', active: true }
  ];

  const money = value => `${Number(value || 0).toLocaleString('sv-SE')} kr`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  const descriptionLimit = 110;

  function normalizeSearchText(value) {
    return String(value || '').toLocaleLowerCase('sv').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function renderDescription(text) {
    const description = String(text || '');
    if (description.length <= descriptionLimit) return `<p class="product-description">${escapeHtml(description)}</p>`;
    const short = description.slice(0, descriptionLimit).trim();
    return `<p class="product-description is-collapsed" data-full="${escapeHtml(description)}" data-short="${escapeHtml(short)}">${escapeHtml(short)}…</p>
      <button type="button" class="product-readmore-button">Läs mer</button>`;
  }

  function displayCategory(product) {
    if (product.category && product.category !== 'Divortex') return product.category;
    const source = [product.name, product.description].filter(Boolean).join(' ').toLocaleLowerCase('sv');
    if (/pol(er|ish)|rondell|polermaskin|poleringsverktyg/.test(source)) return 'Polering';
    if (/fälg|falg|däck|dack|hjul/.test(source)) return 'Fälg & däck';
    if (/schampo|snow foam|skum|tvätt|tvatt|avfett|rengör|rengor/.test(source)) return 'Tvätt & rengöring';
    if (/vax|keram|coating|lackskydd|förseg|forseg/.test(source)) return 'Lackskydd';
    if (/läder|lader|vinyl|interiör|interior|textil|plast/.test(source)) return 'Interiör';
    if (/mikrofiber|handduk|handske|borste|pensel|tillbehör|tillbehor/.test(source)) return 'Tillbehör';
    if (/verktyg|dammsug|tryckluft|kompressor/.test(source)) return 'Verktyg & utrustning';
    return product.category || 'Övrig bilvård';
  }

  async function loadProducts() {
    const grid = document.getElementById('productGrid');
    try {
      const snapshot = await window.db.collection('products').where('active', '==', true).get();
      products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const fulfillmentOrder = Number(a.pickupAvailable === false) - Number(b.pickupAvailable === false);
          return fulfillmentOrder || String(a.name || '').localeCompare(String(b.name || ''), 'sv');
        });
      if (!products.length) products = demoProducts;
      fillCategoryFilter();
      renderProducts();
    } catch (error) {
      console.error('Product load error:', error);
      products = demoProducts;
      fillCategoryFilter();
      renderProducts();
    }
  }

  function fillCategoryFilter() {
    const filter = document.getElementById('categoryFilter');
    const categories = [...new Set(products.map(displayCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
    filter.innerHTML = '<option value="all">Alla produkter</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    filter.onchange = renderProducts;
  }

  function renderProducts() {
    const grid = document.getElementById('productGrid');
    const category = document.getElementById('categoryFilter').value;
    const searchTerms = normalizeSearchText(document.getElementById('productSearch')?.value).split(/\s+/).filter(Boolean);
    const visible = products.filter(product => {
      const productCategory = displayCategory(product);
      const matchesCategory = category === 'all' || productCategory === category;
      const searchable = normalizeSearchText([product.name, product.description, productCategory].filter(Boolean).join(' '));
      const matchesSearch = searchTerms.every(term => searchable.includes(term));
      return matchesCategory && matchesSearch;
    });
    if (!visible.length) {
      grid.innerHTML = '<div class="shop-empty">Inga produkter i denna kategori ännu.</div>';
      return;
    }
    grid.innerHTML = visible.map(product => {
      const outOfStock = product.outOfStock === true;
      const pickupAvailable = product.pickupAvailable !== false;
      const image = product.imageUrl
        ? `<img class="product-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">`
        : '<div class="product-image product-image-placeholder" aria-hidden="true">✦</div>';
      return `<article class="product-card">
        ${image}
        <div class="product-card-body">
          <p class="product-category">${escapeHtml(displayCategory(product))}</p>
          <h3>${escapeHtml(product.name)}</h3>
          ${renderDescription(product.description)}
          ${outOfStock ? '<p class="product-stock out">Tillfälligt slut i lager</p>' : ''}
          <p class="product-fulfillment-badge ${pickupAvailable ? 'in-store' : 'shipping-only'}">${pickupAvailable ? '🏬 Finns i butiken & frakt' : '🚚 Endast frakt'}</p>
          <div class="product-footer"><span class="product-price">${money(product.price)}</span><button type="button" class="shop-primary-button" data-add-product="${escapeHtml(product.id)}" ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'Slut i lager' : 'Lägg i varukorg'}</button></div>
        </div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-add-product]').forEach(button => button.addEventListener('click', () => {
      const product = products.find(item => item.id === button.dataset.addProduct);
      if (!product) return;
      window.productCart.add(product);
      document.getElementById('cartDrawer').classList.add('is-open');
      renderCart();
    }));
    grid.querySelectorAll('.product-readmore-button').forEach(button => button.addEventListener('click', () => {
      const description = button.previousElementSibling;
      const expanded = description.classList.toggle('is-collapsed') === false;
      description.textContent = expanded ? description.dataset.full : `${description.dataset.short}…`;
      button.textContent = expanded ? 'Läs mindre' : 'Läs mer';
    }));
  }

  function renderCart() {
    const itemsNode = document.getElementById('cartItems');
    const cart = window.productCart.get();
    if (!cart.length) itemsNode.innerHTML = '<div class="shop-empty">Din varukorg är tom.</div>';
    else itemsNode.innerHTML = cart.map(item => `<div class="cart-line">
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : '<div class="product-image-placeholder">✦</div>'}
      <div><h3>${escapeHtml(item.name)}</h3><p>${money(item.price)} / st</p><div class="cart-quantity"><button type="button" data-decrease="${escapeHtml(item.id)}" aria-label="Minska antal">−</button><span>${item.quantity}</span><button type="button" data-increase="${escapeHtml(item.id)}" aria-label="Öka antal">+</button></div><button class="cart-remove" type="button" data-remove="${escapeHtml(item.id)}">Ta bort</button></div>
      <span class="cart-line-total">${money(item.price * item.quantity)}</span>
    </div>`).join('');
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    document.getElementById('cartTotal').textContent = money(total);
    document.getElementById('checkoutButton').disabled = cart.length === 0;
    itemsNode.querySelectorAll('[data-increase]').forEach(button => button.addEventListener('click', () => changeQuantity(button.dataset.increase, 1)));
    itemsNode.querySelectorAll('[data-decrease]').forEach(button => button.addEventListener('click', () => changeQuantity(button.dataset.decrease, -1)));
    itemsNode.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => { window.productCart.remove(button.dataset.remove); renderCart(); }));
  }

  function changeQuantity(id, amount) {
    const item = window.productCart.get().find(entry => String(entry.id) === String(id));
    if (item) window.productCart.setQuantity(id, item.quantity + amount);
    renderCart();
  }

  async function startCheckout() {
    const button = document.getElementById('checkoutButton');
    const cart = window.productCart.get();
    if (!cart.length) return;
    button.disabled = true;
    button.textContent = 'Förbereder kassan...';
    try {
      const response = await fetch(checkoutEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.map(item => ({ id: item.id, quantity: item.quantity })) }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Checkout kunde inte startas');
      sessionStorage.setItem('pendingProductCheckout', JSON.stringify({
        sessionId: String(result.sessionId || ''),
        amount: Number(result.amount) || 0,
        currency: String(result.currency || 'SEK')
      }));
      window.location.href = result.url;
    } catch (error) {
      console.error('Product checkout error:', error);
      alert('Kassan kunde inte startas just nu. Försök igen om en stund.');
      button.disabled = false;
      button.textContent = 'Gå till kassan';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.db || !window.productCart) return;
    document.getElementById('checkoutButton').addEventListener('click', startCheckout);
    document.getElementById('productSearch')?.addEventListener('input', renderProducts);
    window.addEventListener('productCartChanged', renderCart);
    renderCart();
    loadProducts();
  });
})();
