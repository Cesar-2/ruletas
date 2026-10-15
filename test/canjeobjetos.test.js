// La Ruleta de objetos pagando con los puntos de la pagina (canjeobjetos.ts).
//
// Lo que se comprueba:
//  - Apagado (coste 0) no cobra ni sortea.
//  - Con puntos de sobra se cobra y se sortea.
//  - Sin bastantes, ni se cobra ni se sortea.
//  - Si el sorteo falla, se devuelve lo pagado.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

function montar(raiz, saldo, sorteoFalla) {
  const d = deps(raiz);
  const monedero = { ana: saldo };
  const sorteados = [];
  d.canalDe = () => '';
  d.gastarPuntos = (uid, n, c) => {
    const k = n.toLowerCase();
    if (c <= 0 || (monedero[k] || 0) < c) return false;
    monedero[k] -= c;
    return true;
  };
  d.sumarPuntos = (uid, n, c) => (monedero[n.toLowerCase()] = (monedero[n.toLowerCase()] || 0) + c);
  d.sortear = async (uid, n) => {
    if (sorteoFalla) throw new Error('no quedan objetos');
    sorteados.push(n);
    return ['Gelano'];
  };
  const m = cargar('canjeobjetos');
  m.iniciar(d);
  return { m, monedero, sorteados };
}

test('apagado no cobra ni sortea', async () => {
  const c = carpeta();
  try {
    const { m, monedero, sorteados } = montar(c.raiz, 100);
    assert.strictEqual(await m.alEscribir('u1', 'Ana'), false);
    assert.strictEqual(monedero.ana, 100);
    assert.deepStrictEqual(sorteados, []);
  } finally { c.quitar(); }
});

test('con puntos de sobra se cobra y se sortea', async () => {
  const c = carpeta();
  try {
    const { m, monedero, sorteados } = montar(c.raiz, 100);
    m.guardarAjustes('u1', { coste: 30, palabra: '!objeto ignorado' });
    assert.strictEqual(m.leerAjustes('u1').palabra, '!objeto');
    assert.strictEqual(await m.alEscribir('u1', 'Ana'), true);
    assert.strictEqual(monedero.ana, 70);
    assert.deepStrictEqual(sorteados, ['Ana']);
  } finally { c.quitar(); }
});

test('sin bastantes puntos no se cobra ni se sortea', async () => {
  const c = carpeta();
  try {
    const { m, monedero, sorteados } = montar(c.raiz, 10);
    m.guardarAjustes('u1', { coste: 30 });
    assert.strictEqual(await m.alEscribir('u1', 'Ana'), false);
    assert.strictEqual(monedero.ana, 10);
    assert.deepStrictEqual(sorteados, []);
  } finally { c.quitar(); }
});

test('si el sorteo falla se devuelve lo pagado', async () => {
  const c = carpeta();
  try {
    const { m, monedero } = montar(c.raiz, 50, true);
    m.guardarAjustes('u1', { coste: 30 });
    assert.strictEqual(await m.alEscribir('u1', 'Ana'), false);
    assert.strictEqual(monedero.ana, 50);
  } finally { c.quitar(); }
});
