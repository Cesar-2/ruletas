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
| `GET` | `/api/items` | Catálogo completo de recursos |
| `GET` | `/api/random-items?n=3` | Sortea `n` objetos, omitiendo los excluidos |
| `GET` | `/api/exclusions` | Lista de IDs excluidos del sorteo |
| `PUT` | `/api/exclusions` | Guarda la lista. Body: `{ "ids": ["123"] }` |
| `GET` | `/api/tags` | Colores asignados por objeto |
| `PUT` | `/api/tags` | Guarda los colores. Body: `{ "tags": { "123": "gold" } }` |
| `POST` | `/api/draw` | Sorteo entre participantes (sin uso en la UI actual) |

Los únicos valores válidos en `tags` son `gold` y `silver`; el resto se descarta al guardar.

---

## Datos

Todo se guarda como JSON plano en `data/`, que se crea al arrancar si no existe:

| Archivo | Contenido |
|---|---|
| `items.json` | Caché del catálogo descargado de la API de Dofus |
| `exclusions.json` | IDs excluidos del sorteo |
| `tags.json` | Objetos marcados como dorado o plateado |

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

**Las exclusiones y los colores son globales**, no por usuario: cualquiera que abra la
página ve y modifica los mismos datos.

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
