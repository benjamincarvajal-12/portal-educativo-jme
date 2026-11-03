(() => {
    "use strict";

    const storageKeys = {
        courses: "jme.portal.courses.v1",
        notices: "jme.portal.notices.v1",
        queries: "jme.portal.queries.v1",
        users: "jme.portal.users.v1",
    };
    let deferredInstallPrompt = null;
    let appLoader = null;
    const firebaseServicesReady = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "js/firebase.js";
        script.onload = () => window.JMEFirebaseInternalReady.then(resolve, reject);
        script.onerror = () => reject(new Error("No se pudo cargar la configuración de Firebase."));
        document.head.append(script);
    });
    window.JMEFirebaseReady = firebaseServicesReady;
    let cloudUnsubscribers = [];

    const defaultCourses = [
        { id: "curso1", name: "1° Año Curso N°1", icon: "📘", href: "curso1.html", active: true },
        { id: "curso2", name: "1° Año Curso N°2", icon: "📗", href: "curso2.html", active: true },
        { id: "curso3", name: "1° Año Curso N°3", icon: "📙", href: "curso3.html", active: true },
        { id: "curso4", name: "1° Año Curso N°4", icon: "📕", href: "curso4.html", active: true },
        { id: "curso5", name: "1° Año Curso N°5", icon: "📓", href: "curso5.html", active: true }
    ];

    const defaultNotices = [
        {
            id: "jme-welcome",
            title: "Bienvenidos al Portal Educativo",
            body: "Ya está disponible este espacio para consultar avisos, actividades y fechas importantes del curso.",
            courseId: "curso1",
            createdAt: "2026-03-02T09:00:00.000Z",
            author: "Equipo JME"
        },
        {
            id: "jme-calendar",
            title: "Agenda de evaluaciones",
            body: "Las fechas de evaluaciones y trabajos se publicarán aquí cuando sean confirmadas por el equipo docente.",
            courseId: "curso1",
            createdAt: "2026-03-05T12:00:00.000Z",
            author: "Preceptoría"
        }
    ];

    function readData(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch (error) {
            console.warn("No se pudo leer el almacenamiento local del portal.", error);
            return fallback;
        }
    }

    function saveData(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            syncDataToCloud(key, value).catch((error) => window.JMEFirebase?.reportError(error));
            return true;
        } catch (error) {
            console.warn("No se pudo guardar el almacenamiento local del portal.", error);
            return false;
        }
    }

    async function syncDataToCloud(key, value) {
        const services = await firebaseServicesReady;
        const user = services.auth.currentUser;
        if (!user) return;
        const profileSnapshot = await services.db.collection("users").doc(user.uid).get();
        if (!profileSnapshot.exists) return;
        const role = profileSnapshot.data().role;

        if (key === storageKeys.courses) {
            if (role !== "admin" && role !== "director") return;
            await services.db.collection("settings").doc("portal").set({
                courses: value,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return;
        }

        const collectionName = key === storageKeys.notices ? "notices"
            : key === storageKeys.queries ? "queries"
                : key === storageKeys.users && role === "admin" ? "contacts" : "";
        if (!collectionName || (collectionName === "notices" && !services.isStaff(role))) return;
        const collection = services.db.collection(collectionName);
        const records = Array.isArray(value) ? value : [];
        const batch = services.db.batch();
        records.forEach((record) => {
            if (collectionName === "queries" && role === "alumno" && record.userId !== user.uid) return;
            batch.set(collection.doc(String(record.id)), record);
        });
        if (role !== "alumno") {
            const existing = await collection.get();
            existing.docs.forEach((document) => {
                if (!records.some((record) => String(record.id) === document.id)) batch.delete(document.ref);
            });
        }
        await batch.commit();
    }

    function cacheCloudData(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn("No se pudo actualizar la copia local de datos sincronizados.", error);
        }
    }

    function refreshCloudViews() {
        renderDashboard();
        initPublicPages();
        document.dispatchEvent(new CustomEvent("jme-cloud-data-updated"));
    }

    function stopCloudSync() {
        cloudUnsubscribers.forEach((unsubscribe) => unsubscribe());
        cloudUnsubscribers = [];
    }

    async function startCloudSync(services, user, profile) {
        stopCloudSync();
        const settingsRef = services.db.collection("settings").doc("portal");
        cloudUnsubscribers.push(settingsRef.onSnapshot((snapshot) => {
            if (!snapshot.exists) {
                if (profile.role === "admin") {
                    const courses = readData(storageKeys.courses, defaultCourses);
                    settingsRef.set({ courses, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
                        .catch((error) => services.reportError(error));
                }
                return;
            }
            const settings = snapshot.data();
            if (Array.isArray(settings.courses)) cacheCloudData(storageKeys.courses, settings.courses);
            refreshCloudViews();
        }, services.reportError));

        ["notices", "contacts"].forEach((collectionName) => {
            const localKey = collectionName === "notices" ? storageKeys.notices : storageKeys.users;
            cloudUnsubscribers.push(services.db.collection(collectionName).onSnapshot((snapshot) => {
                if (!snapshot.size && profile.role === "admin") {
                    const localRecords = collectionName === "notices" ? getNotices() : getUsers();
                    if (localRecords.length) {
                        syncDataToCloud(localKey, localRecords).catch((error) => services.reportError(error));
                        return;
                    }
                }
                cacheCloudData(localKey, snapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
                refreshCloudViews();
            }, services.reportError));
        });

        let query = services.db.collection("queries");
        if (!services.isStaff(profile.role)) query = query.where("userId", "==", user.uid);
        cloudUnsubscribers.push(query.onSnapshot((snapshot) => {
            if (!snapshot.size && services.isStaff(profile.role)) {
                const localQueries = getQueries();
                if (localQueries.length) {
                    syncDataToCloud(storageKeys.queries, localQueries).catch((error) => services.reportError(error));
                    return;
                }
            }
            cacheCloudData(storageKeys.queries, snapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
            refreshCloudViews();
        }, services.reportError));
    }

    window.JMEStartCloudSync = (user, profile) => firebaseServicesReady
        .then((services) => startCloudSync(services, user, profile));
    window.JMEStopCloudSync = stopCloudSync;
    document.addEventListener("jme-cloud-error", (event) => {
        const message = element("div", "app-status-toast", `Firebase: ${event.detail}`);
        message.setAttribute("role", "alert");
        document.body.append(message);
        window.setTimeout(() => message.remove(), 6500);
    });

    function makeId() {
        return globalThis.crypto?.randomUUID?.() || `jme-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function getCourses() {
        const courses = readData(storageKeys.courses, null);
        if (Array.isArray(courses)) return courses;
        saveData(storageKeys.courses, defaultCourses);
        return [...defaultCourses];
    }

    function getNotices() {
        const notices = readData(storageKeys.notices, null);
        if (Array.isArray(notices)) return notices;
        saveData(storageKeys.notices, defaultNotices);
        return [...defaultNotices];
    }

    function getQueries() {
        const queries = readData(storageKeys.queries, []);
        return Array.isArray(queries) ? queries : [];
    }

    function getUsers() {
        const users = readData(storageKeys.users, []);
        return Array.isArray(users) ? users : [];
    }

    function escapeText(value) {
        return String(value ?? "");
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Fecha no disponible";
        return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(date);
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function actionButton(label, action, id, className = "button secondary small") {
        const button = element("button", className, label);
        button.type = "button";
        button.dataset.action = action;
        button.dataset.id = id;
        return button;
    }

    function initIndex() {
        const root = document.querySelector("[data-page='entry']");
        if (!root) return;

        root.querySelectorAll("[data-enter-role]").forEach((button) => {
            button.addEventListener("click", () => {
                const loginRoleByName = { Preceptor: "preceptor", Director: "director", Administrador: "admin" };
                const destination = `login.html${button.dataset.enterRole === "Alumno" ? "" : `?role=${loginRoleByName[button.dataset.enterRole] || ""}`}`;
                if (!destination || root.classList.contains("is-entering")) return;
                root.classList.add("is-entering");
                root.setAttribute("aria-busy", "true");
                const message = root.querySelector("[data-entry-message]");
                if (message) message.textContent = `Cargando entorno de ${button.dataset.enterRole.toLowerCase()}...`;
                window.setTimeout(() => { window.location.href = destination; }, 1150);
            });
        });
    }

    function initHomeCarousel() {
        const carousel = document.querySelector(".home-hero");
        if (!carousel) return;

        const slides = [...carousel.querySelectorAll(".home-hero-slide")];
        if (slides.length < 2) return;

        let activeSlide = slides.findIndex((slide) => slide.classList.contains("is-active"));
        if (activeSlide < 0) activeSlide = 0;

        window.setInterval(() => {
            if (document.hidden) return;
            slides[activeSlide].classList.remove("is-active");
            activeSlide = (activeSlide + 1) % slides.length;
            slides[activeSlide].classList.add("is-active");
        }, 3000);
    }

    function initNavigation() {
        const currentFile = window.location.pathname.split("/").pop() || "index.html";
        document.querySelectorAll(".nav-links a[href]").forEach((link) => {
            const target = link.getAttribute("href").split("?")[0];
            if (target === currentFile) link.setAttribute("aria-current", "page");
        });
    }

    function initGlobalNavigation() {
        if (document.querySelector("[data-global-navigation]")) return;
        const role = document.body.dataset.dashboardRole || document.body.dataset.sessionRole;
        const currentFile = window.location.pathname.split("/").pop() || "index.html";
        if (currentFile === "alumno.html" && document.querySelector(".site-nav")) return;
        const homeByRole = {
            admin: "admin.html",
            director: "director.html",
            preceptor: "preceptor.html"
        };
        const topLevelPages = new Set(["index.html", "alumno.html", "login.html", "admin.html", "director.html", "preceptor.html"]);
        const navigation = element("nav", "global-navigation");
        navigation.dataset.globalNavigation = "true";
        navigation.setAttribute("aria-label", "Navegación de página");

        const back = element("button", "global-nav-button", "⬅ Atrás");
        back.type = "button";
        back.hidden = topLevelPages.has(currentFile);
        back.addEventListener("click", () => window.history.back());

        const home = element("a", "global-nav-button", "🏠 Inicio");
        home.href = currentFile === "login.html" ? "index.html" : homeByRole[role] || "alumno.html";

        const install = element("button", "global-nav-button", "⬇ Instalar aplicación");
        install.type = "button";
        install.dataset.pwaInstall = "true";
        install.hidden = true;

        navigation.append(back, home);

        const crumbs = getBreadcrumbs(currentFile, role);
        if (crumbs.length) {
            const trail = element("ol", "global-breadcrumbs");
            trail.setAttribute("aria-label", "Ruta de navegación");
            crumbs.forEach((crumb, index) => {
                const item = element("li", "breadcrumb-item");
                if (index < crumbs.length - 1) {
                    const link = element("a", "", crumb.label);
                    link.href = crumb.href;
                    item.append(link);
                } else {
                    const current = element("span", "", crumb.label);
                    current.setAttribute("aria-current", "page");
                    item.append(current);
                }
                trail.append(item);
            });
            navigation.append(trail);
        }

        navigation.append(install);
        const mainNavigation = document.querySelector(".site-nav");
        if (mainNavigation?.parentNode) mainNavigation.insertAdjacentElement("afterend", navigation);
        else document.body.prepend(navigation);
    }

    function getBreadcrumbs(currentFile, role) {
        if (["index.html", "alumno.html", "login.html", "admin.html", "director.html", "preceptor.html"].includes(currentFile)) return [];
        const home = { label: "🏠 Inicio", href: role === "admin" ? "admin.html" : role === "director" ? "director.html" : role === "preceptor" ? "preceptor.html" : "alumno.html" };
        if (currentFile === "asistencia.html") return [home, { label: "👥 Asistencia" }];
        if (currentFile === "novedades.html") return [home, { label: "📰 Novedades" }];
        if (currentFile === "cursos.html") return [home, { label: "📚 Cursos" }];
        if (currentFile === "acerca.html") return [home, { label: "ℹ️ Acerca de" }];
        if (currentFile === "preceptores.html") return [home, { label: "👨‍🏫 Preceptores" }];
        if (currentFile === "mi-perfil.html") return [home, { label: "👤 Mi Perfil" }];

        const params = new URLSearchParams(window.location.search);
        const courseId = currentFile === "curso.html" ? params.get("curso") : currentFile.match(/^curso(\d)\.html$/)?.[1] ? `curso${currentFile.match(/^curso(\d)\.html$/)[1]}` : params.get("curso");
        const course = getCourses().find((item) => item.id === courseId);
        if (currentFile.startsWith("curso") || currentFile === "perfil-alumno.html") {
            const courseCrumb = { label: `${course?.icon || "📘"} ${course?.name || "Curso"}`, href: course?.href || "cursos.html" };
            const crumbs = [home, { label: "📚 Cursos", href: "cursos.html" }, courseCrumb];
            if (window.location.hash === "#asistencia") crumbs.push({ label: "👥 Asistencia" });
            if (currentFile === "perfil-alumno.html") {
                crumbs.push({ label: "👥 Alumnos", href: `${course?.href || "curso1.html"}#asistencia` });
                let studentName = "Perfil de alumno";
                try {
                    const store = JSON.parse(localStorage.getItem("jme.portal.attendance.v1") || "{}");
                    studentName = store.students?.find((student) => student.id === params.get("alumno"))?.name || studentName;
                } catch (error) {
                    console.warn("No se pudo leer el nombre para la ruta de navegación.", error);
                }
                crumbs.push({ label: `👤 ${studentName}` });
            }
            return crumbs;
        }
        return [home, { label: document.querySelector("h1")?.textContent?.trim() || "Sección" }];
    }

    function showAppLoader() {
        appLoader?.classList.add("is-visible");
    }

    function hideAppLoader() {
        appLoader?.classList.remove("is-visible");
    }

    function initAppLoading() {
        if (appLoader) return;
        appLoader = element("div", "app-loader");
        appLoader.setAttribute("role", "status");
        appLoader.setAttribute("aria-live", "polite");
        const panel = element("div", "app-loader-panel");
        const spinner = element("span", "app-loader-spinner");
        spinner.setAttribute("aria-hidden", "true");
        panel.append(spinner, element("p", "app-loader-label", "Cargando portal educativo..."));
        appLoader.append(panel);
        document.body.append(appLoader);
        showAppLoader();
        const hideInitialLoader = () => window.setTimeout(hideAppLoader, 480);
        if (document.readyState === "complete") hideInitialLoader();
        else window.addEventListener("load", hideInitialLoader, { once: true });
        window.setTimeout(hideAppLoader, 1600);

        document.addEventListener("click", (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const link = event.target.closest("a[href]");
            if (!link || link.target || link.hasAttribute("download")) return;
            const destination = new URL(link.href, window.location.href);
            if (destination.origin !== window.location.origin) return;
            if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
            showAppLoader();
            window.setTimeout(hideAppLoader, 5000);
        });
        window.addEventListener("pageshow", (event) => { if (event.persisted) hideAppLoader(); });
        window.addEventListener("pagehide", hideAppLoader);
    }

    function showPwaMessage(message) {
        const toast = element("div", "app-status-toast", message);
        toast.setAttribute("role", "status");
        document.body.append(toast);
        window.setTimeout(() => toast.remove(), 4500);
    }

    function initPwa() {
        const installButton = document.querySelector("[data-pwa-install]");
        if (installButton) {
            window.addEventListener("beforeinstallprompt", (event) => {
                event.preventDefault();
                deferredInstallPrompt = event;
                installButton.hidden = false;
            });
            installButton.addEventListener("click", async () => {
                if (!deferredInstallPrompt) return;
                await deferredInstallPrompt.prompt();
                await deferredInstallPrompt.userChoice;
                deferredInstallPrompt = null;
                installButton.hidden = true;
            });
            window.addEventListener("appinstalled", () => {
                installButton.hidden = true;
                showPwaMessage("Portal Educativo JME N°1 instalado.");
            });
        }

        const isCapacitor = Boolean(window.JMEAndroid) || window.Capacitor?.isNativePlatform?.() || window.location.protocol === "capacitor:";
        const unsupportedProtocol = ["file:", "capacitor:"].includes(window.location.protocol);
        if (isCapacitor || unsupportedProtocol || !window.isSecureContext || !("serviceWorker" in navigator)) return;

        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!hadController) return;
            showPwaMessage("Actualización instalada. Recargando el portal...");
            window.location.reload();
        });

        navigator.serviceWorker.register("./sw.js", { scope: "./" })
            .then((registration) => registration.update())
            .catch((error) => console.warn("No se pudo activar el modo offline.", error));
    }

    function initReveal() {
        const items = document.querySelectorAll(".reveal");
        if (!items.length) return;
        if (!("IntersectionObserver" in window)) {
            items.forEach((item) => item.classList.add("is-visible"));
            return;
        }
        const observer = new IntersectionObserver((entries, currentObserver) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                currentObserver.unobserve(entry.target);
            });
        }, { threshold: 0.12 });
        items.forEach((item) => observer.observe(item));
    }

    function initTiltEffects() {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches
            || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

        document.querySelectorAll(".card, .button, .role-button, .global-nav-button, .nav-links a").forEach((item) => {
            item.addEventListener("pointermove", (event) => {
                const bounds = item.getBoundingClientRect();
                const x = (event.clientX - bounds.left) / bounds.width - 0.5;
                const y = (event.clientY - bounds.top) / bounds.height - 0.5;
                const intensity = item.matches(".card") ? 4 : 2;
                item.style.setProperty("--tilt-x", `${-y * intensity}deg`);
                item.style.setProperty("--tilt-y", `${x * intensity}deg`);
            });
            item.addEventListener("pointerleave", () => {
                item.style.removeProperty("--tilt-x");
                item.style.removeProperty("--tilt-y");
            });
        });
    }

    function renderCourseCards(container) {
        if (!container) return;
        container.replaceChildren();
        const courses = getCourses().filter((course) => course.active !== false);
        if (!courses.length) {
            container.append(element("p", "empty-state", "Todavía no hay cursos publicados."));
            return;
        }
        courses.forEach((course) => {
            const card = element("article", "card course-card reveal");
            card.append(element("span", "card-icon", course.icon || "📘"));
            card.append(element("h3", "", escapeText(course.name)));
            card.append(element("p", "muted", "Avisos, actividades y recursos del curso."));
            const link = element("a", "card-action", "Ver contenido →");
            link.href = course.href || `curso.html?curso=${encodeURIComponent(course.id)}`;
            card.append(link);
            container.append(card);
            requestAnimationFrame(() => card.classList.add("is-visible"));
        });
    }

    function renderNoticeCards(container, courseId) {
        if (!container) return;
        container.replaceChildren();
        const notices = getNotices()
            .filter((notice) => notice.courseId === courseId || notice.courseId === "todos")
            .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
        if (!notices.length) {
            container.append(element("p", "empty-state", "Todavía no hay avisos publicados para este curso."));
            return;
        }
        notices.forEach((notice) => {
            const card = element("article", "card notice-card reveal");
            card.append(element("h3", "", escapeText(notice.title)));
            card.append(element("p", "", escapeText(notice.body)));
            const meta = element("div", "notice-meta");
            meta.append(element("span", "", formatDate(notice.createdAt)));
            meta.append(element("span", "", escapeText(notice.author || "Equipo JME")));
            card.append(meta);
            container.append(card);
            requestAnimationFrame(() => card.classList.add("is-visible"));
        });
    }

    function initPublicPages() {
        document.querySelectorAll("[data-course-grid]").forEach((container) => renderCourseCards(container));
        const courseRoot = document.querySelector("[data-course-page]");
        if (courseRoot) {
            const id = courseRoot.dataset.courseId || new URLSearchParams(window.location.search).get("curso");
            const course = id ? getCourses().find((item) => item.id === id) : null;
            if (course) {
                courseRoot.querySelectorAll("[data-course-name]").forEach((node) => { node.textContent = course.name; });
                document.title = `${course.name} | Portal Educativo JME N°1`;
            }
            renderNoticeCards(courseRoot.querySelector("[data-notice-list]"), id || "sin-curso");
        }
    }

    function setStatus(form, message, isError = false) {
        const output = form.querySelector("[data-status]");
        if (!output) return;
        output.textContent = message;
        output.style.color = isError ? "#b42318" : "";
    }

    function initQueryForm() {
        const form = document.querySelector("[data-query-form]");
        if (!form) return;
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const values = new FormData(form);
            const file = form.querySelector("input[type='file']")?.files?.[0];
            const query = {
                id: makeId(),
                email: String(values.get("email") || "").trim(),
                subject: String(values.get("subject") || "").trim(),
                message: String(values.get("message") || "").trim(),
                attachmentName: file?.name || "",
                createdAt: new Date().toISOString(),
                status: "Pendiente",
                response: "",
                userId: window.JMEFirebase?.auth.currentUser?.uid || ""
            };
            if (!query.userId) {
                setStatus(form, "Inicia sesión con tu cuenta de alumno para enviar una consulta.", true);
                return;
            }
            const queries = getQueries();
            queries.unshift(query);
            if (!saveData(storageKeys.queries, queries)) {
                setStatus(form, "No se pudo guardar la consulta en este navegador.", true);
                return;
            }
            form.reset();
            setStatus(form, "Consulta enviada correctamente.");
        });
    }

    function courseName(id) {
        if (id === "todos") return "Todos los cursos";
        return getCourses().find((course) => course.id === id)?.name || "Curso eliminado";
    }

    function renderManageNotices(container) {
        if (!container) return;
        container.replaceChildren();
        const notices = getNotices().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
        if (!notices.length) {
            container.append(element("p", "empty-state", "Aún no se publicaron avisos."));
            return;
        }
        notices.forEach((notice) => {
            const row = element("article", "data-row");
            const details = element("div");
            details.append(element("h3", "", escapeText(notice.title)));
            details.append(element("p", "", `${courseName(notice.courseId)} · ${formatDate(notice.createdAt)}`));
            details.append(element("p", "", escapeText(notice.body)));
            row.append(details);
            const actions = element("div", "row-actions");
            actions.append(actionButton("Editar", "edit-notice", notice.id));
            actions.append(actionButton("Eliminar", "delete-notice", notice.id, "button danger small"));
            row.append(actions);
            container.append(row);
        });
    }

    function renderManagedCourses(container) {
        if (!container) return;
        container.replaceChildren();
        const courses = getCourses();
        if (!courses.length) {
            container.append(element("p", "empty-state", "No hay cursos configurados."));
            return;
        }
        courses.forEach((course) => {
            const row = element("article", "data-row");
            const details = element("div");
            details.append(element("h3", "", `${course.icon || "📘"} ${escapeText(course.name)}`));
            details.append(element("p", "", course.active === false ? "Oculto para alumnos" : "Visible para alumnos"));
            row.append(details);
            const actions = element("div", "row-actions");
            actions.append(actionButton("Editar", "edit-course", course.id));
            actions.append(actionButton(course.active === false ? "Publicar" : "Ocultar", "toggle-course", course.id));
            actions.append(actionButton("Eliminar", "delete-course", course.id, "button danger small"));
            row.append(actions);
            container.append(row);
        });
    }

    function renderQueries(container) {
        if (!container) return;
        container.replaceChildren();
        const queries = getQueries();
        if (!queries.length) {
            container.append(element("p", "empty-state", "No hay consultas recibidas en este dispositivo."));
            return;
        }
        queries.forEach((query) => {
            const details = element("details", "data-row");
            const summary = element("summary", "", `${escapeText(query.subject)} · ${escapeText(query.status)} · ${formatDate(query.createdAt)}`);
            details.append(summary);
            details.append(element("p", "muted", `De: ${escapeText(query.email)}`));
            details.append(element("p", "", escapeText(query.message)));
            if (query.attachmentName) details.append(element("p", "muted", `Adjunto seleccionado: ${escapeText(query.attachmentName)} (no almacenado)`));
            if (query.response) details.append(element("p", "notice-banner", `Respuesta: ${escapeText(query.response)}`));
            const form = element("form", "inline-form");
            form.dataset.responseForm = "true";
            form.dataset.queryId = query.id;
            const field = element("div", "field");
            const label = element("label", "", "Respuesta");
            label.htmlFor = `response-${query.id}`;
            const input = element("input", "control");
            input.id = `response-${query.id}`;
            input.name = "response";
            input.required = true;
            input.value = query.response || "";
            field.append(label, input);
            form.append(field);
            const submit = element("button", "button small", "Guardar respuesta");
            submit.type = "submit";
            form.append(submit);
            details.append(form);
            container.append(details);
        });
    }

    function renderUsers(container) {
        if (!container) return;
        container.replaceChildren();
        const users = getUsers();
        if (!users.length) {
            container.append(element("p", "empty-state", "El directorio está vacío. Agrega contactos de demostración."));
            return;
        }
        users.forEach((user) => {
            const row = element("article", "data-row");
            const details = element("div");
            details.append(element("h3", "", escapeText(user.name)));
            details.append(element("p", "", escapeText(user.role)));
            row.append(details);
            row.append(actionButton("Eliminar", "delete-user", user.id, "button danger small"));
            container.append(row);
        });
    }

    function renderStats(container) {
        if (!container) return;
        container.replaceChildren();
        const stats = [
            ["Cursos", getCourses().length],
            ["Avisos", getNotices().length],
            ["Consultas pendientes", getQueries().filter((query) => query.status !== "Respondida").length],
            ["Contactos", getUsers().length]
        ];
        stats.forEach(([label, value]) => {
            const card = element("div", "stat-card");
            card.append(element("span", "stat-label", label));
            card.append(element("strong", "stat-value", String(value)));
            container.append(card);
        });
    }

    function fillCourseSelect(select, includeAll = true) {
        if (!select) return;
        const previous = select.value;
        select.replaceChildren();
        if (includeAll) select.append(new Option("Todos los cursos", "todos"));
        getCourses().forEach((course) => select.append(new Option(course.name, course.id)));
        if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
    }

    function renderDashboard() {
        const dashboard = document.querySelector("[data-dashboard-role]");
        if (!dashboard) return;
        const role = dashboard.dataset.dashboardRole;
        renderStats(dashboard.querySelector("[data-stats]"));
        renderManageNotices(dashboard.querySelector("[data-managed-notices]"));
        renderManagedCourses(dashboard.querySelector("[data-managed-courses]"));
        renderQueries(dashboard.querySelector("[data-query-list]"));
        renderUsers(dashboard.querySelector("[data-user-list]"));
        fillCourseSelect(dashboard.querySelector("[name='notice-course']"), role === "director");
    }

    function initNoticeForm() {
        const form = document.querySelector("[data-notice-form]");
        if (!form) return;
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const values = new FormData(form);
            const id = String(values.get("notice-id") || "");
            const notices = getNotices();
            const existing = notices.find((notice) => notice.id === id);
            const notice = {
                id: existing?.id || makeId(),
                title: String(values.get("notice-title") || "").trim(),
                body: String(values.get("notice-body") || "").trim(),
                courseId: String(values.get("notice-course") || "todos"),
                createdAt: existing?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                author: document.querySelector("[data-dashboard-role]")?.dataset.dashboardRole || "Equipo JME"
            };
            const updated = existing ? notices.map((item) => item.id === id ? notice : item) : [notice, ...notices];
            if (!saveData(storageKeys.notices, updated)) {
                setStatus(form, "No se pudo guardar el aviso en este navegador.", true);
                return;
            }
            form.reset();
            form.querySelector("[name='notice-id']").value = "";
            const submit = form.querySelector("[type='submit']");
            if (submit) submit.textContent = "Publicar aviso";
            renderDashboard();
            setStatus(form, existing ? "Aviso actualizado en este dispositivo." : "Aviso publicado en este dispositivo.");
        });
    }

    function initCourseForm() {
        const form = document.querySelector("[data-course-form]");
        if (!form) return;
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const values = new FormData(form);
            const id = String(values.get("course-id") || "");
            const name = String(values.get("course-name") || "").trim();
            const courses = getCourses();
            const existing = courses.find((course) => course.id === id);
            const updated = existing
                ? courses.map((course) => course.id === id ? { ...course, name } : course)
                : [...courses, { id: `curso-${makeId()}`, name, icon: "📘", href: `curso.html?curso=${encodeURIComponent(`curso-${makeId()}`)}`, active: true }];
            if (!existing) {
                const added = updated[updated.length - 1];
                added.href = `curso.html?curso=${encodeURIComponent(added.id)}`;
            }
            if (!saveData(storageKeys.courses, updated)) {
                setStatus(form, "No se pudo guardar el curso en este navegador.", true);
                return;
            }
            form.reset();
            form.querySelector("[name='course-id']").value = "";
            const submit = form.querySelector("[type='submit']");
            if (submit) submit.textContent = "Agregar curso";
            renderDashboard();
            setStatus(form, existing ? "Curso actualizado." : "Curso agregado.");
        });
    }

    function initUserForm() {
        const form = document.querySelector("[data-user-form]");
        if (!form) return;
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const values = new FormData(form);
            const users = getUsers();
            users.unshift({ id: makeId(), name: String(values.get("user-name") || "").trim(), role: String(values.get("user-role") || "") });
            if (!saveData(storageKeys.users, users)) {
                setStatus(form, "No se pudo guardar el contacto.", true);
                return;
            }
            form.reset();
            renderDashboard();
            setStatus(form, "Contacto agregado al directorio local.");
        });
    }

    function initDashboardForms() {
        initNoticeForm();
        initCourseForm();
        initUserForm();
        document.querySelectorAll("[data-dashboard-role]").forEach((dashboard) => {
            dashboard.querySelectorAll("[name='notice-course']").forEach((select) => fillCourseSelect(select, dashboard.dataset.dashboardRole === "director"));
        });
        document.addEventListener("submit", (event) => {
            const form = event.target.closest("[data-response-form]");
            if (!form) return;
            event.preventDefault();
            const response = new FormData(form).get("response");
            const queries = getQueries();
            const updated = queries.map((query) => query.id === form.dataset.queryId
                ? { ...query, response: String(response || "").trim(), status: "Respondida", respondedAt: new Date().toISOString() }
                : query);
            saveData(storageKeys.queries, updated);
            renderDashboard();
        });
        document.addEventListener("click", (event) => {
            const button = event.target.closest("[data-action]");
            if (!button) return;
            const { action, id } = button.dataset;
            if (action === "delete-notice") {
                saveData(storageKeys.notices, getNotices().filter((notice) => notice.id !== id));
            } else if (action === "edit-notice") {
                const notice = getNotices().find((item) => item.id === id);
                const form = document.querySelector("[data-notice-form]");
                if (!notice || !form) return;
                form.querySelector("[name='notice-id']").value = notice.id;
                form.querySelector("[name='notice-title']").value = notice.title;
                form.querySelector("[name='notice-course']").value = notice.courseId;
                form.querySelector("[name='notice-body']").value = notice.body;
                form.querySelector("[type='submit']").textContent = "Guardar cambios";
                form.scrollIntoView({ behavior: "smooth", block: "center" });
                return;
            } else if (action === "toggle-course") {
                saveData(storageKeys.courses, getCourses().map((course) => course.id === id ? { ...course, active: course.active === false } : course));
            } else if (action === "delete-course") {
                if (!window.confirm("¿Eliminar este curso de la lista del portal?")) return;
                saveData(storageKeys.courses, getCourses().filter((course) => course.id !== id));
            } else if (action === "edit-course") {
                const course = getCourses().find((item) => item.id === id);
                const form = document.querySelector("[data-course-form]");
                if (!course || !form) return;
                form.querySelector("[name='course-id']").value = course.id;
                form.querySelector("[name='course-name']").value = course.name;
                form.querySelector("[type='submit']").textContent = "Guardar cambios";
                form.scrollIntoView({ behavior: "smooth", block: "center" });
                return;
            } else if (action === "delete-user") {
                saveData(storageKeys.users, getUsers().filter((user) => user.id !== id));
            } else if (action === "reset-demo") {
                if (!window.confirm("¿Restablecer avisos, cursos, consultas y contactos de demostración en este navegador?")) return;
                Object.values(storageKeys).forEach((key) => localStorage.removeItem(key));
                getCourses();
                getNotices();
            } else {
                return;
            }
            renderDashboard();
            initPublicPages();
        });
    }

    function init() {
        if (document.body.dataset.accessDenied === "true") return;
        initIndex();
        initHomeCarousel();
        initAppLoading();
        initNavigation();
        initGlobalNavigation();
        initPwa();
        initReveal();
        initTiltEffects();
        initPublicPages();
        initQueryForm();
        renderDashboard();
        initDashboardForms();
    }

    window.JMEAttendanceGetCourses = getCourses;
    window.JMEAttendanceCourseName = courseName;
    document.addEventListener("DOMContentLoaded", init);
})();