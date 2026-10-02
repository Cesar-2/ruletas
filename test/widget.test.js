// Las claves de los widgets.
//
// Esto guarda la unica cosa del proyecto que va escrita en una url que se pega
// en OBS y puede acabar enseñada en pantalla sin querer. Lo que tiene que
// cumplir siempre:
//
//  - Una clave por cuenta, la misma para sus cinco widgets.
//  - Al rotarla, la de antes deja de valer AL MOMENTO. Es justo lo que se
//    espera de rotar una clave que se ha visto en el directo; si la vieja
//    siguiera funcionando, rotar no serviria para nada.
//  - Una clave que no es de nadie no da acceso a nadie.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carpeta, cargar, sinRuido } = require('./ayuda');

function montar(raiz) {
  const archivo = path.join(raiz, 'widgets.json');
  const widget = cargar('widget');
  widget.iniciar({
    archivo: () => archivo,
    writeJson: (f, d) => {
      fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 2), 'utf8');
      fs.renameSync(f + '.tmp', f);
    }
  });
  return { widget, archivo };
}

test('la clave de una cuenta es siempre la misma', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { widget } = montar(c.raiz);

  const primera = widget.claveDe('u1');
  assert.ok(primera, 'se crea al pedirla');
  assert.strictEqual(widget.claveDe('u1'), primera, 'pedirla otra vez da la misma');
  assert.strictEqual(widget.uidDe(primera), 'u1');
});

test('cada cuenta tiene la suya', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { widget } = montar(c.raiz);

  const a = widget.claveDe('u1');
  const b = widget.claveDe('u2');
  assert.notStrictEqual(a, b);
  assert.strictEqual(widget.uidDe(a), 'u1');
  assert.strictEqual(widget.uidDe(b), 'u2');
});

test('al rotar, la clave de antes deja de valer al momento', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { widget } = montar(c.raiz);

  const vieja = widget.claveDe('u1');
  const nueva = widget.rotar('u1');

  assert.notStrictEqual(nueva, vieja);
  assert.strictEqual(widget.uidDe(nueva), 'u1');
  assert.strictEqual(widget.uidDe(vieja), '', 'la vieja ya no abre nada');
  assert.strictEqual(widget.claveDe('u1'), nueva, 'y la de la cuenta es la nueva');
});

test('rotar no toca las claves de otras cuentas', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { widget } = montar(c.raiz);

  const deU2 = widget.claveDe('u2');
  widget.claveDe('u1');
  widget.rotar('u1');
  assert.strictEqual(widget.uidDe(deU2), 'u2');
});

test('una clave que no es de nadie no abre nada', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { widget } = montar(c.raiz);
  widget.claveDe('u1');

  for (const mala of ['', '   ', 'inventada', null, undefined, 0, {}, [], true]) {
    assert.strictEqual(widget.uidDe(mala), '', 'no vale: ' + JSON.stringify(mala));
  }
});

test('rotar muchas veces no deja claves viejas valiendo', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { widget, archivo } = montar(c.raiz);

  const viejas = [widget.claveDe('u1')];
  for (let i = 0; i < 5; i++) viejas.push(widget.rotar('u1'));
  const buena = viejas.pop();

  for (const v of viejas) {
    assert.strictEqual(widget.uidDe(v), '', 'ninguna vieja vale');
  }
  assert.strictEqual(widget.uidDe(buena), 'u1');

  // Y no se quedan apuntadas: el archivo tiene una sola entrada.
  const guardado = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  assert.deepStrictEqual(Object.keys(guardado), [buena]);
});

test('un archivo de claves roto no da acceso a nadie', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const archivo = path.join(c.raiz, 'widgets.json');
  fs.writeFileSync(archivo, 'esto no es json');
  const { widget } = montar(c.raiz);

  let nueva;
  const quejas = sinRuido(() => {
    assert.strictEqual(widget.uidDe('loquesea'), '');
    // Y se puede seguir: pedir una clave la crea igual.
    nueva = widget.claveDe('u1');
  });
  assert.strictEqual(widget.uidDe(nueva), 'u1');
  assert.ok(quejas.some((q) => q.includes('Failed to read widget keys')),
    'y queda dicho en el registro');
});

// --- Cómo se ven: el fondo de las cajas ---------------------------------

function montarConAjustes(raiz) {
  const widget = cargar('widget');
  const escribir = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
  widget.iniciar({
    archivo: () => path.join(raiz, 'widgets.json'),
    writeJson: escribir,
    archivoAjustes: (uid) => path.join(raiz, uid, 'widgets.json'),
    ensureUserDir: (uid) => fs.mkdirSync(path.join(raiz, uid), { recursive: true })
  });
  return widget;
}

