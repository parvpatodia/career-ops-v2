// Mask Playwright automation signals on every page load.
// WHY: Some ATS portals (Workday, iCIMS, Taleo) and job boards detect
// navigator.webdriver=true and either show a CAPTCHA or silently drop
// form submissions. This init script runs before any page JS.
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
delete window.__playwright;
delete window.__pwInitScripts;
