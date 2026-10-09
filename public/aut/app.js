/*
 * Bloomly — the application under test.
 *
 * Runs in two modes:
 *  - inside the trainer (iframe): the parent window exposes `__bloomlyCtx`
 *    with config (bugs, latency), an isolated storage ("browser context")
 *    and navigation hooks. Routing uses the URL hash.
 *  - standalone (e.g. `npx serve -s app` for real Playwright): config comes
 *    from the query string (?bugs=a,b&cookies=1), storage is localStorage,
 *    routing uses the History API.
 */
(function () {
  'use strict';

  var ctx = null;
  try {
    if (window.parent !== window && window.parent.__bloomlyCtx) ctx = window.parent.__bloomlyCtx;
  } catch (e) { /* cross-origin parent: standalone */ }

  var params = new URLSearchParams(location.search);
  var config = ctx ? (ctx.config || {}) : {
    bugs: (params.get('bugs') || '').split(',').filter(Boolean),
    latency: {},
    cookieBanner: params.get('cookies') === '1',
  };
  config.bugs = config.bugs || [];
  config.latency = config.latency || {};

  function bug(name) { return config.bugs.indexOf(name) !== -1; }

  var hashMode = !!ctx || location.hash.indexOf('#/') === 0;
  var scriptUrl = document.currentScript.src;
  function asset(p) { return new URL(p, scriptUrl).href; }

  var store = ctx ? {
    get: function (k, d) { return Object.prototype.hasOwnProperty.call(ctx.storage, k) ? JSON.parse(ctx.storage[k]) : d; },
    set: function (k, v) { ctx.storage[k] = JSON.stringify(v); },
    remove: function (k) { delete ctx.storage[k]; },
  } : {
    get: function (k, d) { try { var v = localStorage.getItem('bloomly:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('bloomly:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    remove: function (k) { try { localStorage.removeItem('bloomly:' + k); } catch (e) { /* ignore */ } },
  };

  // Network-like delay. config.latency[name] = ms | [min, max]
  function delay(name, fallback) {
    var l = config.latency[name];
    var ms = fallback;
    if (typeof l === 'number') ms = l;
    else if (Array.isArray(l)) ms = l[0] + Math.random() * (l[1] - l[0]);
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '€' + (Math.round(n * 100) / 100).toFixed(2); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  var DATA = null;
  var main = $('#main');
  var nav = $('#main-nav');
  var renderToken = 0;

  // ---------- data helpers ----------
  function allUsers() { return DATA.users.concat(store.get('users', [])); }
  function sessionUser() {
    var email = store.get('session', null);
    if (!email) return null;
    return allUsers().find(function (u) { return u.email === email; }) || null;
  }
  function product(id) { return DATA.products.find(function (p) { return p.id === id; }); }
  function cart() { return store.get('cart', []); }
  function cartCount() { return cart().reduce(function (s, i) { return s + i.qty; }, 0); }
  function allOrders() { return DATA.orders.concat(store.get('orders', [])); }

  // ---------- routing ----------
  function currentPath() {
    if (hashMode) return location.hash.slice(1) || '/';
    return location.pathname + location.search;
  }
  function navigate(path, replace) {
    if (hashMode) {
      if (location.hash === '#' + path) { render(); return; }
      if (replace || ctx) location.replace('#' + path);
      else location.hash = path;
    } else {
      history[replace ? 'replaceState' : 'pushState']({}, '', path);
      render();
    }
  }
  window.addEventListener(hashMode ? 'hashchange' : 'popstate', function () { render(); });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (a) {
      var href = a.getAttribute('href');
      if (href && href.charAt(0) === '/') { e.preventDefault(); navigate(href); }
      return;
    }
    var act = e.target.closest && e.target.closest('[data-action]');
    if (!act) return;
    var action = act.getAttribute('data-action');
    if (action === 'logout') { store.remove('session'); navigate('/'); }
    if (action === 'cookies-accept' || action === 'cookies-reject') {
      store.set('cookies', action === 'cookies-accept' ? 'accepted' : 'rejected');
      $('#cookie-root').innerHTML = '';
    }
  });

  function setTitle(t) { document.title = t; }

  function renderNav() {
    var user = sessionUser();
    nav.innerHTML =
      '<a href="/shop">Shop</a>' +
      '<a href="/orders">Orders</a>' +
      '<a href="/cart" data-testid="cart-link">Cart <span class="badge" data-testid="cart-count">' + cartCount() + '</span></a>' +
      (user
        ? '<span class="user-name" data-testid="user-name">' + esc(user.name.split(' ')[0]) + '</span>' +
          '<button type="button" class="link-btn" data-action="logout">Log out</button>'
        : '<a href="/login">Log in</a>');
  }
  function refreshCartCount() {
    if (bug('cart-count-stale')) return;
    var b = $('[data-testid="cart-count"]');
    if (b) b.textContent = String(cartCount());
  }

  var toastTimer = null;
  function toast(msg) {
    var root = $('#toast-root');
    root.innerHTML = '<div class="toast" role="status" data-testid="toast">' + esc(msg) + '</div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { root.innerHTML = ''; }, 2500);
  }

  function maybeCookieBanner() {
    if (!config.cookieBanner || store.get('cookies', null)) return;
    delay('cookies', 0).then(function () {
      if (store.get('cookies', null)) return;
      $('#cookie-root').innerHTML =
        '<div class="cookie-banner" role="dialog" aria-label="Cookie consent" data-testid="cookie-banner">' +
        '<p>We use cookies to keep your cart and improve Bloomly.</p>' +
        '<div class="row-actions"><button type="button" class="btn secondary" data-action="cookies-reject">Reject</button>' +
        '<button type="button" class="btn" data-action="cookies-accept">Accept all</button></div></div>';
    });
  }

  function requireLogin(path) {
    if (sessionUser()) return true;
    navigate('/login?next=' + encodeURIComponent(path), true);
    return false;
  }

  // Field error helpers for forms
  function setFieldError(input, testid, msg) {
    var id = input.id + '-error';
    var p = document.getElementById(id);
    if (!msg) {
      if (p) p.remove();
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      return;
    }
    if (!p) {
      p = document.createElement('p');
      p.className = 'field-error';
      p.id = id;
      p.setAttribute('data-testid', testid);
      var anchor = input.closest('fieldset') || input.closest('label.check') || input;
      anchor.insertAdjacentElement('afterend', p);
    }
    p.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id);
  }

  // ---------- pages ----------
  function pageHome(el) {
    setTitle('Bloomly — Fresh flowers delivered');
    el.innerHTML =
      '<section class="hero">' +
      '<h1>Fresh flowers, delivered with love</h1>' +
      '<p class="muted">Bouquets and plants from local growers in Lisbon, Berlin and Warsaw.</p>' +
      '<a href="/shop" class="btn">Shop now</a>' +
      '</section>' +
      '<h2>Why Bloomly?</h2>' +
      '<ul class="features">' +
      '<li><strong>Same-day delivery</strong><br>Order before 2 pm.</li>' +
      '<li><strong>Free delivery over €50</strong><br>Anywhere in the city.</li>' +
      '<li><strong>7-day freshness</strong><br>Or we replace your flowers.</li>' +
      '</ul>';
  }

  function pageLogin(el, q) {
    if (sessionUser()) { navigate('/account', true); return; }
    setTitle('Log in · Bloomly');
    el.innerHTML =
      '<h1>Log in</h1>' +
      '<p class="muted">Welcome back! Use your Bloomly account.</p>' +
      '<form id="login-form" class="stack" novalidate>' +
      '<div role="alert" class="error" data-testid="login-error" hidden></div>' +
      '<label for="email">Email</label>' +
      '<input id="email" name="email" type="text" inputmode="email" autocomplete="email" placeholder="you@example.com">' +
      '<label for="password">Password</label>' +
      '<input id="password" name="password" type="password" autocomplete="current-password" placeholder="Your password">' +
      '<label class="check"><input type="checkbox" id="remember" name="remember"> Remember me</label>' +
      '<button type="submit" class="btn" data-testid="login-button">Log in</button>' +
      '</form>' +
      '<p>New to Bloomly? <a href="/signup">Create an account</a></p>' +
      '<p class="hint">Demo account: anna@bloomly.app / bloom123</p>';

    var form = $('#login-form', el);
    var box = $('[data-testid="login-error"]', el);
    var btn = $('[data-testid="login-button"]', el);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#email', el).value;
      var pw = $('#password', el).value;
      if (!bug('login-trim')) email = email.trim();
      if (!bug('login-case-sensitive')) email = email.toLowerCase();
      function fail(msg, isAuth) {
        if (isAuth && bug('login-no-error')) return;
        box.textContent = msg;
        box.hidden = false;
      }
      box.hidden = true;
      if (!email) return fail('Please enter your email.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.');
      if (!pw) return fail('Please enter your password.');
      btn.disabled = true;
      btn.textContent = 'Logging in…';
      delay('login', 250).then(function () {
        btn.disabled = false;
        btn.textContent = 'Log in';
        var user = allUsers().find(function (u) { return u.email === email; });
        if (!user || user.password !== pw) return fail('Invalid email or password.', true);
        if (user.locked) return fail('Your account is locked. Please contact support.');
        store.set('session', user.email);
        var next = q.get('next');
        navigate(bug('login-redirect-home') ? '/' : (next && next.charAt(0) === '/' ? next : '/account'));
      });
    });
  }

  function pageAccount(el) {
    if (!requireLogin('/account')) return;
    var user = sessionUser();
    setTitle('My account · Bloomly');
    var parts = user.name.split(' ');
    var greetName = bug('greeting-wrong-name') ? parts[parts.length - 1] : parts[0];
    el.innerHTML =
      '<h1>Welcome back, ' + esc(greetName) + '!</h1>' +
      '<dl class="details">' +
      '<dt>Name</dt><dd data-testid="account-name">' + esc(user.name) + '</dd>' +
      '<dt>Email</dt><dd data-testid="account-email">' + esc(user.email) + '</dd>' +
      '<dt>City</dt><dd data-testid="account-city">' + esc(user.city || '—') + '</dd>' +
      '<dt>Member since</dt><dd>' + esc(user.memberSince || today()) + '</dd>' +
      '</dl>' +
      '<div class="row-actions"><a class="btn" href="/shop">Go to shop</a><a class="btn secondary" href="/orders">My orders</a></div>';
  }

  function pageSignup(el) {
    setTitle('Create account · Bloomly');
    el.innerHTML =
      '<h1>Create your account</h1>' +
      '<form id="signup-form" class="stack" novalidate>' +
      '<label for="fullName">Full name</label>' +
      '<input id="fullName" name="fullName" autocomplete="name" placeholder="Anna Silva">' +
      '<label for="signupEmail">Email</label>' +
      '<input id="signupEmail" name="email" type="email" autocomplete="email" placeholder="you@example.com">' +
      '<label for="signupPassword">Password</label>' +
      '<input id="signupPassword" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters">' +
      '<label for="country">Country</label>' +
      '<select id="country" name="country">' +
      '<option value="">Choose a country</option><option value="PT">Portugal</option><option value="DE">Germany</option>' +
      '<option value="PL">Poland</option><option value="ES">Spain</option><option value="FR">France</option>' +
      '</select>' +
      '<fieldset><legend>Account type</legend>' +
      '<label class="check"><input type="radio" name="accountType" value="personal" checked> Personal</label>' +
      '<label class="check"><input type="radio" name="accountType" value="business"> Business</label>' +
      '</fieldset>' +
      '<label class="check"><input type="checkbox" id="newsletter" name="newsletter"> Send me the Bloomly newsletter</label>' +
      '<label class="check"><input type="checkbox" id="terms" name="terms"> I agree to the Terms of Service</label>' +
      '<button type="submit" class="btn">Create account</button>' +
      '</form>' +
      '<div role="status" data-testid="signup-success"></div>';

    var form = $('#signup-form', el);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#fullName', el), email = $('#signupEmail', el), pw = $('#signupPassword', el);
      var country = $('#country', el), terms = $('#terms', el);
      var ok = true;
      function check(input, testid, msg) { setFieldError(input, testid, msg); if (msg) ok = false; }
      var emailVal = email.value.trim().toLowerCase();
      check(name, 'name-error', name.value.trim() ? '' : 'Please enter your name.');
      var emailMsg = '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) emailMsg = 'Please enter a valid email address.';
      else if (allUsers().some(function (u) { return u.email === emailVal; })) emailMsg = 'This email is already registered.';
      check(email, 'email-error', emailMsg);
      var minLen = bug('signup-short-password') ? 6 : 8;
      check(pw, 'password-error', pw.value.length >= minLen ? '' : 'Password must be at least 8 characters.');
      check(country, 'country-error', country.value ? '' : 'Please choose a country.');
      if (!bug('signup-terms-ignored')) check(terms, 'terms-error', terms.checked ? '' : 'You must accept the Terms of Service.');
      if (!ok) return;
      var btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = 'Creating account…';
      delay('signup', 250).then(function () {
        var users = store.get('users', []);
        var countryName = country.options[country.selectedIndex].text;
        users.push({ email: emailVal, password: pw.value, name: name.value.trim(), city: countryName, memberSince: today(), locked: false });
        store.set('users', users);
        store.set('session', emailVal);
        renderNav();
        form.hidden = true;
        var first = name.value.trim().split(' ')[0];
        $('[data-testid="signup-success"]', el).innerHTML =
          '<div class="success"><h2>Account created!</h2>' +
          '<p>Welcome to Bloomly, ' + esc(bug('signup-greeting-email') ? emailVal : first) + '.</p>' +
          '<a href="/shop" class="btn">Start shopping</a></div>';
      });
    });
  }

  function pageShop(el, q) {
    setTitle('Shop · Bloomly');
    var state = { q: q.get('q') || '', category: q.get('category') || 'all', sort: q.get('sort') || 'popular' };
    el.innerHTML =
      '<h1>Shop</h1>' +
      '<div class="toolbar">' +
      '<label for="search">Search</label>' +
      '<input id="search" type="search" placeholder="Search flowers" value="' + esc(state.q) + '">' +
      '<label for="category">Category</label>' +
      '<select id="category"><option value="all">All</option><option value="bouquets">Bouquets</option><option value="plants">Plants</option></select>' +
      '<label for="sort">Sort by</label>' +
      '<select id="sort"><option value="popular">Most popular</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select>' +
      '</div>' +
      '<p class="loading" data-testid="products-loading">Loading products…</p>' +
      '<div id="results"></div>';
    $('#category', el).value = state.category;
    $('#sort', el).value = state.sort;
    var token = renderToken;

    function draw() {
      var term = state.q.trim();
      var list = DATA.products.filter(function (p) {
        if (state.category !== 'all' && p.category !== state.category) return false;
        if (!term) return true;
        return bug('search-case-sensitive') ? p.name.indexOf(term) !== -1 : p.name.toLowerCase().indexOf(term.toLowerCase()) !== -1;
      });
      list.sort(function (a, b) {
        if (state.sort === 'popular') return a.popularity - b.popularity;
        if (bug('sort-by-name')) return a.name.localeCompare(b.name);
        return state.sort === 'price-asc' ? a.price - b.price : b.price - a.price;
      });
      var html = '<p data-testid="results-count">' + list.length + (list.length === 1 ? ' product' : ' products') + '</p>';
      if (!list.length) {
        html += '<p data-testid="no-results">No flowers found for “' + esc(term) + '”.</p>';
      } else {
        html += '<ul class="grid" data-testid="product-list">' + list.map(function (p) {
          return '<li><article class="product-card" data-testid="product-card" data-product-id="' + p.id + '">' +
            '<img src="' + asset('img/' + p.img) + '" alt="' + esc(p.alt) + '">' +
            '<h2>' + esc(p.name) + '</h2>' +
            '<p class="price" data-testid="product-price">' + money(p.price) + '</p>' +
            (p.inStock ? '' : '<p class="stock">Out of stock</p>') +
            '<button type="button" class="btn small" data-testid="add-to-cart" data-id="' + p.id + '"' + (p.inStock ? '' : ' disabled') + '>Add to cart</button>' +
            '</article></li>';
        }).join('') + '</ul>';
      }
      $('#results', el).innerHTML = html;
    }

    delay('products', 150).then(function () {
      if (token !== renderToken) return;
      var loading = $('[data-testid="products-loading"]', el);
      if (loading) loading.remove();
      draw();
    });

    $('#search', el).addEventListener('input', function (e) { state.q = e.target.value; if (!$('[data-testid="products-loading"]', el)) draw(); });
    $('#category', el).addEventListener('change', function (e) { state.category = e.target.value; if (!$('[data-testid="products-loading"]', el)) draw(); });
    $('#sort', el).addEventListener('change', function (e) { state.sort = e.target.value; if (!$('[data-testid="products-loading"]', el)) draw(); });
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-testid="add-to-cart"]');
      if (!btn || btn.disabled) return;
      var p = product(btn.getAttribute('data-id'));
      var items = cart();
      var item = items.find(function (i) { return i.id === p.id; });
      var add = bug('add-to-cart-double') ? 2 : 1;
      if (item) item.qty = Math.min(10, item.qty + add);
      else items.push({ id: p.id, qty: add });
      store.set('cart', items);
      refreshCartCount();
      toast(p.name + ' added to cart');
    });
  }

  function cartTotals(items) {
    var subtotal = items.reduce(function (s, i) {
      var p = product(i.id);
      return s + (bug('cart-total-ignores-qty') ? p.price : p.price * i.qty);
    }, 0);
    var promo = store.get('promo', null);
    var discount = 0;
    if (promo) {
      var times = bug('promo-stacks') ? promo.times : 1;
      discount = subtotal * DATA.promoCodes[promo.code].percent / 100 * times;
    }
    var after = Math.max(0, subtotal - discount);
    var free = bug('free-delivery-boundary') ? after > 50 : after >= 50;
    var delivery = items.length && !free ? 4.9 : 0;
    return { subtotal: subtotal, discount: discount, delivery: delivery, total: after + delivery };
  }

  function pageCart(el) {
    setTitle('Cart · Bloomly');
    var items = cart();
    if (!items.length) {
      el.innerHTML =
        '<h1>Your cart</h1>' +
        '<p data-testid="cart-empty">Your cart is empty.</p>' +
        '<a href="/shop" class="btn">Continue shopping</a>';
      return;
    }
    var t = cartTotals(items);
    var promo = store.get('promo', null);
    el.innerHTML =
      '<h1>Your cart</h1>' +
      '<table data-testid="cart-table"><caption>Items in your cart</caption>' +
      '<thead><tr><th scope="col">Product</th><th scope="col">Price</th><th scope="col">Quantity</th><th scope="col">Subtotal</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>' +
      '<tbody>' + items.map(function (i, idx) {
        var p = product(i.id);
        return '<tr data-testid="cart-row" data-id="' + p.id + '">' +
          '<td>' + esc(p.name) + '</td>' +
          '<td>' + money(p.price) + '</td>' +
          '<td><div class="qty">' +
          '<button type="button" data-qty="-1" data-idx="' + idx + '" aria-label="Decrease ' + esc(p.name) + '"' + (i.qty <= 1 ? ' disabled' : '') + '>−</button>' +
          '<input type="number" min="1" max="10" value="' + i.qty + '" data-idx="' + idx + '" data-testid="qty-input" aria-label="Quantity of ' + esc(p.name) + '">' +
          '<button type="button" data-qty="1" data-idx="' + idx + '" aria-label="Increase ' + esc(p.name) + '"' + (i.qty >= 10 ? ' disabled' : '') + '>+</button>' +
          '</div></td>' +
          '<td data-testid="row-subtotal">' + money(p.price * i.qty) + '</td>' +
          '<td><button type="button" class="link-btn" data-testid="remove-item" data-idx="' + idx + '">Remove</button></td>' +
          '</tr>';
      }).join('') + '</tbody></table>' +
      '<div class="promo">' +
      '<label for="promo">Promo code</label>' +
      '<input id="promo" placeholder="e.g. BLOOM10" value="' + (promo ? esc(promo.code) : '') + '">' +
      '<button type="button" class="btn small secondary" id="apply-promo">Apply</button>' +
      '<p data-testid="promo-message" role="status">' + (promo ? 'Promo code ' + esc(promo.code) + ' applied: −' + DATA.promoCodes[promo.code].percent + '%.' : '') + '</p>' +
      '</div>' +
      '<dl class="summary">' +
      '<dt>Subtotal</dt><dd data-testid="cart-subtotal">' + money(t.subtotal) + '</dd>' +
      '<dt>Discount</dt><dd data-testid="cart-discount">−' + money(t.discount) + '</dd>' +
      '<dt>Delivery</dt><dd data-testid="cart-delivery">' + (t.delivery ? money(t.delivery) : 'Free') + '</dd>' +
      '<dt class="total">Total</dt><dd class="total" data-testid="cart-total">' + money(t.total) + '</dd>' +
      '</dl>' +
      '<div class="row-actions"><a href="/shop" class="btn secondary">Continue shopping</a>' +
      '<button type="button" class="btn" data-testid="checkout-button">Proceed to checkout</button></div>';

    function save(next) { store.set('cart', next); refreshCartCount(); render(); }

    el.addEventListener('click', function (e) {
      var q = e.target.closest('[data-qty]');
      if (q && !q.disabled) {
        var list = cart();
        var it = list[+q.getAttribute('data-idx')];
        it.qty = Math.max(1, Math.min(10, it.qty + +q.getAttribute('data-qty')));
        return save(list);
      }
      var rm = e.target.closest('[data-testid="remove-item"]');
      if (rm) {
        var list2 = cart();
        var idx = bug('remove-wrong-item') ? 0 : +rm.getAttribute('data-idx');
        var removed = list2.splice(idx, 1)[0];
        toast(product(removed.id).name + ' removed from cart');
        if (!list2.length) store.remove('promo');
        return save(list2);
      }
      if (e.target.closest('#apply-promo')) {
        var input = $('#promo', el);
        var msg = $('[data-testid="promo-message"]', el);
        var code = input.value.trim();
        if (!bug('promo-case-sensitive')) code = code.toUpperCase();
        if (!code) { msg.textContent = 'Please enter a promo code.'; return; }
        var def = DATA.promoCodes[code];
        if (!def) { msg.textContent = 'This promo code is not valid.'; return; }
        if (def.expired) { msg.textContent = 'This promo code has expired.'; return; }
        var current = store.get('promo', null);
        store.set('promo', { code: code, times: current && current.code === code ? current.times + 1 : 1 });
        return render();
      }
      if (e.target.closest('[data-testid="checkout-button"]')) navigate('/checkout');
    });
    el.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-testid') !== 'qty-input') return;
      var list = cart();
      var it = list[+e.target.getAttribute('data-idx')];
      var v = parseInt(e.target.value, 10);
      if (!isNaN(v)) it.qty = Math.max(1, Math.min(10, v));
      save(list);
    });
  }

  function pageCheckout(el) {
    setTitle('Checkout · Bloomly');
    var items = cart();
    if (!items.length) {
      el.innerHTML = '<h1>Checkout</h1><p data-testid="cart-empty">Your cart is empty.</p><a href="/shop" class="btn">Continue shopping</a>';
      return;
    }
    var user = sessionUser();
    var t = cartTotals(items);
    el.innerHTML =
      '<h1>Checkout</h1>' +
      '<form id="checkout-form" class="stack" novalidate>' +
      '<label for="co-name">Full name</label>' +
      '<input id="co-name" autocomplete="name" value="' + (user ? esc(user.name) : '') + '">' +
      '<label for="co-address">Street address</label>' +
      '<input id="co-address" autocomplete="street-address">' +
      '<label for="co-city">City</label>' +
      '<select id="co-city"><option value="">Choose a city</option><option>Lisbon</option><option>Berlin</option><option>Warsaw</option></select>' +
      '<label for="co-date">Delivery date</label>' +
      '<input id="co-date" type="date">' +
      '<fieldset><legend>Delivery time</legend>' +
      '<label class="check"><input type="radio" name="slot" value="Morning" checked> Morning</label>' +
      '<label class="check"><input type="radio" name="slot" value="Afternoon"> Afternoon</label>' +
      '<label class="check"><input type="radio" name="slot" value="Evening"> Evening</label>' +
      '</fieldset>' +
      '<label class="check"><input type="checkbox" id="co-gift"> This is a gift</label>' +
      '<div id="gift-block" hidden>' +
      '<label for="co-message">Gift message</label>' +
      '<textarea id="co-message" rows="3" maxlength="200"></textarea>' +
      '<p class="hint" data-testid="gift-counter">0/200</p>' +
      '</div>' +
      '<p data-testid="order-total">Total to pay: ' + money(t.total) + '</p>' +
      '<button type="submit" class="btn">Place order</button>' +
      '</form>';

    var form = $('#checkout-form', el);
    $('#co-gift', el).addEventListener('change', function (e) { $('#gift-block', el).hidden = !e.target.checked; });
    $('#co-message', el).addEventListener('input', function (e) { $('[data-testid="gift-counter"]', el).textContent = e.target.value.length + '/200'; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      function check(input, testid, msg) { setFieldError(input, testid, msg); if (msg) ok = false; }
      var name = $('#co-name', el), addr = $('#co-address', el), city = $('#co-city', el), date = $('#co-date', el);
      check(name, 'co-name-error', name.value.trim() ? '' : 'Please enter your name.');
      check(addr, 'co-address-error', addr.value.trim() ? '' : 'Please enter your street address.');
      check(city, 'co-city-error', city.value ? '' : 'Please choose a city.');
      var dateMsg = '';
      if (!date.value) dateMsg = 'Please choose a delivery date.';
      else if (!bug('checkout-past-date') && date.value < today()) dateMsg = "Delivery date can't be in the past.";
      check(date, 'co-date-error', dateMsg);
      if (!ok) return;
      var btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = 'Placing order…';
      delay('checkout', 300).then(function () {
        var id = allOrders().reduce(function (m, o) { return Math.max(m, o.id); }, 0) + 1;
        var slot = $('input[name="slot"]:checked', el).value;
        var orders = store.get('orders', []);
        orders.push({
          id: id,
          user: user ? user.email : 'guest',
          date: today(),
          items: items.map(function (i) { var n = product(i.id).name; return i.qty > 1 ? n + ' ×' + i.qty : n; }),
          total: Math.round(t.total * 100) / 100,
          status: 'Processing',
          delivery: date.value + ' (' + slot + ')',
        });
        store.set('orders', orders);
        store.remove('cart');
        store.remove('promo');
        navigate('/order-confirmation?id=' + id);
      });
    });
  }

  function pageConfirmation(el, q) {
    setTitle('Order confirmed · Bloomly');
    var id = +q.get('id');
    var order = allOrders().find(function (o) { return o.id === id; });
    if (!order) { pageNotFound(el); return; }
    el.innerHTML =
      '<div class="success">' +
      '<h1>Thank you for your order!</h1>' +
      '<p data-testid="order-number">Order #' + order.id + '</p>' +
      '<p>We will deliver it on ' + esc(order.delivery || order.date) + '.</p>' +
      '<p data-testid="confirmation-total">Total paid: ' + money(order.total) + '</p>' +
      '</div>' +
      '<p><a href="/shop">Continue shopping</a></p>';
  }

  function pageOrders(el) {
    if (!requireLogin('/orders')) return;
    setTitle('My orders · Bloomly');
    var user = sessionUser();
    el.innerHTML =
      '<h1>My orders</h1>' +
      '<div class="toolbar">' +
      '<label for="status-filter">Status</label>' +
      '<select id="status-filter"><option value="all">All</option><option>Processing</option><option>Shipped</option><option>Delivered</option><option>Cancelled</option></select>' +
      '<label for="order-search">Search orders</label>' +
      '<input id="order-search" type="search" placeholder="Order number or product">' +
      '</div>' +
      '<p class="loading" data-testid="orders-loading">Loading orders…</p>' +
      '<div id="orders-results"></div>';
    var state = { status: 'all', q: '' };
    var token = renderToken;
    var mine = allOrders().filter(function (o) { return o.user === user.email; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });

    function draw() {
      var term = state.q.trim().toLowerCase().replace(/^#/, '');
      var list = mine.filter(function (o) {
        if (state.status !== 'all') {
          var match = o.status === state.status || (bug('orders-filter-wrong') && state.status === 'Shipped' && o.status === 'Processing');
          if (!match) return false;
        }
        if (!term) return true;
        return String(o.id).indexOf(term) !== -1 || o.items.join(' ').toLowerCase().indexOf(term) !== -1;
      });
      var shown = bug('orders-summary-wrong') ? mine.length : list.length;
      var html =
        '<table data-testid="orders-table"><caption>Your recent orders</caption>' +
        '<thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Items</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead>' +
        '<tbody>' + list.map(function (o) {
          return '<tr data-testid="order-row">' +
            '<td>#' + o.id + '</td><td>' + o.date + '</td><td>' + esc(o.items.join(', ')) + '</td>' +
            '<td>' + money(o.total) + '</td>' +
            '<td><span class="status status-' + o.status.toLowerCase() + '">' + o.status + '</span></td></tr>';
        }).join('') + '</tbody></table>' +
        (list.length ? '' : '<p data-testid="orders-empty">No orders match your filters.</p>') +
        '<p data-testid="orders-summary">Showing ' + shown + ' of ' + mine.length + ' orders</p>';
      $('#orders-results', el).innerHTML = html;
    }

    delay('orders', 400).then(function () {
      if (token !== renderToken) return;
      var loading = $('[data-testid="orders-loading"]', el);
      if (loading) loading.remove();
      draw();
    });
    $('#status-filter', el).addEventListener('change', function (e) { state.status = e.target.value; if (!$('[data-testid="orders-loading"]', el)) draw(); });
    $('#order-search', el).addEventListener('input', function (e) { state.q = e.target.value; if (!$('[data-testid="orders-loading"]', el)) draw(); });
  }

  function pageNotFound(el) {
    setTitle('Not found · Bloomly');
    el.innerHTML = '<h1>Page not found</h1><p class="muted">We could not find this page.</p><a href="/" class="btn">Back to home</a>';
  }

  var routes = {
    '/': pageHome,
    '/login': pageLogin,
    '/signup': pageSignup,
    '/account': pageAccount,
    '/shop': pageShop,
    '/cart': pageCart,
    '/checkout': pageCheckout,
    '/order-confirmation': pageConfirmation,
    '/orders': pageOrders,
  };

  function render() {
    renderToken++;
    var full = currentPath();
    var qi = full.indexOf('?');
    var path = qi === -1 ? full : full.slice(0, qi);
    var query = new URLSearchParams(qi === -1 ? '' : full.slice(qi + 1));
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    renderNav();
    var fresh = main.cloneNode(false); // drop listeners from the previous page
    main.parentNode.replaceChild(fresh, main);
    main = fresh;
    (routes[path] || pageNotFound)(main, query);
    if (ctx && ctx.onNavigate) ctx.onNavigate(currentPath());
    window.scrollTo(0, 0);
  }

  fetch(asset('data.json'))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      DATA = data;
      render();
      maybeCookieBanner();
      if (ctx && ctx.onReady) ctx.onReady(window);
    });
})();
