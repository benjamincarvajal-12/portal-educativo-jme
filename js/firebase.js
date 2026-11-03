(() => {
    "use strict";

    const config = {
        apiKey: "AIzaSyDUX3J16-8aIEtrtb9I1AQBBQa8rgG6Clc",
        authDomain: "portal-educativo-jme-1.firebaseapp.com",
        projectId: "portal-educativo-jme-1",
        storageBucket: "portal-educativo-jme-1.firebasestorage.app",
        messagingSenderId: "728362713516",
        appId: "1:728362713516:web:8c7a7503d5002551a9ba09",
        measurementId: "G-PEWZ0TP8DM"
    };
    const sdkVersion = "10.14.1";

    function loadSdk(name) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-${name}-compat.js`;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`No se pudo cargar Firebase ${name}. Comprueba tu conexión a Internet.`));
            document.head.append(script);
        });
    }

    window.JMEFirebaseInternalReady = ["app", "auth", "firestore"].reduce(
        (ready, name) => ready.then(() => loadSdk(name)),
        Promise.resolve()
    ).then(async () => {
        const app = firebase.initializeApp(config);
        const auth = firebase.auth();
        const db = firebase.firestore();
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        const secondaryAppName = "jme-admin-user-creation";
        const secondaryApp = firebase.apps.find((item) => item.name === secondaryAppName)
            || firebase.initializeApp(config, secondaryAppName);
        const secondaryAuth = secondaryApp.auth();

        const services = {
            app,
            auth,
            db,
            secondaryAuth,
            config,
            roles: ["admin", "director", "preceptor", "alumno"],
            isStaff(role) {
                return ["admin", "director", "preceptor"].includes(role);
            },
            reportError(error) {
                console.error("Error de Firebase:", error);
                window.dispatchEvent(new CustomEvent("jme-cloud-error", {
                    detail: error instanceof Error ? error.message : "No se pudo completar la operación en Firebase."
                }));
            }
        };
        window.JMEFirebase = services;
        return services;
    }).catch((error) => {
        console.error("No se pudo iniciar Firebase.", error);
        window.dispatchEvent(new CustomEvent("jme-cloud-error", { detail: error.message }));
        throw error;
    });
})();
