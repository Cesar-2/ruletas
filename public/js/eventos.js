// Enterarse de los cambios sin ir preguntando.
//
// Antes cada panel hacía su setInterval de 2 segundos. La página abierta con
// tres widgets en OBS eran unas dos peticiones por segundo por cliente aunque
// no pasara nada, y cuando pasaba algo se tardaba hasta dos segundos en verlo.
//
// Ahora el servidor avisa por un solo canal (SSE) y el panel pide su estado
// cuando le toca. Un canal para toda la página, no uno por minijuego: son la
// misma cuenta y abrir cinco sería gastar cinco conexiones para lo mismo.
//
// Lo que llega por el canal es solo QUÉ minijuego cambió. El estado se pide con
// la misma petición de siempre, así que los paneles no cambian de cómo pintan.
//
// El reloj no se va del todo: se queda de red de seguridad.
//
//   - Mientras el canal va, se pregunta cada 30 s. Es por si un aviso se cae en
//     el camino, o si el servidor se reinició y el canal volvió sin que
//     nadie contara lo que pasó mientras estaba fuera.
//   - Si el canal no llega a abrirse (un proxy que se lo come, un navegador sin
//     EventSource), se vuelve a los 2 s de antes. Así el peor caso es lo que ya
//     había, no una pantalla que se queda congelada.

(function () {
  'use strict';

  // Lo de antes, para cuando no hay canal.
  const RAPIDO = 2000;
  // La red de seguridad cuando el canal funciona.
  const LENTO = 30000;

  // juego -> la función que pide su estado. Solo están los que se están
  // mirando ahora mismo: un panel cerrado no pregunta.
  const mirando = new Map();

  let fuente = null;
  // Si el canal ha llegado a decir «listo» alguna vez. Hasta entonces se
  // pregunta al ritmo de antes, que es lo seguro.
  let canalVa = false;
  let reloj = null;
  let ritmoPuesto = 0;

  // La dirección del canal. La página usa la suya y los widgets la de su clave.
  let direccion = '/api/eventos';

  function pedirTodos() {
    for (const cargar of Array.from(mirando.values())) {
      try { cargar(); } catch (e) { console.error('eventos: fallo al refrescar', e); }
    }
  }

  // Pone el reloj al ritmo que toque, o lo quita si no hay nada que mirar. Se
  // llama en cada cambio: es la única que toca el temporizador, para que no se
  // queden dos puestos a la vez.
  function acompasar() {
    const quiere = mirando.size ? (canalVa ? LENTO : RAPIDO) : 0;
    if (quiere === ritmoPuesto) return;
    if (reloj) { clearInterval(reloj); reloj = null; }
    ritmoPuesto = quiere;
    if (quiere) reloj = setInterval(pedirTodos, quiere);
  }

  function abrirCanal() {
    if (fuente || !window.EventSource) { acompasar(); return; }
    try {
      fuente = new EventSource(direccion);
    } catch (e) {
      // Sin canal se sigue con el reloj rápido: no es un fallo que haya que
      // contarle a nadie, solo una forma peor de hacer lo mismo.
      fuente = null;
      acompasar();
      return;
    }

    fuente.addEventListener('listo', () => {
      canalVa = true;
      acompasar();
      // Al (re)conectar se pide todo una vez: si el canal estuvo caído, lo que
      // pasó mientras tanto no lo contó nadie.
      pedirTodos();
    });

    fuente.addEventListener('cambio', (ev) => {
      let juego = '';
      try { juego = (JSON.parse(ev.data) || {}).juego || ''; } catch (e) { return; }
      const cargar = mirando.get(juego);
      if (cargar) {
        try { cargar(); } catch (e) { console.error('eventos: fallo al refrescar ' + juego, e); }
      }
    });

    fuente.addEventListener('error', () => {
      // EventSource reconecta solo mientras no esté cerrado del todo. Lo que
      // hay que hacer aquí es volver al reloj rápido hasta que vuelva a decir
      // «listo», que es lo que confirma que el canal está de verdad en pie.
      canalVa = false;
      acompasar();
      if (fuente && fuente.readyState === 2) {
        // Cerrado y no va a reintentar: se queda el reloj de antes.
        fuente = null;
      }
    });
  }

  // Empieza o deja de mirar un minijuego. Es el reemplazo exacto de los
  // setInterval que había: se llama igual, con true al abrir la inscripción y
  // con false al cerrarla.
  //
  //   juego   'carrera' | 'plinko' | 'batalla' | 'colina' | 'nombres'
  //   cargar  la función que pide el estado y repinta
  //   encender
  function vigilar(juego, cargar, encender) {
    if (encender) {
      mirando.set(juego, cargar);
      abrirCanal();
    } else {
      mirando.delete(juego);
    }
    acompasar();
  }

  // Los widgets tienen su propia dirección, con la clave dentro. Se llama antes
  // de mirar nada.
  function usarDireccion(url) {
    if (url === direccion) return;
    direccion = url;
    if (fuente) { try { fuente.close(); } catch (e) { /* ya estaba */ } }
    fuente = null;
    canalVa = false;
    if (mirando.size) abrirCanal();
    acompasar();
  }

  window.Eventos = { vigilar, usarDireccion, va: () => canalVa };
})();
