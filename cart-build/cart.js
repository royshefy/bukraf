import { createClient, OAuthStrategy } from '@wix/sdk';
import { currentCart } from '@wix/ecom';
import { redirects } from '@wix/redirects';

const CLIENT_ID = '12d8294c-ba84-449f-8267-eb0e98a62233';
const STORE_APP = '215238eb-22a5-4c36-9e7b-e7c08025e04e';

const stored = localStorage.getItem('wixSession');
const storedTokens = stored ? JSON.parse(stored) : undefined;

const wix = createClient({
  modules: { currentCart, redirects },
  auth: OAuthStrategy({ clientId: CLIENT_ID, tokens: storedTokens }),
});

// Init tokens — gray out buttons if store is down
(async () => {
  try {
    const tokens = await wix.auth.generateVisitorTokens(storedTokens);
    localStorage.setItem('wixSession', JSON.stringify(tokens));
  } catch (e) {
    console.warn('Wix auth init:', e);
    document.querySelectorAll('.book-btn:not(.sold)').forEach(btn => {
      btn.style.opacity = '.5';
      btn.title = 'החנות לא זמינה כרגע';
    });
  }
})();

function saveTokens() {
  try { localStorage.setItem('wixSession', JSON.stringify(wix.auth.getTokens())); } catch(e) {}
}

async function updateBadge() {
  try {
    const cart = await wix.currentCart.getCurrentCart();
    const count = cart.lineItems?.reduce((sum, li) => sum + li.quantity, 0) || 0;
    document.querySelectorAll('.cart-count,.nav-cart b').forEach(el => el.textContent = count);
    return cart;
  } catch (e) { return null; }
}

// Add to cart
window.bukrafAddToCart = async function(productId, btn) {
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<span>...מוסיף</span>';
  btn.disabled = true;
  try {
    await wix.currentCart.addToCurrentCart({
      lineItems: [{
        catalogReference: {
          appId: STORE_APP,
          catalogItemId: productId,
          options: { options: {} },
        },
        quantity: 1,
      }],
    });
    saveTokens();
    btn.innerHTML = '<span>נוסף! ✓</span>';
    await updateBadge();
    setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; }, 1500);
  } catch (e) {
    console.error('Add to cart error:', e);
    btn.innerHTML = origHTML;
    btn.disabled = false;
    alert('שגיאה בהוספה לעגלה. נסו שוב.');
  }
};

