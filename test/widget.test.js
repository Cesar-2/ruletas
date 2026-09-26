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
