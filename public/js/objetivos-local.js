// Los objetivos en el navegador: el orden que se está haciendo y la fila de
// lo que va al servidor.
//
// Antes cada ▲, ▼ o arrastre mandaba su petición en el momento, sin esperar a
// la anterior. Ordenar una lista eran decenas de peticiones a la vez, y eso:
//
//  - llenaba las seis conexiones que el navegador abre con un mismo sitio (una
//    ya es el canal de avisos), y todo lo demás de la página se quedaba
//    esperando: parecía que no funcionaba nada;
//  - repintaba la lista con cada respuesta, que llegaban en cualquier orden;
//  - y en el servidor, cada una lee y escribe el archivo bloqueando a todas
//    las cuentas mientras tanto.
//
// Ahora ordenar no sale del navegador: se va apuntando en un borrador (en
// localStorage, que sobrevive a recargar o cerrar la pestaña) y el botón
// «Guardar» manda el orden final en una sola petición.
//
// Marcar hecho, poner en proceso, escribir, añadir y quitar siguen yendo al
// momento, porque eso se ve en directo en el widget de OBS. Esos van en fila:
// uno a la vez, y se pinta la respuesta cuando ya no queda ninguno.
//
// El borrador es solo la forma, [{ id, subs: [...] }]. El texto y lo marcado
// salen siempre de lo que dijo el servidor, que puede cambiar mientras se
// ordena; al pintar se le pone encima esa forma.
//
// Sin DOM a propósito: así los tests cargan este archivo tal cual.

