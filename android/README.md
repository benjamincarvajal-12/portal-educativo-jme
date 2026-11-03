# Aplicación Android JME N°1

Proyecto Android Studio para Android 8.0 (API 26) y versiones posteriores. La app conserva el portal web y su funcionamiento, pero lo ejecuta de forma local dentro de Android WebView. El contenido se sirve desde `https://appassets.androidplatform.net/`, sin necesitar un servidor para abrir la aplicación; las fotografías remotas siguen requiriendo internet.

El WebView es necesario para mantener la interfaz HTML/CSS, sus animaciones y el almacenamiento y la navegación del portal. En Android se agrega un menú lateral compacto y se mantiene el diseño original en las demás pantallas. El panel de administración abre Resumen, Asistencia, Avisos, Cursos, Crear cuentas, Contactos, Consultas y Configuración en páginas separadas. Los archivos web se encuentran en `app/src/main/assets/www/`.

## Abrir y compilar

1. Abrir **esta carpeta `android`** en Android Studio.
2. Dejar que Gradle se sincronice con la configuración del proyecto.
3. Para generar una APK de prueba, elegir **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. Android Studio guardará la APK en `app/build/outputs/apk/debug/app-debug.apk`. Abrir la notificación de compilación y pulsar **locate** para encontrarla.
5. Para publicar una versión firmada, elegir **Build > Generate Signed Bundle / APK > APK**, crear o seleccionar un keystore y completar el asistente de firma.

También se puede compilar desde una terminal con el Gradle instalado por Android Studio:

```powershell
cd android
.\gradlew.bat assembleDebug
```

La APK de prueba se puede instalar con **Build > Select Build Variant > debug** y ejecutando la app en un dispositivo o emulador, o con:

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Requisitos

- Android Studio con Android SDK Platform 35 y Android Build Tools 35.
- JDK 17; Android Studio puede usar el JDK incluido.
- Dispositivo Android 8.0/API 26 o posterior para instalar la app.
- Se necesita internet para Firebase Authentication, Firestore y las imágenes remotas. El HTML, el menú y los estilos se incluyen en la APK.

## Configuración de Firebase

El proyecto usa Firebase Authentication (correo y contraseña) y Cloud Firestore. La configuración web pública del proyecto está en `app/src/main/assets/www/js/firebase.js` y en la copia web `../js/firebase.js`.

1. En Firebase Console, activa **Authentication > Proveedores de acceso > Correo electrónico/contraseña**.
2. Crea la base de datos de **Cloud Firestore**.
3. Publica las reglas de `../firestore.rules` desde la pestaña **Reglas** de Firestore o con Firebase CLI: `firebase deploy --only firestore:rules`.
4. Crea el primer usuario administrador en **Authentication > Users**. Copia su UID y crea manualmente el documento `users/{UID}` en Firestore con los campos `firstName`, `lastName`, `fullName`, `email` y `role: "admin"`.
5. Inicia sesión con esa cuenta usando su correo. El panel de Administración enlaza a `gestionar-cuentas.html`, una página protegida por el rol de administrador de Firebase para crear cuentas de preceptor, director y administrador. El formulario público muestra el selector de rol, pero solo permite registrar alumnos.

En el registro de alumnos, el nombre de usuario es obligatorio y el correo es opcional. Si la cuenta tiene correo, se inicia sesión con ese correo y se puede usar para recuperar la contraseña. Si no tiene correo, se inicia sesión con el nombre de usuario y no hay recuperación de contraseña por correo. Al cambiar las reglas de `../firestore.rules`, vuelve a publicarlas para admitir el registro con nombre de usuario.

Las reglas rechazan permisos elevados para perfiles creados por registro público. No publiques el portal con reglas de Firestore abiertas.

La APK de *debug* sirve para instalar y probar, pero no para distribuir públicamente. Para distribuir la aplicación, generar una APK firmada con una clave propia y conservar el keystore en un lugar seguro.
