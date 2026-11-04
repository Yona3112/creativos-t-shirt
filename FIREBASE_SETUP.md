# 🔥 Migración a Google Firebase (Hosting y Firestore)

Esta guía explica cómo activar Firebase en **Camisas Gift Shop** en menos de 3 minutos, sin costos y sin banners de pago de Netlify ni límites molestos de Supabase.

---

### Paso 1: Crear el Proyecto en Firebase (Gratis)
1. Ve a [https://console.firebase.google.com/](https://console.firebase.google.com/) con tu cuenta de Google.
2. Haz clic en **"Agregar proyecto"** o **"Crear un proyecto"**.
3. Nómbralo (por ejemplo: `creativos-t-shirt` o `camisas-gift`) y dale **Continuar** (puedes desactivar Google Analytics si lo deseas).
4. Haz clic en **Crear proyecto**.

---

### Paso 2: Activar Firestore Database
1. En el menú lateral izquierdo de Firebase Console, ve a **Compilación** -> **Firestore Database**.
2. Haz clic en **Crear base de datos**.
3. Ubicación: selecciona la más cercana (ejemplo: `us-central1` o `nam5`).
4. Reglas de seguridad: selecciona **"Modo de prueba"** (o aplica las reglas del archivo `firestore.rules`).
5. Haz clic en **Habilitar**.

---

### Paso 3: Obtener las Claves de Conexión (1 Clic)
1. En la página principal de tu proyecto en Firebase Console, haz clic en el ícono de **Web** (`</>`).
2. Ponle un apodo a la app (ejemplo: `Camisas Web`) y haz clic en **Registrar app**.
3. Verás un bloque de código como este:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```
4. **Copia todo ese texto.**
5. En tu sistema de Camisas, entra a la pestaña **Ajustes**.
6. En la tarjeta superior **"🔥 Google Firebase (Recomendado)"**, pega el texto en el recuadro **⚡ Pegado Rápido** y presiona **Autocompletar**.
7. Presiona **🔥 Conectar y Sincronizar**. ¡Listo! Ya estás conectado en tiempo real.

---

### Paso 4: Publicar el Sitio en Firebase Hosting (Para reemplazar Netlify)
Si deseas que la página web esté alojada directamente en Firebase Hosting (sin banners ni límites de Netlify):

1. Abre tu terminal e instala Firebase CLI si no lo tienes:
```bash
npm install -g firebase-tools
```
2. Inicia sesión en Firebase:
```bash
firebase login
```
3. Construye y despliega el proyecto:
```bash
npm run build
firebase deploy --only hosting
```
¡Tu app quedará online al instante en una URL como `https://tu-proyecto.web.app` con certificado SSL gratis y CDN global ultrarrápido!
