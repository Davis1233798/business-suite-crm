/** Explicit route ownership; never derive an upstream host from user input. */
export const stations = ['mes','erp','pos','crm','dining','shop'];
function normalized(pathname) {
  try { return decodeURIComponent(pathname); } catch { return ''; }
}
export function stationForPath(pathname) {
  const path = normalized(pathname);
  if (path === '/commerce' || path.startsWith('/commerce/')) return 'shop';
  return stations.find(station => path === `/${station}` || path.startsWith(`/${station}/`) ||
    path === `/api/${station}` || path.startsWith(`/api/${station}/`) ||
    path === `/api/operations/${station}`) ?? null;
}
export function stationAllowsPath(station, pathname) {
  return stations.includes(station) && (stationForPath(pathname) === station || normalized(pathname) === '/api/health');
}