// Checkout with loading state
window.bukrafCheckout = async function() {
  const btn = document.querySelector('#cart-panel button[onclick*="bukrafCheckout"]');
  if (btn) { btn.disabled = true; btn.textContent = '...מעבד'; btn.style.opacity = '.6'; }
  try {
    const { checkoutId } = await wix.currentCart.createCheckoutFromCurrentCart({ channelType: 'WEB' });
    // Meta Purchase is fired SERVER-SIDE via the Wix "Order placed" automation -> Cloudflare CAPI worker
    // (100% of orders, real amount, hashed PII). No browser Purchase here, to avoid double-counting.
    const redirect = await wix.redirects.createRedirectSession({
      ecomCheckout: { checkoutId },
      callbacks: { postFlowUrl: window.location.origin + '/' },
    });
    window.location = redirect.redirectSession.fullUrl;
  } catch (e) {
    console.error('Checkout error:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'לתשלום ←'; btn.style.opacity = '1'; }
    alert('שגיאה ביצירת הזמנה. נסו שוב.');
  }
};

// Toggle cart panel
window.bukrafToggleCart = async function() {
  const panel = document.getElementById('cart-panel');
  if (!panel) return;

  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    return;
  }

  panel.innerHTML = '<div style="padding:2rem;text-align:center;color:#949494">...טוען עגלה</div>';
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');

  try {
    const cart = await wix.currentCart.getCurrentCart();
    saveTokens();

    if (!cart.lineItems || cart.lineItems.length === 0) {
      panel.innerHTML = '<div style="padding:2rem;text-align:center"><p style="color:#949494;margin-bottom:1rem">העגלה ריקה</p><button onclick="bukrafToggleCart()" style="background:none;border:1px solid #333;color:#949494;padding:.5rem 1.5rem;cursor:pointer;font-family:inherit;border-radius:4px">סגור</button></div>';
      return;
    }

    let html = '<div style="padding:1.2rem">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem"><b style="font-size:1.1rem">סל הקניות</b><button onclick="bukrafToggleCart()" style="background:none;border:none;color:#949494;font-size:1.5rem;cursor:pointer;padding:8px">×</button></div>';

    let total = 0;
    for (const item of cart.lineItems) {
      const name = item.productName?.translated || 'מוצר';
      const price = parseFloat(item.price?.amount || 0);
      const qty = item.quantity || 1;
      total += price * qty;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:.8rem 0;border-bottom:1px solid #1a1a1a">
        <div><b>${name}</b><br><small style="color:#949494">כמות: ${qty}</small></div>
        <div style="color:#FFD700;font-weight:700">₪${price}</div>
      </div>`;
    }

    html += `<div style="display:flex;justify-content:space-between;padding:1rem 0;font-weight:700;font-size:1.1rem"><span>סה״כ</span><span style="color:#FFD700">₪${total}</span></div>`;
    html += `<button onclick="bukrafCheckout()" style="width:100%;padding:1rem;background:#FFD700;color:#000;border:none;font-weight:800;font-size:1rem;cursor:pointer;font-family:inherit">לתשלום ←</button>`;
    html += '</div>';
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = '<div style="padding:2rem;text-align:center;color:#949494">שגיאה בטעינת העגלה</div>';
    console.error('Cart load error:', e);
  }
};

// Run immediately — DOMContentLoaded may have already fired
(function initCart() {
  if (!document.body) { document.addEventListener('DOMContentLoaded', initCart); return; }

  // Wire cart buttons
  document.querySelectorAll('.book-btn[data-product-id]:not([disabled])').forEach(btn => {
    if (btn._cartWired) return;
    btn._cartWired = true;
    btn.addEventListener('click', e => {
      e.preventDefault();
      window.bukrafAddToCart(btn.dataset.productId, btn);
    });
  });

  // Cart icon click — also close mobile menu
  document.querySelectorAll('.nav-cart').forEach(el => {
    if (el._cartWired) return;
    el._cartWired = true;
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelector('.mobile-menu')?.classList.remove('open');
      window.bukrafToggleCart();
    });
  });

  // Click outside cart panel to close (delayed to avoid same-click close)
  document.addEventListener('click', function(e) {
    const panel = document.getElementById('cart-panel');
    if (!panel || !panel.classList.contains('open')) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest('.nav-cart')) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  });

  // Escape key closes cart
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const panel = document.getElementById('cart-panel');
      if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
      }
    }
  });

  // Initial badge
  updateBadge();

  // Handle return from checkout — show thank-you toast
  const params = new URLSearchParams(window.location.search);
  if (params.has('wixMemberLoggedIn') || params.has('thankYou')) {
    window.history.replaceState({}, '', window.location.pathname);
    // Note: Meta Purchase fires SERVER-SIDE (Wix "Order placed" automation -> CAPI worker), not here.
    updateBadge();
    const toast = document.createElement('div');
    toast.textContent = '!ההזמנה התקבלה בהצלחה';
    toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#FFD700;color:#000;padding:1rem 2.5rem;font-family:inherit;font-weight:800;font-size:1.1rem;z-index:10001;box-shadow:4px 4px 0 #000;border-radius:4px;animation:fadeout 4s forwards';
    document.body.appendChild(toast);
    const s = document.createElement('style');
    s.textContent = '@keyframes fadeout{0%,70%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(s);
    setTimeout(() => toast.remove(), 4200);
  }

  // Deep link to non-page sections (e.g. #books-sec)
  if (location.hash && !location.hash.startsWith('#pg-')) {
    var el = document.getElementById(location.hash.slice(1));
    if (el) { setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 300); }
  }
})();
