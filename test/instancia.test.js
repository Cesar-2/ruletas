// Un solo proceso al mando de los datos. Lo que se comprueba:
//
//  - El que arranca toma el mando y el viejo se entera.
//  - El viejo no se va mientras atiende a alguien; sin nadie, al rato se va.
//  - El que se va no vuelve a pedir el mando: no se echan el uno al otro.
//  - Si el que manda muere sin irse, el mando se libera.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { carpeta, cargar } = require('./ayuda');

function proceso(archivo, pid, estado) {
  // Cada «proceso» con su propia copia del modulo, como en dos procesos.
  const instancia = cargar('instancia');
  const p = instancia.iniciar({
    archivo, pid,
    ocupado: () => estado.ocupado,
    salir: () => { estado.salio = true; },
    latidoMs: 60000, caducaMs: 45000, ociosoMs: 60000
  });
  p.parar();   // el reloj se mueve a mano
  return p;
}

test('el nuevo toma el mando y el viejo se va cuando no atiende a nadie', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const archivo = path.join(c.raiz, 'instancia.json');
  const viejo = { ocupado: true, salio: false };
  const nuevo = { ocupado: false, salio: false };
  const a = proceso(archivo, 111, viejo);
  assert.strictEqual(a.manda(), true);
  const b = proceso(archivo, 222, nuevo);

  const t0 = Date.now();
  // Los dos a su ritmo: el nuevo late antes de que el viejo mire.
  const paso = (ms) => { b.repasar(t0 + ms); a.repasar(t0 + ms + 1); };
  paso(0);
  assert.strictEqual(a.manda(), false, 'el viejo sabe que lo han relevado');
  paso(120000);
  assert.strictEqual(viejo.salio, false, 'con gente conectada no se va');

  viejo.ocupado = false;
  paso(130000);
  paso(150000);
  assert.strictEqual(viejo.salio, false, 'espera un rato sin nadie');
  paso(191000);
  assert.strictEqual(viejo.salio, true);

  b.repasar(t0 + 200000);
  assert.strictEqual(b.manda(), true);
  assert.strictEqual(nuevo.salio, false, 'el nuevo sigue');
});

test('mientras el nuevo viva, el relevado no recupera el mando; si muere, si', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const archivo = path.join(c.raiz, 'instancia.json');
  const viejo = { ocupado: true, salio: false };
  const a = proceso(archivo, 111, viejo);
  const b = proceso(archivo, 222, { ocupado: false });
  const t0 = Date.now();
  for (let s = 0; s <= 600; s += 10) {
    b.repasar(t0 + s * 1000);
    a.repasar(t0 + s * 1000 + 1);
  }
  assert.strictEqual(a.manda(), false, 'no se echan el uno al otro');
  assert.strictEqual(b.manda(), true);

  // El nuevo muere sin irse: el viejo, que sigue atendiendo, vuelve al mando
  // en vez de irse y dejar el sitio sin nadie.
  a.repasar(t0 + 700000);
  assert.strictEqual(a.manda(), true);
  viejo.ocupado = false;
  a.repasar(t0 + 900000);
  assert.strictEqual(viejo.salio, false);
});

test('si el que manda muere sin irse, el mando queda libre', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const archivo = path.join(c.raiz, 'instancia.json');
  const muerto = proceso(archivo, 111, { ocupado: false });
  assert.strictEqual(muerto.manda(), true);
  // Un proceso que arrancó antes y no se habia enterado: ve el mando sin
  // latido y lo coge.
  const c2 = { ocupado: false, salio: false };
  const otro = cargar('instancia').iniciar({
    archivo, pid: 333, ocupado: () => false, salir: () => { c2.salio = true; }, latidoMs: 60000
  });
  otro.parar();
  otro.repasar(Date.now() + 60000);
  assert.strictEqual(otro.manda(), true);
});
