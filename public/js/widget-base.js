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
//               una esquina. Lo mismo se elige sin tocar la url, por widget, en
//               Configuración › Widgets (la casilla «Siempre a la vista»).

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const clave = params.get('clave') || '';
  const prueba = params.get('fondo') !== '0';
  const siempreUrl = prueba || params.get('siempre') === '1';
  // El de Configuración, que llega con los ajustes y puede cambiar con el
  // widget ya puesto.
  let siempreAjuste = false;
  function estaSiempre() { return siempreUrl || siempreAjuste; }
  // Los que tienen que volver a mirar si se enseñan cuando cambia eso.
  const alCambiar = [];
  function alCambiarSiempre(fn) { alCambiar.push(fn); }
  // Los widgets preguntan cada 2 s en vez de quedarse con el canal de avisos
  // abierto. Cada canal es una conexión que no se suelta nunca, y el proxy del
  // hosting tiene un cupo de conexiones por IP: la página y los widgets de OBS
  // salen de la misma, y con ocho canales abiertos las peticiones de la página
  // se quedaban en cola hasta el 504 sin llegar siquiera al servidor. Preguntar
  // tarda milisegundos y no se queda con nada.
  //
  // Con ?cada= se elige otro ritmo, en milisegundos; ?cada=0 vuelve al canal.
  const CADA = params.has('cada') ? (Number(params.get('cada')) || 0) : 2000;
  // Cómo se ven cambia poco: basta con mirarlo de vez en cuando.
  const CADA_AJUSTES = 10000;

  function caja(id) { return document.getElementById(id); }

  // Qué widget es este, por el nombre de su página (/widget/colina.html).
  const WIDGET = (/\/widget\/([a-z]+)\.html/.exec(location.pathname) || [])[1] || '';

  // Cómo se ven los widgets, que lo elige el dueño en Configuración › Widgets:
  // cuánto tapa la caja oscura de detrás y cómo de grande sale todo. Van a dos
  // variables de CSS: --fondo-widget (de 0 a 1), que leen todas las cajas, y
  // --tamano-widget (1 = como siempre), que escala #todo entero. Así cada widget
  // no tiene que hacer nada. Se pide aquí y no en arranca() porque el del
  // tablero de clavijas no la usa.
  //
  // Si falla no se dice nada: el CSS lleva de respaldo el fondo de siempre, y
  // un widget con el fondo de siempre es mejor que un aviso encima del directo.
  const direccionCanal = '/api/widget/eventos?clave=' + encodeURIComponent(clave);
  async function mirarAjustes() {
    if (!clave) return;
    try {
      const res = await fetch('/api/widget/ajustes?clave=' + encodeURIComponent(clave), { cache: 'no-store' });
      if (!res.ok) return;
      const ajustes = await res.json();
      const raiz = document.documentElement.style;
      // Este widget puede llevar su propio fondo (Configuración › Widgets): hay
      // algunos que necesitan más contraste que otros. Si no, el de todos.
      const propio = ajustes.fondos && ajustes.fondos[WIDGET];
      const fondo = Number(propio != null ? propio : ajustes.fondo);
      if (Number.isFinite(fondo)) raiz.setProperty('--fondo-widget', String(Math.max(0, Math.min(100, fondo)) / 100));
      const tamano = Number(ajustes.tamano);
      if (Number.isFinite(tamano) && tamano > 0) raiz.setProperty('--tamano-widget', String(Math.max(50, Math.min(200, tamano)) / 100));
      // Si este va siempre a la vista o se va cuando no pasa nada.
      const siempre = Array.isArray(ajustes.siempre) && ajustes.siempre.includes(WIDGET);
      if (siempre !== siempreAjuste) {
        siempreAjuste = siempre;
        alCambiar.forEach((fn) => fn());
      }
    } catch (e) { /* se queda el de respaldo */ }
  }
  mirarAjustes();
  // Y si lo cambia con el widget ya puesto en OBS, llega sin recargar la fuente.
  if (clave && CADA) {
    setInterval(mirarAjustes, Math.max(CADA, CADA_AJUSTES));
  } else if (clave && window.Eventos) {
    Eventos.usarDireccion(direccionCanal);
    Eventos.vigilar('widgets', mirarAjustes, true);
  }

  // Cuánto se queda puesto un widget sin que pase nada. Un resultado que ya
  // nadie mira no tiene por qué tapar el directo: al minuto se va, y vuelve en
  // cuanto cambia algo. No vale en modo prueba ni con ?siempre=1 o la casilla
  // de Configuración.
  const QUIETO_MS = 60000;

  // Lleva la cuenta de cuándo cambió el estado por última vez.
  //
  //   alVencer  se llama cuando se cumple el minuto, para esconderlo sin
  //             esperar a la siguiente petición
  //
  // «Cambiar» es que el estado sea otro, sin contar «ahora», que es la hora del
  // servidor y cambia en cada petición. Lo que está contando en pantalla (una
  // inscripción que cierra sola, un combate, una carrera larga) no se corta a
  // medias: el minuto empieza cuando acaba.
  function vigiaQuieto(alVencer) {
    let huella = null;
    let hasta = 0;
    let reloj = null;
    function mirar(estado) {
      const ahora = Date.now();
      const h = JSON.stringify(estado, (k, v) => (k === 'ahora' ? undefined : v));
      if (h !== huella) { huella = h; hasta = ahora + QUIETO_MS; }
      // Las horas vienen del reloj del servidor: se pasan al de aquí.
      const desfase = estado && Number(estado.ahora) ? ahora - Number(estado.ahora) : 0;
      const fines = [];
      if (estado) {
        fines.push(Number(estado.cierraEn) || 0, Number(estado.combateHasta) || 0);
        if (estado.corridaEn && estado.duracion) fines.push(Number(estado.corridaEn) + Number(estado.duracion) * 1000);
      }
      for (const fin of fines) if (fin) hasta = Math.max(hasta, fin + desfase + QUIETO_MS);
      if (reloj) clearTimeout(reloj);
      reloj = hasta > ahora ? setTimeout(alVencer, hasta - ahora + 50) : null;
      return vivo();
    }
    function vivo() { return Date.now() < hasta; }
    return { mirar, vivo };
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

      desfase = estado && Number(estado.ahora) ? Date.now() - Number(estado.ahora) : 0;
      hayAlgo = Boolean(pinta(estado));
      quieto.mirar(estado);
      ensenar();
    }

    let hayAlgo = false;
    function ensenar() {
      if (todo) todo.classList.toggle('visible', (hayAlgo && quieto.vivo()) || estaSiempre());
      if (espera) espera.hidden = !prueba || hayAlgo;
    }
    const quieto = vigiaQuieto(ensenar);
    alCambiarSiempre(ensenar);

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
  //   recompensa la recompensa de puntos del canal con la que se entra, si
  //           se entra así en vez de escribiendo
  function pintarApuntados(ids, quienes, palabra, cierraEn, recompensa) {
    const nombres = quienes || [];
    caja(ids.cuantos).textContent = nombres.length;
    caja(ids.rotulo).textContent = nombres.length === 1 ? 'apuntado' : 'apuntados';

    // Sin nadie todavía, lo útil no es la lista vacía: es qué hay que escribir.
    const lista = caja(ids.quienes);
    if (!nombres.length) {
      lista.textContent = recompensa
        ? 'Canjea «' + recompensa + '» con puntos del canal'
        : palabra
        ? 'Escribe ' + palabra + ' en el chat'
        : 'Escribe en el chat para apuntarte';
    } else {
      // Con mucha gente no caben todos: los últimos, que son los que acaban de
      // escribir, y se dice cuántos vienen detrás.
      const caben = nombres.slice(-12);
      const sobran = nombres.length - caben.length;
      lista.textContent = caben.join(' · ') + (sobran > 0 ? ' · y ' + sobran + ' más' : '');
    }

    pintarCuenta(caja(ids.cuenta), cierraEn);
  }

  // Lo que va el reloj de este PC por delante del servidor, del último estado
  // leído. Las horas de cierre son del servidor: sin esto, un PC con la hora
  // mal contaría segundos de más o de menos.
  let desfase = 0;

  // El «cierra en …» de la inscripción, contando solo segundo a segundo. Antes
  // solo cambiaba al llegar un estado nuevo, así que sin nadie apuntándose se
  // quedaba parado en el mismo número. Se esconde al llegar a cero.
  //
  //   el       donde va la cuenta
  //   cierraEn cuándo se cierra, en el reloj del servidor (0 = sin límite)
  const cuentas = new WeakMap();
  function pintarCuenta(el, cierraEn) {
    if (!el) return;
    clearInterval(cuentas.get(el));
    cuentas.delete(el);
    const fin = Number(cierraEn) || 0;
    function latido() {
      const quedan = fin ? Math.max(0, Math.ceil((fin + desfase - Date.now()) / 1000)) : 0;
      el.hidden = !quedan;
      if (quedan) {
        const m = Math.floor(quedan / 60);
        const s = quedan % 60;
        el.textContent = 'cierra en ' + (m ? m + ':' + String(s).padStart(2, '0') : s + 's');
      } else {
        clearInterval(cuentas.get(el));
        cuentas.delete(el);
      }
      return quedan;
    }
    // Cada cuarto de segundo, para no saltarse números con el reloj a destiempo.
    if (latido()) cuentas.set(el, setInterval(latido, 250));
  }

  window.Widget = {
    pintarApuntados, pintarCuenta, arranca, vigiaQuieto, clave, prueba, estaSiempre, alCambiarSiempre, CADA, caja };
})();
