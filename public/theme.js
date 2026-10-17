// Applies the saved theme before first paint. An external file because the CSP allows no inline script.
(function () {
  try {
    var t = localStorage.getItem('vw-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    // Storage blocked: follow the system setting.
  }
})();
