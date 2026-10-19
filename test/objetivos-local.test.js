// Los objetivos en el navegador: el borrador del orden y la fila de lo que va
// al servidor. Ver public/js/objetivos-local.js.
//
// Lo que tiene que cumplirse:
//
//  - Al servidor va una sola peticion a la vez, por muchos clics que haya.
//  - Lo que se ve con el borrador es lo que quedara al guardar: lo mismo que
//    hace ordenar() en el servidor.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

require(path.join(__dirname, '..', 'public', 'js', 'objetivos-local.js'));
const OL = globalThis.ObjetivosLocal;

const n = (id, subs = [], extra = {}) => ({ id, texto: id, hecho: false, subs, ...extra });
const pinta = (subs) => subs.map((s) => s.id + (s.proceso ? '▶' : '') + (s.subs.length ? '(' + pinta(s.subs) + ')' : '')).join(' ');

test('la fila manda de una en una y pinta solo al final', async () => {
  let a_la_vez = 0, maximo = 0, enviadas = 0;
  const pintadas = [];
  const cola = OL.crearCola({
    enviar: async (ruta) => {
      a_la_vez++; maximo = Math.max(maximo, a_la_vez); enviadas++;
      await new Promise((r) => setTimeout(r, 2));
      a_la_vez--;
      return { ruta };
    },
    alTerminar: (l) => pintadas.push(l.ruta),
    alFallar: () => assert.fail('no deberia fallar')
  });
  const hechas = [];
  for (let i = 0; i < 10; i++) hechas.push(cola.poner('/r' + i, {}));
  assert.strictEqual(cola.ocupada(), true);
  assert.deepStrictEqual(await Promise.all(hechas), Array(10).fill(true));
  assert.strictEqual(maximo, 1, 'nunca dos a la vez');
  assert.strictEqual(enviadas, 10);
  assert.deepStrictEqual(pintadas, ['/r9'], 'se pinta una vez, con la ultima');
  assert.strictEqual(cola.ocupada(), false);
});

test('si una falla se avisa y la fila sigue', async () => {
  const fallos = [];
  const cola = OL.crearCola({
    enviar: async (ruta) => { if (ruta === '/mal') throw new Error('no'); return { ruta }; },
    alTerminar: () => {},
    alFallar: (e) => fallos.push(e.message)
  });
  const r = await Promise.all([cola.poner('/bien'), cola.poner('/mal'), cola.poner('/otra')]);
  assert.deepStrictEqual(r, [true, false, true]);
  assert.deepStrictEqual(fallos, ['no']);
});

test('subir, bajar y llevar cambian solo el borrador', () => {
  const lista = [n('a', [n('x')]), n('b'), n('c')];
  const orden = OL.forma(lista);
  assert.ok(OL.subirBajar(orden, 'c', -1));
  assert.ok(OL.subirBajar(orden, 'c', -1));
  assert.strictEqual(OL.subirBajar(orden, 'c', -1), false, 'en el borde no hace nada');
  assert.strictEqual(pinta(OL.aplicarOrden(lista, orden)), 'c a(x) b');
  assert.strictEqual(pinta(lista), 'a(x) b c', 'lo del servidor no se toca');

  assert.ok(OL.llevar(orden, 'b', 'x', 'antes'));
  assert.strictEqual(pinta(OL.aplicarOrden(lista, orden)), 'c a(b x)');
  assert.strictEqual(OL.llevar(orden, 'a', 'x', 'dentro'), false, 'no dentro de lo suyo');
  assert.ok(OL.llevar(orden, 'x', '', 'dentro'));
  assert.strictEqual(pinta(OL.aplicarOrden(lista, orden)), 'c a(b) x');
});

test('el borrador sobre una lista que cambio entre medias', () => {
  const orden = [{ id: 'b', subs: [] }, { id: 'quitado', subs: [] }, { id: 'a', subs: [{ id: 'c', subs: [] }] }];
  // Despues de hacer el borrador se añadio «nuevo» y «y» dentro de a, y c
  // estaba en proceso.
  const lista = [n('a', [n('y')]), n('b'), n('c', [], { proceso: true }), n('nuevo')];
  assert.strictEqual(pinta(OL.aplicarOrden(lista, orden)), 'b a(c y) nuevo',
    'lo nuevo en su carpeta o al final, lo quitado fuera, y dentro de otro ya no esta en proceso');
  assert.ok(OL.mismaForma(OL.aplicarOrden(lista, OL.forma(lista)), lista), 'sin cambios es la misma forma');
});
