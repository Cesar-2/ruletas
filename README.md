# Ruletón — Sorteos Dofus

Aplicación web para consultar el catálogo de recursos de Dofus, sortear objetos al azar
y marcar cuáles son caros (dorado / plateado) o cuáles quedan fuera del sorteo.

Un solo proceso Node sirve la API y la interfaz web: no hay que arrancar dos servidores.

---

## Requisitos

| | Versión probada |
|---|---|
| Node.js | 24.13.1 (cualquier v18+ debería servir) |
| npm | 11.8.0 |

Comprueba lo que tienes con:

```bash
node -v
npm -v
```

> Los comandos de este README se dan en dos sabores: **PowerShell** (Windows) y
> **bash/zsh** (macOS y Linux). Usa el que corresponda a tu sistema.

---

## Instalación

### Windows (PowerShell)

```powershell
cd c:\Users\cesar\Desktop\Test
npm install
```

### macOS / Linux

```bash
cd /ruta/al/proyecto
npm install
```

---

## Arrancar y parar con un clic

Para quien solo quiere usar la aplicación, sin tocar la terminal. Arrancan el
servidor en segundo plano, esperan a que responda y abren el navegador solo:

| | Arrancar | Parar |
|---|---|---|
| **Windows** | `iniciar-ruleton.vbs` | `detener-ruleton.vbs` |
| **macOS** | `iniciar-ruleton.command` | `detener-ruleton.command` |

Doble clic y listo. La primera vez instalan las dependencias, así que tardan un
par de minutos; después arrancan en segundos. Si algo falla, avisan con un
diálogo e indican dónde está el log.

En Windows los `.vbs` no dejan ninguna ventana abierta; los `.cmd` del mismo
nombre son los que hacen el trabajo y pueden usarse directamente si se prefiere
ver la consola. En macOS, la primera vez hay que abrirlos con **clic derecho >
Abrir** para saltarse el aviso de Gatekeeper, y si el sistema no los deja
ejecutar: `chmod +x *.command`.

---

## Arrancar en desarrollo

```powershell
npm run dev
```

Abre **http://localhost:3000**

Usa `ts-node-dev`, así que ejecuta el TypeScript directamente y **se reinicia solo**
cada vez que guardas un cambio en `src/server.ts`. Los cambios en `public/index.html`
no necesitan reinicio: basta recargar el navegador con **Ctrl + F5** (el refresco normal
puede servir la página desde la caché).

### Cambiar el puerto

En Windows (PowerShell):

```powershell
$env:PORT = "4000"; npm run dev
```

En macOS / Linux:

```bash
PORT=4000 npm run dev
```

### Pararlo

**Ctrl + C** en la terminal donde corre.

Si lo lanzaste en segundo plano y el puerto queda ocupado, ten en cuenta que
`ts-node-dev --respawn` levanta un proceso supervisor y otro trabajador: si solo matas el
que escucha en el puerto, el supervisor lo revive. Hay que cerrar todo el árbol.

