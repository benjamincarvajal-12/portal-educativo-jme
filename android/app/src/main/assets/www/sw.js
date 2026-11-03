const CACHE_NAME = "jme-portal-shell-v16";
const APP_SHELL = [
    "./",
    "./index.html",
    "./alumno.html",
    "./asistencia.html",
    "./novedades.html",
    "./cursos.html",
    "./curso.html",
    "./curso1.html",
    "./curso2.html",
    "./curso3.html",
    "./curso4.html",
    "./curso5.html",
    "./preceptores.html",
    "./acerca.html",
    "./admin.html",
    "./admin-asistencia.html",
    "./admin-avisos.html",
    "./admin-cursos.html",
    "./admin-contactos.html",
    "./admin-consultas.html",
    "./admin-configuracion.html",
    "./gestionar-cuentas.html",
    "./director.html",
    "./preceptor.html",
    "./perfil-alumno.html",
    "./mi-perfil.html",
    "./login.html",
    "./offline.html",
    "./manifest.webmanifest",
    "./css/style.css",
    "./js/app.js",
    "./js/firebase.js",
    "./js/auth.js",
    "./js/attendance.js",
    "./assets/jme-icon.svg",
    "./assets/jme-maskable.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key.startsWith("jme-portal-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                const cache = await caches.open(CACHE_NAME);
                cache.put(request, response.clone());
                return response;
            } catch (error) {
                const cache = await caches.open(CACHE_NAME);
                const cachedPage = await cache.match(request, { ignoreSearch: true });
                return cachedPage || cache.match("./offline.html");
            }
        })());
        return;
    }

    if (["script", "style", "image", "font", "manifest"].includes(request.destination)) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const response = await fetch(request);
                if (response.ok) cache.put(request, response.clone());
                return response;
            } catch (error) {
                return await cache.match(request) || Response.error();
            }
        })());
    }
});