(() => {
    "use strict";

    const ROLE_LABELS = {
        admin: "Administrador",
        director: "Director",
        preceptor: "Preceptor",
        alumno: "Alumno"
    };
    const ROLE_PAGES = {
        admin: "admin.html",
        director: "director.html",
        preceptor: "preceptor.html",
        alumno: "alumno.html"
    };
    const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
    const USERNAME_AUTH_DOMAIN = "@login.portal-jme.invalid";
    let activeUser = null;
    let activeProfile = null;
    let authStateReady = false;
    let registrationInProgress = false;
    let userListUnsubscribe = null;
    let adminUserManagementInitialized = false;
    let accountSettingsInitialized = false;

    function setStatus(element, message, isError = false) {
        if (!element) return;
        element.textContent = message;
        element.classList.toggle("is-error", isError);
    }

    function showAccessDenied(requiredRole, message = "Debes iniciar sesión con una cuenta autorizada para entrar a esta página.") {
        document.body.dataset.accessDenied = "true";
        document.body.className = "auth-denied-page";
        document.body.replaceChildren();
        const shell = document.createElement("main");
        shell.className = "auth-page page-shell";
        const panel = document.createElement("section");
        panel.className = "access-denied-panel";
        const lock = document.createElement("span");
        lock.className = "auth-lock-icon";
        lock.setAttribute("aria-hidden", "true");
        lock.textContent = "🔒";
        const eyebrow = document.createElement("p");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = "Acceso restringido";
        const heading = document.createElement("h1");
        heading.textContent = "Acceso denegado";
        const copy = document.createElement("p");
        copy.textContent = message;
        const actions = document.createElement("div");
        actions.className = "button-row";
        const login = document.createElement("a");
        login.className = "button";
        login.href = `login.html${requiredRole ? `?role=${encodeURIComponent(requiredRole)}` : ""}`;
        login.textContent = "Iniciar sesión";
        const home = document.createElement("a");
        home.className = "button secondary";
        home.href = "index.html";
        home.textContent = "Volver al inicio";
        actions.append(login, home);
        const warning = document.createElement("p");
        warning.className = "auth-security-note";
        warning.textContent = "Los permisos se validan con el perfil de Firebase y las reglas de Firestore.";
        panel.append(lock, eyebrow, heading, copy, actions, warning);
        shell.append(panel);
        document.body.append(shell);
    }

    function getLoginPage() {
        return document.querySelector("[data-login-page]");
    }

    function setLoginMode(page, mode) {
        const isRegister = mode === "register";
        const loginForm = page.querySelector("[data-login-form]");
        const registerForm = page.querySelector("[data-register-form]");
        const title = page.querySelector("[data-auth-title]");
        const intro = page.querySelector("[data-login-intro]");
        const modeButton = page.querySelector("[data-auth-mode]");
        loginForm.hidden = isRegister;
        registerForm.hidden = !isRegister;
        title.textContent = isRegister ? "Crear cuenta" : "Iniciar sesión";
        intro.textContent = isRegister
            ? "Completa tus datos y selecciona el rol que corresponda. El correo es opcional."
            : "Ingresa con el correo electrónico o, si tu cuenta no tiene correo, con tu nombre de usuario.";
        modeButton.dataset.authMode = isRegister ? "login" : "register";
        modeButton.textContent = isRegister ? "Ya tengo cuenta · Iniciar sesión" : "Registrarse";
        setStatus(page.querySelector("[data-auth-status]"), "");
    }

    function updateRegisterRoleHint(form) {
        const role = form.elements.namedItem("role").value;
        const hint = form.querySelector("[data-register-role-hint]");
        if (!hint) return;
        hint.textContent = role === "alumno"
            ? "El registro en línea está habilitado para alumnos. Las cuentas del personal las crea el administrador institucional."
            : `El registro público no puede crear cuentas de ${ROLE_LABELS[role] || "este rol"}. Solicita al administrador institucional que te cree una cuenta.`;
    }

    function usernameAuthEmail(username) {
        return `jme.${username}${USERNAME_AUTH_DOMAIN}`;
    }

    function usernameFromAuthEmail(email) {
        if (typeof email !== "string" || !email.startsWith("jme.") || !email.endsWith(USERNAME_AUTH_DOMAIN)) return "";
        const username = email.slice(4, -USERNAME_AUTH_DOMAIN.length);
        return USERNAME_PATTERN.test(username) ? username : "";
    }

    async function createMissingUsernameProfile(services, user) {
        const username = usernameFromAuthEmail(user.email);
        if (!username) return null;

        const nameParts = String(user.displayName || username).trim().split(/\s+/);
        const firstName = nameParts.shift() || username;
        const lastName = nameParts.join(" ");
        const fullName = `${firstName} ${lastName}`.trim();
        const profile = {
            firstName,
            lastName,
            fullName,
            username,
            email: "",
            role: "alumno",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await services.db.collection("users").doc(user.uid).set(profile);
        const snapshot = await services.db.collection("users").doc(user.uid).get();
        if (!snapshot.exists) throw new Error("No se pudo crear el perfil de alumno en Firestore.");
        return snapshot.data();
    }

    function initPasswordVisibility() {
        document.querySelectorAll("input[type='password']").forEach((input) => {
            const wrapper = document.createElement("div");
            wrapper.className = "password-input-wrap";
            input.parentNode.insertBefore(wrapper, input);
            wrapper.append(input);

            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "password-visibility-toggle";
            toggle.textContent = "👁";
            toggle.setAttribute("aria-label", "Mostrar contraseña");
            toggle.setAttribute("aria-pressed", "false");
            toggle.setAttribute("aria-controls", input.id);
            toggle.addEventListener("click", () => {
                const showPassword = input.type === "password";
                input.type = showPassword ? "text" : "password";
                toggle.setAttribute("aria-label", showPassword ? "Ocultar contraseña" : "Mostrar contraseña");
                toggle.setAttribute("aria-pressed", String(showPassword));
            });
            wrapper.append(toggle);
        });
    }

    function showProfileValues(profile) {
        const values = {
            name: profile.firstName,
            surname: profile.lastName,
            role: ROLE_LABELS[profile.role] || profile.role,
            email: profile.email || "No agregado",
            username: profile.username || "No registrado"
        };
        Object.entries(values).forEach(([key, value]) => {
            document.querySelectorAll(`[data-profile-value='${key}']`).forEach((target) => {
                target.textContent = value || "No registrado";
            });
        });
    }

    function initAccountSettings(services, user, profile) {
        const profileForm = document.querySelector("[data-account-profile-form]");
        const passwordForm = document.querySelector("[data-change-password-form]");
        if ((!profileForm && !passwordForm) || accountSettingsInitialized) return;
        accountSettingsInitialized = true;

        if (profileForm) {
            profileForm.elements.namedItem("first-name").value = profile.firstName || "";
            profileForm.elements.namedItem("last-name").value = profile.lastName || "";
            profileForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!profileForm.reportValidity()) return;
                const submit = profileForm.querySelector("[type='submit']");
                const status = profileForm.querySelector("[data-profile-status]");
                const firstName = profileForm.elements.namedItem("first-name").value.trim();
                const lastName = profileForm.elements.namedItem("last-name").value.trim();
                const fullName = `${firstName} ${lastName}`.trim();
                submit.disabled = true;
                setStatus(status, "Guardando datos...");
                try {
                    await services.db.collection("users").doc(user.uid).update({
                        firstName,
                        lastName,
                        fullName,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    await user.updateProfile({ displayName: fullName });
                    activeProfile = { ...activeProfile, firstName, lastName, fullName };
                    showProfileValues(activeProfile);
                    updateAuthenticatedChrome(user, activeProfile);
                    setStatus(status, "Datos guardados correctamente.");
                } catch (error) {
                    services.reportError(error);
                    setStatus(status, `No se pudieron guardar los datos: ${error.message}`, true);
                } finally {
                    submit.disabled = false;
                }
            });
        }

        if (passwordForm) {
            passwordForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!passwordForm.reportValidity()) return;
                const status = passwordForm.querySelector("[data-password-status]");
                const submit = passwordForm.querySelector("[type='submit']");
                const currentPassword = passwordForm.elements.namedItem("current-password").value;
                const newPassword = passwordForm.elements.namedItem("new-password").value;
                const confirmPassword = passwordForm.elements.namedItem("confirm-password").value;
                if (newPassword !== confirmPassword) {
                    setStatus(status, "Las nuevas contraseñas no coinciden.", true);
                    return;
                }
                if (newPassword === currentPassword) {
                    setStatus(status, "La nueva contraseña debe ser diferente de la actual.", true);
                    return;
                }
                submit.disabled = true;
                setStatus(status, "Verificando cuenta y cambiando contraseña...");
                try {
                    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
                    await user.reauthenticateWithCredential(credential);
                    await user.updatePassword(newPassword);
                    passwordForm.reset();
                    setStatus(status, "Contraseña cambiada correctamente.");
                } catch (error) {
                    services.reportError(error);
                    const message = error.code === "auth/wrong-password" || error.code === "auth/invalid-credential"
                        ? "La contraseña actual no es correcta."
                        : error.message;
                    setStatus(status, `No se pudo cambiar la contraseña: ${message}`, true);
                } finally {
                    submit.disabled = false;
                }
            });
        }
    }

    function updateAuthenticatedChrome(user, profile) {
        document.body.dataset.sessionRole = profile.role;
        window.JMESession = { userId: user.uid, ...profile };
        const profileHome = document.querySelector("[data-profile-home]");
        if (profileHome) profileHome.href = ROLE_PAGES[profile.role];
        showProfileValues(profile);
        initAccountMenu();
    }

    function initAccountMenu() {
        let menu = document.querySelector("[data-account-menu]");
        if (menu) return;

        menu = document.createElement("div");
        menu.className = "account-menu";
        menu.dataset.accountMenu = "true";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "account-menu-toggle";
        toggle.textContent = "⚙";
        toggle.setAttribute("aria-label", "Abrir configuración de cuenta");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", "account-menu-panel");

        const panel = document.createElement("div");
        panel.className = "account-menu-panel";
        panel.id = "account-menu-panel";
        panel.hidden = true;

        const heading = document.createElement("p");
        heading.className = "account-menu-heading";
        heading.textContent = "Cuenta";

        const profileLink = document.createElement("a");
        profileLink.href = "mi-perfil.html#account-profile";
        profileLink.textContent = "👤 Mi perfil";

        const passwordLink = document.createElement("a");
        passwordLink.href = "mi-perfil.html#password-settings";
        passwordLink.textContent = "🔐 Cambiar contraseña";

        const visibilityLink = document.createElement("a");
        visibilityLink.href = "mi-perfil.html#password-settings";
        visibilityLink.textContent = "👁 Ver lo que escribes";

        const switchAccount = document.createElement("button");
        switchAccount.type = "button";
        switchAccount.className = "account-menu-switch";
        switchAccount.dataset.accountSwitch = "true";
        switchAccount.textContent = "⇄ Cambiar de cuenta";

        const logout = document.createElement("button");
        logout.type = "button";
        logout.dataset.logout = "true";
        logout.textContent = "Cerrar sesión";

        panel.append(heading, profileLink, passwordLink, visibilityLink, switchAccount, logout);
        menu.append(toggle, panel);
        document.body.append(menu);

        toggle.addEventListener("click", () => {
            const isOpen = !panel.hidden;
            panel.hidden = isOpen;
            toggle.setAttribute("aria-expanded", String(!isOpen));
        });
        document.addEventListener("click", (event) => {
            if (menu.contains(event.target)) return;
            panel.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            panel.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            toggle.focus();
        });
    }

    function renderUsers(container, users) {
        if (!container) return;
        container.replaceChildren();
        if (!users.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "Todavía no hay cuentas registradas.";
            container.append(empty);
            return;
        }
        users.sort((left, right) => `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "es"));
        users.forEach((user) => {
            const row = document.createElement("article");
            row.className = "data-row auth-account-row";
            const details = document.createElement("div");
            const name = document.createElement("h3");
            name.textContent = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
            const email = document.createElement("p");
            email.textContent = user.email || "";
            const role = document.createElement("span");
            role.className = "badge";
            role.textContent = ROLE_LABELS[user.role] || user.role;
            details.append(name, email, role);
            row.append(details);
            container.append(row);
        });
    }

    function initAdminUserManagement(services, user) {
        const form = document.querySelector("[data-auth-user-form]");
        const list = document.querySelector("[data-auth-user-list]");
        if (!form || activeProfile?.role !== "admin" || adminUserManagementInitialized) return;
        adminUserManagementInitialized = true;
        const status = form.querySelector("[data-auth-status]");
        const submit = form.querySelector("[type='submit']");

        userListUnsubscribe?.();
        userListUnsubscribe = services.db.collection("users").onSnapshot((snapshot) => {
            renderUsers(list, snapshot.docs.map((document) => ({ ...document.data(), id: document.id })));
        }, (error) => {
            setStatus(status, `No se pudo cargar el directorio: ${error.message}`, true);
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const values = new FormData(form);
            const firstName = String(values.get("account-first-name") || "").trim();
            const lastName = String(values.get("account-last-name") || "").trim();
            const email = String(values.get("account-email") || "").trim().toLowerCase();
            const password = String(values.get("account-password") || "");
            const role = String(values.get("account-role") || "");
            if (!services.roles.includes(role)) {
                setStatus(status, "El rol seleccionado no es válido.", true);
                return;
            }

            submit.disabled = true;
            let createdUser = null;
            try {
                setStatus(status, "Creando cuenta en Firebase Authentication...");
                const credential = await services.secondaryAuth.createUserWithEmailAndPassword(email, password);
                createdUser = credential.user;
                await createdUser.updateProfile({ displayName: `${firstName} ${lastName}`.trim() });
                await services.db.collection("users").doc(createdUser.uid).set({
                    firstName,
                    lastName,
                    fullName: `${firstName} ${lastName}`.trim(),
                    email,
                    role,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                await services.secondaryAuth.signOut();
                form.reset();
                setStatus(status, `Cuenta de ${ROLE_LABELS[role]} creada correctamente.`);
            } catch (error) {
                if (createdUser) {
                    try {
                        await createdUser.delete();
                    } catch (cleanupError) {
                        console.error("No se pudo limpiar la cuenta incompleta de Firebase Authentication.", cleanupError);
                    }
                    await services.secondaryAuth.signOut().catch((cleanupError) => console.error("No se pudo cerrar la sesión secundaria.", cleanupError));
                }
                setStatus(status, error.message || "No se pudo crear la cuenta.", true);
            } finally {
                submit.disabled = false;
            }
        });
    }

    function initAuthPage(services) {
        const page = getLoginPage();
        if (!page) return;
        const loginForm = page.querySelector("[data-login-form]");
        const registerForm = page.querySelector("[data-register-form]");
        const status = page.querySelector("[data-auth-status]");
        const expectedRole = new URLSearchParams(window.location.search).get("role");
        const validExpectedRole = services.roles.includes(expectedRole);
        const isSwitchingAccount = new URLSearchParams(window.location.search).get("switch") === "1";

        const modeButton = page.querySelector("[data-auth-mode]");
        modeButton.addEventListener("click", () => setLoginMode(page, modeButton.dataset.authMode));
        if (new URLSearchParams(window.location.search).get("mode") === "register") {
            setLoginMode(page, "register");
        }
        if (isSwitchingAccount) {
            page.querySelector("[data-auth-title]").textContent = "Cambiar de cuenta";
            page.querySelector("[data-login-intro]").textContent = "Ingresa con otra cuenta que ya esté registrada. No se creará una cuenta nueva.";
            setStatus(status, "La sesión anterior se cerró. Inicia sesión con el correo o nombre de usuario y la contraseña de tu otra cuenta.");
        }
        const registerRole = registerForm.elements.namedItem("role");
        registerRole.addEventListener("change", () => {
            updateRegisterRoleHint(registerForm);
            setStatus(status, "");
        });
        updateRegisterRoleHint(registerForm);

        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!loginForm.reportValidity()) return;
            const values = new FormData(loginForm);
            const submit = loginForm.querySelector("[type='submit']");
            const loginName = String(values.get("email") || "").trim().toLowerCase();
            const authEmail = loginName.includes("@")
                ? loginName
                : USERNAME_PATTERN.test(loginName) ? usernameAuthEmail(loginName) : "";
            if (!authEmail) {
                setStatus(status, "Ingresa un correo válido o un nombre de usuario de 3 a 30 caracteres (letras, números, punto, guion o guion bajo).", true);
                return;
            }
            submit.disabled = true;
            setStatus(status, "Iniciando sesión...");
            try {
                await services.auth.signInWithEmailAndPassword(
                    authEmail,
                    String(values.get("password") || "")
                );
            } catch (error) {
                setStatus(status, error.message || "No se pudo iniciar sesión.", true);
                submit.disabled = false;
            }
        });

        registerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!registerForm.reportValidity()) return;
            const values = new FormData(registerForm);
            const firstName = String(values.get("first-name") || "").trim();
            const lastName = String(values.get("last-name") || "").trim();
            const username = String(values.get("username") || "").trim().toLowerCase();
            const email = String(values.get("email") || "").trim().toLowerCase();
            const role = String(values.get("role") || "");
            if (!services.roles.includes(role)) {
                setStatus(status, "Selecciona un rol válido.", true);
                return;
            }
            if (role !== "alumno") {
                setStatus(
                    status,
                    `No se puede crear una cuenta de ${ROLE_LABELS[role]} desde el registro público. Solicita al administrador institucional que cree tu cuenta con ese rol.`,
                    true
                );
                return;
            }
            if (!USERNAME_PATTERN.test(username)) {
                setStatus(status, "El nombre de usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.", true);
                return;
            }
            const authEmail = email || usernameAuthEmail(username);
            const password = String(values.get("password") || "");
            const submit = registerForm.querySelector("[type='submit']");
            submit.disabled = true;
            registrationInProgress = true;
            setStatus(status, "Creando cuenta...");
            let createdUser = null;
            try {
                const credential = await services.auth.createUserWithEmailAndPassword(authEmail, password);
                createdUser = credential.user;
                const fullName = `${firstName} ${lastName}`.trim();
                await createdUser.updateProfile({ displayName: fullName });
                const profile = {
                    firstName,
                    lastName,
                    fullName,
                    username,
                    email,
                    role: "alumno",
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await services.db.collection("users").doc(createdUser.uid).set(profile);
                activeUser = createdUser;
                activeProfile = profile;
                setStatus(status, email
                    ? "Cuenta creada. Ingresando al portal educativo..."
                    : `Cuenta creada. Tu nombre de usuario es ${username}. Ingresando al portal...`);
                registrationInProgress = false;
                await new Promise((resolve) => window.setTimeout(resolve, 350));
                window.location.replace(ROLE_PAGES.alumno);
            } catch (error) {
                registrationInProgress = false;
                let message = error.message || "No se pudo crear la cuenta.";
                if (error.code === "permission-denied") {
                    message = "Firebase rechazó guardar el perfil. Verifica que las reglas publicadas permitan crear users/{UID} para alumnos.";
                }
                if (createdUser) {
                    try {
                        await createdUser.delete();
                        await services.auth.signOut();
                    } catch (cleanupError) {
                        services.reportError(cleanupError);
                        message += " La cuenta de acceso se creó, pero no se pudo completar o limpiar el perfil; contacta al administrador antes de volver a registrarte.";
                    }
                }
                setStatus(status, message, true);
                submit.disabled = false;
            }
        });
    }

    async function handleAuthState(services, user) {
        activeUser = user;
        const loginPage = getLoginPage();
        const requiredRole = document.body.dataset.dashboardRole;
        const requiresAuthentication = !loginPage;
        const loginSubmit = loginPage?.querySelector("[data-login-form] [type='submit']");
        if (!user) {
            activeProfile = null;
            window.JMESession = null;
            window.JMEStopCloudSync?.();
            if (requiresAuthentication) {
                window.location.replace(`login.html${requiredRole ? `?role=${encodeURIComponent(requiredRole)}` : ""}`);
            }
            authStateReady = true;
            return;
        }

        try {
            const profileReference = services.db.collection("users").doc(user.uid);
            const profileSnapshot = await profileReference.get();
            let profile = profileSnapshot.exists ? profileSnapshot.data() : null;
            if (!profile && !registrationInProgress) {
                profile = await createMissingUsernameProfile(services, user);
            }
            if (!profile) {
                if (!registrationInProgress) {
                    await services.auth.signOut();
                    if (loginPage) {
                        setStatus(
                            loginPage.querySelector("[data-auth-status]"),
                            "No se encontró el perfil de esta cuenta. Si es una cuenta de personal, pide al administrador que cree el documento users/{UID} con el rol correcto.",
                            true
                        );
                        if (loginSubmit) loginSubmit.disabled = false;
                    }
                    if (requiresAuthentication) {
                        showAccessDenied(requiredRole, "La cuenta no tiene un perfil institucional. Contacta al administrador.");
                    }
                }
                authStateReady = true;
                return;
            }
            if (!services.roles.includes(profile.role)) throw new Error("El rol de esta cuenta no es válido.");
            const requestedRole = new URLSearchParams(window.location.search).get("role");
            const isRegisterMode = Boolean(loginPage && !loginPage.querySelector("[data-register-form]").hidden);
            if (loginPage && !registrationInProgress && !isRegisterMode && services.roles.includes(requestedRole) && requestedRole !== profile.role) {
                setStatus(loginPage.querySelector("[data-auth-status]"), `Esta cuenta tiene el rol ${ROLE_LABELS[profile.role]}, no ${ROLE_LABELS[requestedRole]}.`, true);
                await services.auth.signOut();
                if (loginSubmit) loginSubmit.disabled = false;
                authStateReady = true;
                return;
            }
            activeProfile = profile;
            updateAuthenticatedChrome(user, profile);
            await window.JMEStartCloudSync?.(user, profile);

            if (requiredRole && profile.role !== requiredRole) {
                showAccessDenied(requiredRole, `Esta página requiere el rol ${ROLE_LABELS[requiredRole]}. Tu cuenta es ${ROLE_LABELS[profile.role]}.`);
                authStateReady = true;
                return;
            }
            if (document.body.hasAttribute("data-profile-page")) {
                showProfileValues(profile);
                initAccountSettings(services, user, profile);
            }
            if (profile.role === "admin") initAdminUserManagement(services, user);
            if (loginPage) {
                window.location.replace(ROLE_PAGES[profile.role]);
            }
            authStateReady = true;
        } catch (error) {
            services.reportError(error);
            if (loginPage) {
                setStatus(loginPage.querySelector("[data-auth-status]"), error.message, true);
                if (loginSubmit) loginSubmit.disabled = false;
            }
            if (requiresAuthentication) {
                showAccessDenied(requiredRole, "No se pudo validar el perfil. Comprueba la conexión y las reglas de Firestore.");
            }
            authStateReady = true;
        }
    }

    function initLogout(services) {
        document.addEventListener("click", async (event) => {
            const control = event.target.closest("[data-logout], [data-account-switch], .nav-exit");
            if (!control) return;
            event.preventDefault();
            control.disabled = true;
            const isAccountSwitch = control.hasAttribute("data-account-switch");
            try {
                await services.auth.signOut();
                window.location.replace(isAccountSwitch ? "login.html?switch=1" : "index.html");
            } catch (error) {
                services.reportError(error);
                control.disabled = false;
            }
        });
    }

    async function init() {
        initPasswordVisibility();
        try {
            const services = await window.JMEFirebaseReady;
            initAuthPage(services);
            initLogout(services);
            services.auth.onAuthStateChanged((user) => handleAuthState(services, user));
        } catch (error) {
            const status = document.querySelector("[data-auth-status]");
            setStatus(status, `No se pudo conectar con Firebase: ${error.message}`, true);
            if (!getLoginPage()) {
                showAccessDenied(document.body.dataset.dashboardRole, "No se pudo conectar con Firebase. Comprueba la conexión a Internet.");
            }
            authStateReady = true;
        }
    }

    window.JMEAuthStateReady = new Promise((resolve) => {
        const check = window.setInterval(() => {
            if (!authStateReady) return;
            window.clearInterval(check);
            resolve({ user: activeUser, profile: activeProfile });
        }, 50);
    });
    init();
})();
