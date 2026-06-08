// src/serviceWorkerRegistration.ts
// PWA + update notifications for Insafdaar
// Works offline, installable on mobile, with custom blue/gold toast alert

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
    )
);

export function register(config?: any) {
  if ('serviceWorker' in navigator) {
    const publicUrl = new URL((process as any).env.PUBLIC_URL, window.location.href);
    if (publicUrl.origin !== window.location.origin) return;

    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      if (isLocalhost) {
        checkValidServiceWorker(swUrl, config);
        navigator.serviceWorker.ready.then(() =>
          console.log('⚙️ Service Worker active (localhost)')
        );
      } else {
        registerValidSW(swUrl, config);
      }
    });
  }
}

function registerValidSW(swUrl: string, config?: any) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('⚡ New version available.');

              // ✅ Branded toast alert
              showBrandedUpdateToast(() => {
                installingWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              });

              if (config && config.onUpdate) config.onUpdate(registration);
            } else {
              console.log('✅ Content cached for offline use.');
              if (config && config.onSuccess) config.onSuccess(registration);
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error('❌ Error during service worker registration:', error);
    });
}

function checkValidServiceWorker(swUrl: string, config?: any) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType && !contentType.includes('javascript'))
      ) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => window.location.reload());
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => console.log('⚠️ App is offline, using cached content.'));
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.unregister())
      .catch((error) => console.error(error.message));
  }
}

// ✅ Custom Insafdaar-branded update toast
function showBrandedUpdateToast(onReload: () => void) {
  const toast = document.createElement('div');
  toast.innerHTML = `
    <div style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    ">
      <span style="font-weight: 600;">⚡ New update available</span>
      <button style="
        background: #f5b301;
        border: none;
        color: #00142e;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: 0.3s ease;
      ">Refresh</button>
    </div>
  `;

  toast.style.cssText = `
    position: fixed;
    bottom: 25px;
    left: 50%;
    transform: translateX(-50%) scale(0.95);
    background: linear-gradient(135deg, #001a3a, #004aad);
    color: white;
    padding: 14px 20px;
    border-radius: 10px;
    box-shadow: 0 4px 25px rgba(0,0,0,0.3);
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    letter-spacing: 0.3px;
    z-index: 9999;
    opacity: 0;
    transition: all 0.4s ease-in-out;
    border: 1px solid rgba(245,179,1,0.4);
  `;

  document.body.appendChild(toast);
  const button = toast.querySelector('button') as HTMLButtonElement;

  // Animation in
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
  }, 100);

  // Click refresh
  button.onclick = () => {
    toast.style.opacity = '0';
    setTimeout(() => onReload(), 600);
  };

  // Auto fade out after 10 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) scale(0.9)';
    setTimeout(() => toast.remove(), 1000);
  }, 10000);
}