En Windows (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'ts-node-dev|server.ts' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

En macOS / Linux:

```bash
pkill -f ts-node-dev
```

---

## Arrancar en producción

No hay script de build todavía. Manualmente:

```bash
npx tsc -p .
node dist/server.js
```

> **Aviso:** la carpeta `dist/` del repositorio está **desactualizada** — le faltan los
> endpoints `/api/exclusions` y `/api/tags`. Ejecuta `npx tsc -p .` antes de usarla.

`npx tsc -p .` mostrará dos errores `TS7016` por los tipos de `express` y `cors`. **No
impiden que la app funcione** (`npm run dev` usa `--transpile-only` y los ignora). Para
quitarlos:

```bash
npm i --save-dev @types/express @types/cors
```

---

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/auth/me` | Quién ha entrado (401 si no hay sesión) |
| `POST` | `/api/auth/register` | Crea cuenta. Body: `{ "username", "password", "invite"? }` |
| `POST` | `/api/auth/login` | Entra. Body: `{ "username", "password" }` |
| `POST` | `/api/auth/logout` | Cierra la sesión |
| `GET` | `/api/items` | Catálogo completo de recursos |
| `GET` | `/api/random-items?n=3` | Sortea `n` objetos, omitiendo los excluidos |
| `GET` | `/api/exclusions` | Lista de IDs excluidos del sorteo |
| `PUT` | `/api/exclusions` | Guarda la lista. Body: `{ "ids": ["123"] }` |
| `GET` | `/api/tags` | Colores asignados por objeto |
| `PUT` | `/api/tags` | Guarda los colores. Body: `{ "tags": { "123": "gold" } }` |
| `POST` | `/api/draw` | Sorteo entre participantes (sin uso en la UI actual) |
| `GET` | `/api/servers` | Lista de servidores de Dofus dados de alta |
| `POST` | `/api/servers` | Crea uno vacío. Body: `{ "name": "Tal Kasha" }` |
| `PATCH` | `/api/servers/:id` | Lo renombra. Body: `{ "name": "..." }` |
| `DELETE` | `/api/servers/:id` | Lo borra con sus datos (nunca el último) |

**Todo lo que no sea `/api/auth/*` exige sesión** y responde `401` sin ella. De quién son
los datos lo decide la cookie, nunca un parámetro.

Las rutas de exclusiones, colores, ganadores y ranking aceptan `?server=<id>`.
Si se omite se usa el primer servidor de la lista.

Los únicos valores válidos en `tags` son `gold` y `silver`; el resto se descarta al guardar.

---

## Datos

Todo se guarda como JSON plano en `data/`, que se crea al arrancar si no existe:

| Archivo | Contenido |
|---|---|
| `items.json` | Caché del catálogo descargado de la API de Dofus (común a todos) |
| `users.json` | Cuentas: usuario, nombre y contraseña derivada con scrypt |
| `sessions.json` | Sesiones abiertas (token y caducidad) |
| `users/<u>/settings.json` | Aspecto de la página de ese usuario |
| `users/<u>/servers.json` | Servidores de Dofus de ese usuario |
| `users/<u>/servers/<id>/exclusions.json` | IDs excluidos del sorteo en ese servidor |
| `users/<u>/servers/<id>/tags.json` | Rarezas (raro/épico/mítico) en ese servidor |
| `users/<u>/servers/<id>/kamas.json` | Lo que cuesta ahí un equipable de nivel 200 |
| `users/<u>/servers/<id>/winners.json` | Ganadores pendientes de entregar |
| `users/<u>/servers/<id>/ranking.json` | Histórico de lo ya entregado |
| `users/<u>/servers/<id>/stream.json` | Top del stream en curso |

En el primer arranque, si `items.json` no existe, el servidor descarga el catálogo de
`api.dofusdu.de` y lo cachea. A partir de ahí trabaja siempre desde el archivo local; si
la descarga falla y hay caché, usa la caché.

Para forzar una descarga nueva, borra el archivo:

```powershell
Remove-Item data\items.json      # Windows
```

```bash
rm data/items.json               # macOS / Linux
```

**Todo cuelga de la cuenta**: cada usuario tiene su propio Ruletón —su aspecto, sus
servidores, sus ganadores y su historial— y nadie más lo ve. Lo único compartido es el
catálogo de objetos.

### Cuentas y login

La página no muestra nada hasta entrar. Cada cuenta tiene su propio Ruletón y el
servidor saca de la sesión de quién son los datos: el navegador nunca dice a qué
usuario pertenecen, así que cambiar un parámetro en la URL no sirve de nada.

- **La primera cuenta que se registre es la del dueño** y se queda con los datos que ya
  hubiera en `data/` (de una versión anterior, sin login). No pide código, y es la
  **administradora**: la única que ve el panel de acceso.
- **A partir de ahí los registros están cerrados**, salvo que el administrador ponga un
  código de invitación. Quien quiera crear cuenta tendrá que escribirlo.
- Las contraseñas se guardan derivadas con `scrypt` y una sal distinta por cuenta: del
  archivo no se puede sacar la original. Mínimo 8 caracteres.
- La sesión es una cookie `httpOnly` que dura 30 días; **Salir** la cierra en el servidor.
- Tras 10 intentos fallidos, esa IP se queda 15 minutos sin poder probar más.

#### El panel de acceso

En **Configuración > 🔑 Acceso**, que solo le aparece al administrador. Desde ahí se
maneja todo sin tocar archivos ni reiniciar el servidor:

- **El código de invitación.** Se escribe, se genera uno al azar o se borra. Vacío
  significa registros cerrados: nadie puede crear cuenta y solo entra quien ya la
  tenga. Lo normal es ponerlo mientras das de alta a la gente y borrarlo al terminar.
- **Quitar el acceso a una cuenta.** La echa fuera al momento (no espera a que caduque
  su cookie) y le impide volver a entrar, pero **conserva su Ruletón** por si se lo
  devuelves.
- **Borrar una cuenta.** Se lleva también sus servidores, ganadores e historial. No se
  puede deshacer.
- **Cerrar la sesión de alguien** sin quitarle el acceso, y **nombrar a otro
  administrador**.
- **Restablecer una contraseña olvidada.** Le pone una temporal y te la enseña
  **una sola vez** para que se la pases; en disco solo queda el hash, así que
  después ya no hay forma de verla. De paso le cierra la sesión.

#### Si la contraseña perdida es la tuya

No hay recuperación por correo a propósito. Para eso está el comando de rescate,
que se ejecuta donde estén los datos:

```bash
npm run password -- --listar              # ver qué cuentas hay
npm run password -- admin                 # ponerle una temporal y enseñarla
npm run password -- admin MiClaveNueva1   # o la que tú digas
```

Respeta `RULETON_DATA`, así que en un hosting basta con entrar por SSH y lanzarlo
desde la carpeta de la aplicación. También desbloquea la cuenta, por si estaba sin
acceso.

Contra la propia cuenta no se puede actuar y siempre tiene que quedar al menos un
administrador: así no hay forma de dejarse fuera del panel. A quien no es administrador
el panel le responde `404`, no `403`: ni le consta que exista.

El código vive en `data/config.json`, que como todo `data/` no se versiona.

#### Publicarlo en internet

| Variable | Para qué |
|---|---|
| `RULETON_INVITE` | Código inicial para crear cuentas. **Solo se usa la primera vez**, para sembrar `data/config.json`; a partir de ahí manda el panel de acceso |
| `RULETON_DATA` | Carpeta de los datos. **Imprescindible en un hosting**: apúntala fuera de la carpeta de la aplicación o cada despliegue borrará cuentas, ganadores e imágenes |
| `TRUST_PROXY=1` | Detrás de un proxy (Render, Fly, nginx…), para reconocer HTTPS |
| `COOKIE_SECURE=1` | Fuerza que la cookie de sesión solo viaje por HTTPS |
| `PORT` | Puerto de escucha (por defecto 3000) |
| `TWITCH_REDIRECT` | Solo para los puntos de canal de Twitch: `https://tu-dominio/api/twitch/callback`. Tiene que coincidir con la URL de redireccion de la app de Twitch. Sin ella se usa `localhost`, que en un hosting no vale |

```bash
RULETON_INVITE=lo-que-quieras TRUST_PROXY=1 COOKIE_SECURE=1 npm run dev
```

Los minijuegos que leen el chat (carrera, batalla, inscripción de la ruleta) **no
necesitan nada de esto**: se conectan de salida y como anónimos, así que basta con
que cada streamer ponga su canal en Configuración > Mi cuenta.

Eso sí, piden **Node 22 o más nuevo**: usan el `WebSocket` que Node trae de serie a
partir de esa versión. En uno más viejo, abrir la carrera responde diciéndolo.

Sírvelo **siempre por HTTPS**: sin él, la contraseña y la cookie viajan en claro.

#### En un VPS (Hostinger y similares)

Necesitas un **VPS**, no alojamiento compartido: el compartido no mantiene vivo un
proceso de Node. En un VPS el disco es persistente, así que los datos en JSON aguantan
de sobra —todo lo que no sea el catálogo ocupa unas decenas de KB— y no hace falta base
de datos.

1. **El proceso, siempre levantado.** Con `pm2` sobrevive a reinicios del servidor:

   ```bash
   npm install -g pm2
   RULETON_INVITE=lo-que-quieras TRUST_PROXY=1 COOKIE_SECURE=1 \
     pm2 start "npm run dev" --name ruleton
   pm2 save && pm2 startup
   ```

2. **HTTPS por delante.** Nginx como proxy hacia el puerto 3000 y el certificado con
   `certbot --nginx`. El `TRUST_PROXY=1` es lo que hace que la app reconozca que la
   conexión venía por HTTPS y marque la cookie como segura.

3. **Copias de `data/`.** Ahí están las cuentas, los ganadores y el histórico; el
   catálogo se vuelve a descargar solo. Una tarea diaria basta:

   ```bash
   0 4 * * * cd /ruta/al/ruleton && tar czf ~/copias/data-$(date +\%F).tgz data
   ```

Los ficheros se guardan de forma atómica (se escribe un `.tmp` y se renombra encima),
así que un corte de luz o un reinicio a destiempo no deja un JSON a medias.

Las imágenes que subas (fondo, logo, ruleta) se guardan en `public/assets/` con un
nombre aleatorio y se sirven sin pedir sesión: quien tenga la URL exacta puede verlas.
No subas ahí nada que no quieras enseñar.

### Servidores

Los precios de los recursos cambian de un servidor de Dofus a otro, así que **rarezas,
referencia de precios, exclusiones, ganadores y ranking se guardan por servidor**. El selector está en la
cabecera, junto al título: `＋` crea uno, `✎` lo renombra y `🗑` lo borra con sus datos.
El catálogo de objetos es común a todos los usuarios; el aspecto es de cada cuenta.

El servidor elegido se recuerda en el navegador (`localStorage`), de modo que cada
equipo puede quedarse en el suyo.

### Llevarte tus exclusiones y rarezas

Quien ya las tenga personalizadas en su equipo no necesita rehacerlas. En
**Configuración → Exclusiones y rarezas**:

- **Descargar** guarda un JSON con las exclusiones y las rarezas del servidor abierto.
- **Cargar desde un archivo** admite tres formatos: esa copia, un `exclusions.json`
  suelto (una lista de ids) o un `tags.json` suelto (objeto de id a rareza), tal cual
  están en `data/` en una instalación anterior.

Al cargar se pregunta si **añadir** a lo que ya haya o **reemplazarlo**. Las rarezas que
no sean `rare`, `epic` o `mythic` se descartan.

### Llevarte la lista de ganadores

Igual, en **Configuración → Datos → Ganadores**. Sirve para pasar la lista del equipo
a la web publicada, que son instalaciones independientes.

- **Descargar ganadores** guarda un JSON con los del servidor abierto.
- **Cargar desde un archivo** admite esa copia o un `winners.json` suelto de `data/`.

También pregunta si **añadir** o **reemplazar**. Añadiendo, a quien ya esté en la lista
se le suma el premio en su entrada en vez de duplicarla, igual que cuando le toca dos
veces sorteando. Todo lo que entra pasa por el mismo filtro que un ganador creado a
mano, así que un archivo editado no puede colar campos raros.

Al actualizar desde una versión anterior, los datos que ya hubiera sueltos en `data/`
pasan solos al servidor **Principal** de la primera cuenta que se registre; no hay que
hacer nada.

---

## Estructura

```
src/server.ts          API + servidor estático (el código real)
public/index.html      Toda la interfaz: HTML, CSS y JS en un archivo
public/assets/fondo.png Imagen de fondo
data/                  Datos persistidos (JSON)
dist/                  Salida de TypeScript (desactualizada)
scripts/check-js.js    Valida la sintaxis del JS embebido en index.html
```

Para comprobar que no rompiste el JavaScript del HTML:

```powershell
node scripts\check-js.js         # Windows
```

```bash
node scripts/check-js.js         # macOS / Linux
```

---

## Problemas frecuentes

**`Cannot PUT /api/exclusions` o `/api/tags`**
Está corriendo una versión antigua del servidor. Párala y vuelve a lanzar `npm run dev`.

**El fondo no se ve**
Comprueba que existe `public/assets/fondo.png` y recarga con **Ctrl + F5**. En las
DevTools (F12), pestaña *Network*, esa petición debe devolver 200.

**`EADDRINUSE: address already in use :::3000`**
Ya hay un servidor en ese puerto. Mátalo con los comandos de la sección *Pararlo*, o usa
otro puerto (`$env:PORT` en Windows, `PORT=` en macOS/Linux).

Para ver qué proceso lo ocupa:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen   # Windows
```

```bash
lsof -i :3000                                        # macOS / Linux
```

**Los cambios del HTML no aparecen**
Caché del navegador. **Ctrl + F5**.
