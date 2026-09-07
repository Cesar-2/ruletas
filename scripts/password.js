#!/usr/bin/env node
// Rescate de contrasenas desde la consola, para cuando no se puede entrar a la
// web: la cuenta de administrador perdida, o la unica que hay.
//
//   npm run password -- <usuario>            pone una temporal y la enseña
//   npm run password -- <usuario> <nueva>    pone la que le digas
//   npm run password -- --listar             enseña las cuentas que hay
//
// Se ejecuta donde vivan los datos, asi que respeta RULETON_DATA igual que el
// servidor. En un hosting: entra por SSH y lanzalo desde la carpeta de la app.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.RULETON_DATA
  ? path.resolve(process.env.RULETON_DATA)
  : path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function salir(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

function generarPassword() {
  const abc = '23456789BCDFGHJKMNPQRSTVWXYZ';
  const azar = crypto.randomBytes(16);
  const l = Array.from(azar, (n) => abc[n % abc.length]);
  return `${l.slice(0,4).join('')}-${l.slice(4,8).join('')}-${l.slice(8,12).join('')}-${l.slice(12,16).join('')}`;
}

if (!fs.existsSync(USERS_FILE)) {
  salir(`No encuentro ${USERS_FILE}\nSi los datos estan en otro sitio, pon RULETON_DATA apuntando ahi.`);
}

const doc = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const users = Array.isArray(doc.users) ? doc.users : [];

const [quien, nueva] = process.argv.slice(2);

if (!quien || quien === '--listar' || quien === '-l') {
  console.log(`Datos en: ${DATA_DIR}`);
  console.log(`Cuentas (${users.length}):`);
  for (const u of users) {
    const marcas = [u.admin ? 'admin' : '', u.bloqueado ? 'sin acceso' : ''].filter(Boolean);
    console.log(`  ${u.username}${marcas.length ? '  [' + marcas.join(', ') + ']' : ''}`);
  }
  if (!quien) console.log('\nUso: npm run password -- <usuario> [contrasena nueva]');
  process.exit(0);
}

const user = users.find((u) => u.username === String(quien).toLowerCase());
if (!user) salir(`No existe la cuenta "${quien}". Con --listar las ves todas.`);

const password = nueva || generarPassword();
if (password.length < 8) salir('La contrasena necesita al menos 8 caracteres.');

user.salt = crypto.randomBytes(16).toString('hex');
user.hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
// Recuperar el acceso no sirve de nada si la cuenta sigue bloqueada.
user.bloqueado = false;

const tmp = `${USERS_FILE}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
fs.renameSync(tmp, USERS_FILE);

// Cambiar la contrasena cierra las sesiones abiertas de esa cuenta.
let sesiones = {};
try { sesiones = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (e) { /* aun no hay */ }
let tiradas = 0;
for (const [t, s] of Object.entries(sesiones)) {
  if (s && s.uid === user.id) { delete sesiones[t]; tiradas += 1; }
}
try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sesiones, null, 2), 'utf8'); } catch (e) { /* sin sesiones */ }

console.log(`Cuenta:      ${user.username}`);
console.log(`Contrasena:  ${password}`);
if (tiradas) console.log(`Sesiones cerradas: ${tiradas}`);
console.log('\nEntra con ella y cambiala en Configuracion > Mi cuenta.');
