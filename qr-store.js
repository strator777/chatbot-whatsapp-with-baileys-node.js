// qr-store.js
const qrStore = new Map();

export function setQR(sessionUid, qr) {
  qrStore.set(sessionUid, qr);
}

export function getQR(sessionUid) {
  return qrStore.get(sessionUid);
}

export function clearQR(sessionUid) {
  qrStore.delete(sessionUid);
}