test('sin tocar nada, el fondo es el de siempre', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const widget = montarConAjustes(c.raiz);
  assert.strictEqual(widget.leerAjustes('u1').fondo, 82);
});

test('el fondo se guarda por cuenta y se queda entre 0 y 100', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const widget = montarConAjustes(c.raiz);

  assert.strictEqual(widget.guardarAjustes('u1', { fondo: 40 }).fondo, 40);
  assert.strictEqual(widget.leerAjustes('u1').fondo, 40, 'queda guardado');
  assert.strictEqual(widget.leerAjustes('u2').fondo, 82, 'y no toca a los demás');

  // El cero vale: es «sin caja», no «sin valor».
  assert.strictEqual(widget.guardarAjustes('u1', { fondo: 0 }).fondo, 0);
  assert.strictEqual(widget.leerAjustes('u1').fondo, 0);

  assert.strictEqual(widget.guardarAjustes('u1', { fondo: 300 }).fondo, 100);
  assert.strictEqual(widget.guardarAjustes('u1', { fondo: -5 }).fondo, 0);
  // Algo que no es un número deja lo que había.
  assert.strictEqual(widget.guardarAjustes('u1', { fondo: 55 }).fondo, 55);
  assert.strictEqual(widget.guardarAjustes('u1', { fondo: 'mucho' }).fondo, 55);
  assert.strictEqual(widget.guardarAjustes('u1', {}).fondo, 55);
});

test('las cajas de los widgets leen el fondo de la variable', () => {
  // Si alguien vuelve a escribir el 0.82 a mano en una caja, ese widget deja
  // de hacer caso al ajuste sin que nada falle.
  const leer = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  for (const p of ['css/widget.css', 'widget/batalla.html', 'widget/plinko.html', 'widget/colina.html']) {
    assert.ok(leer(p).includes('var(--fondo-widget'), p + ' usa la variable');
  }
  assert.ok(leer('js/widget-base.js').includes('--fondo-widget'), 'y widget-base.js la pone');
});

// --- Cómo se ven: el tamaño de todo ---------------------------------------

test('el tamaño se guarda por cuenta, entre la mitad y el doble', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const widget = montarConAjustes(c.raiz);

  assert.strictEqual(widget.leerAjustes('u1').tamano, 100, 'sin tocar nada, el de siempre');
  assert.strictEqual(widget.guardarAjustes('u1', { tamano: 150 }).tamano, 150);
  assert.strictEqual(widget.leerAjustes('u1').tamano, 150, 'queda guardado');
  assert.strictEqual(widget.leerAjustes('u2').tamano, 100, 'y no toca a los demás');

  // Ni tan pequeño que no se lea, ni tan grande que no quepa.
  assert.strictEqual(widget.guardarAjustes('u1', { tamano: 5 }).tamano, 50);
  assert.strictEqual(widget.guardarAjustes('u1', { tamano: 900 }).tamano, 200);
  // Y el cero no es «sin tamaño»: es demasiado pequeño, como cualquier otro.
  assert.strictEqual(widget.guardarAjustes('u1', { tamano: 0 }).tamano, 50);

  // Cambiar una cosa no se lleva la otra.
  widget.guardarAjustes('u1', { fondo: 30, tamano: 120 });
  assert.deepStrictEqual(widget.guardarAjustes('u1', { fondo: 60 }), { fondo: 60, tamano: 120 });
  assert.deepStrictEqual(widget.guardarAjustes('u1', { tamano: 80 }), { fondo: 60, tamano: 80 });
  assert.deepStrictEqual(widget.guardarAjustes('u1', { tamano: 'grande' }), { fondo: 60, tamano: 80 });
});

test('todos los widgets escalan con el tamaño', () => {
  // El tamaño va en una variable que escala #todo. El del tablero de clavijas
  // no usa widget.css, así que la lleva en su propia hoja.
  const leer = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  for (const p of ['css/widget.css', 'widget/plinko.html']) {
    assert.ok(leer(p).includes('scale(var(--tamano-widget, 1))'), p + ' escala con la variable');
  }
  assert.ok(leer('js/widget-base.js').includes('--tamano-widget'), 'y widget-base.js la pone');
  // Los que no son el del tablero tienen que cargar la hoja común.
  for (const w of ['batalla', 'carrera', 'colina', 'nombres', 'sorteo']) {
    assert.ok(leer('widget/' + w + '.html').includes('/css/widget.css'), w + ' carga widget.css');
  }
});
