// Lo que todos los widgets hacen igual: leer la clave de la url, enterarse de
// los cambios, enseñarse solo cuando hay algo que enseñar y decir en pantalla
// si algo va mal.
//
// Antes preguntaba cada dos segundos. Ahora el servidor avisa por su canal y
// esto pide el estado cuando le toca, con un reloj lento de repuesto por si el
// canal se cae. Se nota en pantalla: lo que se apunta alguien en el chat sale
// al momento en vez de con hasta dos segundos de retraso. Ver eventos.js.
//
// Se sacó aquí al montar el segundo widget. Cada minijuego solo pone lo suyo:
// qué se ve y cómo se pinta.
//
// Los tres modos, que son los que decide la url:
//
//   (nada)      modo prueba: fondo oscuro, siempre a la vista y un cartel que
//               dice que está conectado. Es lo que sale al abrir la dirección
//               en el navegador, porque un widget transparente y vacío en una
//               pestaña parece que no ha cargado.
//   ?fondo=0    transparente y solo aparece cuando pasa algo. Así va en el
//               directo: no estorba cuando no se juega, y es la dirección que
//               copia el botón de Configuración.
//   ?siempre=1  transparente pero siempre puesto, para quien lo quiera fijo en
//               una esquina.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const clave = params.get('clave') || '';
  const prueba = params.get('fondo') !== '0';
  const siempre = prueba || params.get('siempre') === '1';
  // Con ?cada= se fuerza el reloj de antes, en milisegundos. No hace falta para
  // nada normal: está para poder descartar el canal si alguna vez da guerra en
  // una máquina concreta.
  const CADA = Number(params.get('cada')) || 0;

  function caja(id) { return document.getElementById(id); }

  // Cómo se ven los widgets, que lo elige el dueño en Configuración › Widgets:
  // de momento, cuánto tapa la caja oscura de detrás. Va a una variable de CSS
  // que leen todas las cajas (--fondo-widget, de 0 a 1), así que cada widget no
  // tiene que hacer nada. Se pide aquí y no en arranca() porque el del tablero
  // de clavijas no la usa.
  //
  // Si falla no se dice nada: el CSS lleva de respaldo el fondo de siempre, y
  // un widget con el fondo de siempre es mejor que un aviso encima del directo.
  const direccionCanal = '/api/widget/eventos?clave=' + encodeURIComponent(clave);
  async function mirarAjustes() {
    if (!clave) return;
    try {
      const res = await fetch('/api/widget/ajustes?clave=' + encodeURIComponent(clave), { cache: 'no-store' });
      if (!res.ok) return;
      const fondo = Number((await res.json()).fondo);
      if (!Number.isFinite(fondo)) return;
      document.documentElement.style.setProperty('--fondo-widget', String(Math.max(0, Math.min(100, fondo)) / 100));
    } catch (e) { /* se queda el de respaldo */ }
  }
  mirarAjustes();
  // Y si lo cambia con el widget ya puesto en OBS, llega sin recargar la fuente.
  if (clave && CADA) {
    setInterval(mirarAjustes, Math.max(500, CADA));
  } else if (clave && window.Eventos) {
    Eventos.usarDireccion(direccionCanal);
    Eventos.vigilar('widgets', mirarAjustes, true);
  }

  // Arranca un widget.
  //
  //   ruta    lo que va detrás de /api/widget/ (carrera, colina, ...)
  //   pinta   (estado) => true si hay algo que enseñar ahora mismo
  //   alFallar  opcional, para que el minijuego limpie lo suyo si se cae
  function arranca(opciones) {
    const { ruta, pinta } = opciones;
    const todo = caja('todo');
    const fallo = caja('fallo');
    const espera = caja('espera');
    if (prueba) document.body.classList.add('con-fondo');

    function decirFallo(texto) {
      if (!fallo) return;
      fallo.textContent = texto || '';
      fallo.hidden = !texto;
    }

    async function mirar() {
      if (!clave) { decirFallo('Falta la clave en la dirección del widget.'); return; }
      let estado;
      try {
        const res = await fetch('/api/widget/' + ruta + '?clave=' + encodeURIComponent(clave), { cache: 'no-store' });
        if (!res.ok) {
          decirFallo(res.status === 404
            ? 'Esa clave no vale. Cópiala otra vez desde Configuración.'
            : 'No se pudo leer el minijuego (' + res.status + ').');
          return;
        }
        estado = await res.json();
      } catch (e) {
        // Solo la petición va dentro del try: si se tragara también los fallos
        // de pintado, un error del widget se leería como «sin conexión» y no
        // habría por dónde cogerlo.
        decirFallo('Sin conexión con el Ruleton.');
        return;
      }
      decirFallo('');

      const hayAlgo = Boolean(pinta(estado));
      if (todo) todo.classList.toggle('visible', hayAlgo || siempre);
      if (espera) espera.hidden = !prueba || hayAlgo;
    }

    mirar();
    if (CADA) {
      // A mano: el reloj de antes y nada de canal.
      setInterval(mirar, Math.max(500, CADA));
    } else {
      Eventos.usarDireccion(direccionCanal);
      Eventos.vigilar(ruta, mirar, true);
    }
    return { mirar, decirFallo };
  }

  // La caja de «quién va apuntado», que es igual en casi todos. Se enseña en
  // cuanto la inscripción está abierta, AUNQUE no haya nadie todavía: es justo
  // entonces cuando hay que decirle al chat qué escribir. Antes solo aparecía
  // con alguien ya apuntado, y abrir la ronda y no ver nada parecía una avería.
  //
  //   ids     los elementos donde va cada cosa
  //   quienes los nombres ya apuntados
  //   palabra lo que hay que escribir en el chat
  //   cierraEn cuándo se cierra sola (0 = sin límite)
  function pintarApuntados(ids, quienes, palabra, cierraEn) {
    const nombres = quienes || [];
    caja(ids.cuantos).textContent = nombres.length;
    caja(ids.rotulo).textContent = nombres.length === 1 ? 'apuntado' : 'apuntados';

    // Sin nadie todavía, lo útil no es la lista vacía: es qué hay que escribir.
    const lista = caja(ids.quienes);
    if (!nombres.length) {
      lista.textContent = palabra
        ? 'Escribe ' + palabra + ' en el chat'
        : 'Escribe en el chat para apuntarte';
    } else {
      // Con mucha gente no caben todos: los últimos, que son los que acaban de
      // escribir, y se dice cuántos vienen detrás.
      const caben = nombres.slice(-12);
      const sobran = nombres.length - caben.length;
      lista.textContent = caben.join(' · ') + (sobran > 0 ? ' · y ' + sobran + ' más' : '');
    }

    const cuenta = caja(ids.cuenta);
    const quedan = cierraEn ? Math.max(0, Math.round((cierraEn - Date.now()) / 1000)) : 0;
    cuenta.hidden = !quedan;
    if (quedan) cuenta.textContent = 'cierra en ' + quedan + 's';
  }

  window.Widget = {
    pintarApuntados, arranca, clave, prueba, siempre, CADA, caja };
})();
