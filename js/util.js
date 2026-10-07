// Small helpers shared by every module.
const storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = x => Math.round(x * 100) + '%';
const $ = id => document.getElementById(id);

export {storage, clamp, pct, $};