(function () {
  'use strict';

  // --- La fila -------------------------------------------------------------

  //   enviar(ruta, cuerpo)  la petición; devuelve la lista entera que quedó
  //   alTerminar(lista)     ya no queda nada: lo que dijo el último
  //   alFallar(error)       una falló; lo demás sigue
  function crearCola({ enviar, alTerminar, alFallar }) {
    const espera = [];
    let enviando = false;
    let ultima = null;

    function poner(ruta, cuerpo) {
      return new Promise((resolver) => {
        espera.push({ ruta, cuerpo, resolver });
        siguiente();
      });
    }

    async function siguiente() {
      if (enviando) return;
      const op = espera.shift();
      if (!op) {
        if (ultima) { const l = ultima; ultima = null; alTerminar(l); }
        return;
      }
      enviando = true;
      let ok = true;
      try {
        ultima = await enviar(op.ruta, op.cuerpo);
      } catch (err) {
        ok = false;
        try { alFallar(err); } catch (e) { /* que no pare la fila */ }
      }
      enviando = false;
      op.resolver(ok);
      siguiente();
    }

    return {
      poner,
      // Hay algo mandándose o esperando: lo que se pinte ahora se quedará viejo.
      ocupada: () => enviando || espera.length > 0
    };
  }

  // --- El borrador del orden ------------------------------------------------

  // La forma de una lista: solo los ids, con lo de dentro.
  function forma(nodos) {
    return (nodos || []).map((n) => ({ id: n.id, subs: forma(n.subs) }));
  }

  function mismaForma(a, b) {
    return JSON.stringify(forma(a)) === JSON.stringify(forma(b));
  }

  // La lista del servidor colocada como dice el borrador. Lo mismo que hace
  // el servidor al guardar (ordenar() en src/objetivos.ts), para que lo que
  // se ve sea lo que va a quedar:
  //
  //  - lo que ya no existe se ignora;
  //  - lo que no está en el borrador (se añadió después) se queda en su
  //    carpeta, al final, o en la lista principal si su carpeta no está;
  //  - lo que sale de la lista principal deja de estar en proceso.
  //
  // Devuelve copias: lo que dijo el servidor no se toca.
  function aplicarOrden(lista, orden) {
    const nodos = new Map();
    const padreDe = new Map();
    const enOrden = [];
    (function apuntar(subs, padre) {
      (subs || []).forEach((s) => {
        nodos.set(s.id, { ...s, subs: [] });
        padreDe.set(s.id, padre);
        enOrden.push(s.id);
        apuntar(s.subs, s.id);
      });
    })(lista, '');

    const puestos = new Set();
    function colocar(crudo) {
      const subs = [];
      (Array.isArray(crudo) ? crudo : []).forEach((c) => {
        const s = nodos.get(c && c.id);
        if (!s || puestos.has(s.id)) return;
        puestos.add(s.id);
        s.subs = colocar(c.subs);
        subs.push(s);
      });
      return subs;
    }
    const raiz = colocar(orden);
    enOrden.forEach((id) => {
      if (puestos.has(id)) return;
      puestos.add(id);
      const padre = nodos.get(padreDe.get(id));
      if (padre && puestos.has(padre.id)) padre.subs.push(nodos.get(id)); else raiz.push(nodos.get(id));
    });

    const enRaiz = new Set(raiz.map((s) => s.id));
    nodos.forEach((s) => {
      if (enRaiz.has(s.id)) s.proceso = Boolean(s.proceso) && !s.hecho;
      else delete s.proceso;
    });
    return raiz;
  }

  // Los hermanos de uno (la lista en la que está) y dónde está entre ellos.
  function buscar(nodos, id) {
    for (let i = 0; i < nodos.length; i++) {
      if (nodos[i].id === id) return { hermanos: nodos, i };
      const dentro = buscar(nodos[i].subs, id);
      if (dentro) return dentro;
    }
    return null;
  }

  function contiene(nodo, id) {
    return nodo.subs.some((s) => s.id === id || contiene(s, id));
  }

  // Sube (-1) o baja (+1) uno entre sus hermanos, en el borrador. false si no
  // estaba o ya estaba en el borde.
  function subirBajar(orden, id, hacia) {
    const b = buscar(orden, id);
    if (!b) return false;
    const j = b.i + (hacia < 0 ? -1 : 1);
    if (j < 0 || j >= b.hermanos.length) return false;
    [b.hermanos[b.i], b.hermanos[j]] = [b.hermanos[j], b.hermanos[b.i]];
    return true;
  }

  // Lo lleva a otro sitio del borrador, como moverA() del servidor: `dentro`
  // de `destino` (al final), `antes` o `despues` de él, o con destino vacío al
  // final de la lista principal. false si no se puede (dentro de sí mismo).
  function llevar(orden, id, destino, como) {
    const b = buscar(orden, id);
    if (!b || id === destino) return false;
    const nodo = b.hermanos[b.i];
    if (destino && contiene(nodo, destino)) return false;
    if (destino && !buscar(orden, destino)) return false;
    b.hermanos.splice(b.i, 1);
    if (!destino) { orden.push(nodo); return true; }
    const d = buscar(orden, destino);
    if (como === 'antes' || como === 'despues') d.hermanos.splice(d.i + (como === 'despues' ? 1 : 0), 0, nodo);
    else d.hermanos[d.i].subs.push(nodo);
    return true;
  }

  // --- Adelantarse al servidor ----------------------------------------------
  // Marcar, poner en proceso, corregir el texto o quitar se ven al pulsar, sin
  // esperar la vuelta del servidor (que en producción, detrás del proxy, se
  // nota en cada clic). Solo se adelanta lo inmediato; lo que el servidor
  // decide además (pasar al siguiente en proceso, dar por hecha la carpeta
  // cuando lo está todo lo de dentro) llega con su respuesta, que es la que
  // manda al final.
  //
  // Devuelve la lista nueva, o null si esa petición no se adelanta.
  function adelantar(lista, ruta, cuerpo) {
    const c = cuerpo || {};
    const copia = JSON.parse(JSON.stringify(lista || []));
    const b = buscar(copia, String(c.id || ''));
    if (!b) return null;
    const s = b.hermanos[b.i];
    const principal = b.hermanos === copia;
    if (ruta === '/api/objetivos/quitar') {
      b.hermanos.splice(b.i, 1);
      return copia;
    }
    if (ruta !== '/api/objetivos/cambiar') return null;
    if (typeof c.texto === 'string' && c.texto.trim()) s.texto = c.texto.trim();
    if (c.proceso !== undefined && principal) {
      s.proceso = Boolean(c.proceso);
      if (s.proceso) s.hecho = false;
    }
    if (c.hecho !== undefined) {
      s.hecho = Boolean(c.hecho);
      if (s.hecho) {
        if (principal) s.proceso = false;
        (function todo(subs) { (subs || []).forEach((x) => { x.hecho = true; todo(x.subs); }); })(s.subs);
      }
    }
    return copia;
  }

  globalThis.ObjetivosLocal = { crearCola, forma, mismaForma, aplicarOrden, subirBajar, llevar, adelantar };
})();
