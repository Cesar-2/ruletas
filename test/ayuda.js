// Lo que necesitan todos los tests: una carpeta de datos de usar y tirar, y las
// dependencias que los minijuegos esperan.
//
// Los tests NO tocan data/. Cada uno se hace su carpeta en el temporal del
// sistema y la borra al acabar: los datos de la instalacion son del equipo y no
// tienen por que aparecer en una prueba.
//
// Se prueba lo compilado (dist/), no el TypeScript: es lo que de verdad se
// ejecuta en produccion, y asi el test tambien avisa si la compilacion se
// quedo a medias. De ahi que `npm test` compile primero.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

// Una carpeta nueva para un test. `quitar()` la borra entera.
function carpeta() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleton-test-'));
  return {
    raiz,
    quitar: () => { try { fs.rmSync(raiz, { recursive: true, force: true }); } catch (e) { /* da igual */ } }
  };
}

// Las dependencias de los minijuegos, apuntando a esa carpeta.
//
//   alCambiar  se apunta en `avisados` cada vez que algo cambia, para poder
//              comprobar que el minijuego avisa cuando debe
function deps(raiz, avisados) {
  return {
    userDir: (uid) => path.join(raiz, uid),
    ensureUserDir: (uid) => fs.mkdirSync(path.join(raiz, uid), { recursive: true }),
    writeJson: (f, d) => {
      fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 2), 'utf8');
      fs.renameSync(f + '.tmp', f);
    },
    sumarPuntos: () => 0,
    alCambiar: (uid) => { if (avisados) avisados.push(uid); }
  };
}

// Carga un modulo de dist recien, sin lo que tuviera en memoria de otro test.
// Es lo que hace de «reinicio del servidor»: los minijuegos guardan la partida
// en un Map del modulo, asi que volver a cargarlo es empezar de cero.
function cargar(nombre, d) {
  const f = path.join(DIST, nombre + '.js');
  delete require.cache[require.resolve(f)];
  const m = require(f);
  if (d && m.iniciar) m.iniciar(d);
  return m;
}

// Los cinco minijuegos de una vez, que casi siempre se necesitan juntos: la
// colina le pide las clases a la batalla, asi que cargarla sola no vale.
function minijuegos(raiz, avisados) {
  const d = deps(raiz, avisados);
  return {
    carrera: cargar('carrera', d),
    batalla: cargar('batalla', d),
    colina: cargar('colina', d),
    plinko: cargar('plinko', d),
    nombres: cargar('ruletachat', d)
  };
}

// Se traga los console.error de dentro. Es para los tests que rompen un
// archivo a proposito: el codigo hace bien en quejarse, pero si la queja sale
// por pantalla, una tirada que ha ido bien parece que ha ido mal, y entonces
// nadie mira los errores de verdad.
//
// Devuelve lo que se haya quejado, para poder comprobar que se quejo.
function sinRuido(fn) {
  const antes = console.error;
  const dichos = [];
  console.error = (...args) => dichos.push(args.map(String).join(' '));
  try {
    fn();
  } finally {
    console.error = antes;
  }
  return dichos;
}

module.exports = { carpeta, deps, cargar, minijuegos, sinRuido, DIST };
