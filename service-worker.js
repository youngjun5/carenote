// 케어노트 PWA service worker.
// HTML(=앱 코드+보드 데이터의 baseline)은 절대 캐시에서 서빙하지 않고 항상 네트워크에서
// 새로 받아온다 — "설치된 앱이 예전 버전에 멈춰있다"는 문제를 근본적으로 막기 위함.
// 정적 자산(아이콘 등)만 캐시해서 설치 가능성/오프라인 아이콘 정도만 지원.
const CACHE = "carenote-shell-v2";
const STATIC = ["./icon-192.png", "./icon-512.png", "./manifest.json"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  const isPage = e.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
  if (isPage) {
    // 앱 본문: 항상 네트워크에서 최신을 받아온다 (오프라인일 때만 마지막 캐시로 폴백)
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then((res) => { caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {}); return res; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // 정적 자산: 캐시 우선 (거의 안 바뀌는 것들)
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }))
  );
});
