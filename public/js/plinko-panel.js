// El panel del tablero de clavijas: abrir la ronda, tirar y contar lo que cayo.
// El dibujo del tablero es aparte, en plinko-tablero.js.
//
// Salio de index.html, que se habia puesto en casi once mil lineas. Se movio
// tal cual, sin tocar la sangria: dentro hay plantillas de varias lineas y
// quitarles los cuatro espacios cambiaria lo que generan. Sigue siendo un
// script normal, sin modulo: comparte el ambito global con el resto, y por eso
// el orden en el que index.html lo carga importa.

    // --- Tablero de clavijas ----------------------------------------------
    // Aquí no se decide nada: el servidor simula la caída de cada bola con su
    // física (gravedad, choques y rebotes) y manda el recorrido punto por
    // punto. Esto solo lo dibuja. La casilla en la que acaba es la que salió
    // de la simulación, no una elegida antes de tirar.

    let plinko = { abierta: false, jugadores: [], tiradas: [], tablero: null, multiplicadores: [] };
    let plinkoCayendo = false;    // mientras se está viendo caer las bolas
    let plinkoAnimacion = null;   // el requestAnimationFrame en curso
    // Lo que se está dibujando ahora mismo: bolas a medio caer y casillas que
    // acaban de recibir una.
    let plinkoBolas = [];
    let plinkoCasillasVivas = new Map();
    // Las clavijas encendidas: cuál se ha golpeado y cuándo, para apagarlas
    // solas. La clavija es su sitio en la lista, el mismo que usa el servidor.
    let plinkoClavijasVivas = new Map();
    // Cuántas posiciones de atrás se pintan como estela de la bola.
    // Los tres viven en js/plinko-tablero.js, con el dibujo: los comparte el
    // widget de OBS y tener dos listas de colores acabaría con dos tableros
    // distintos.
    const ESTELA_BOLA = PlinkoTablero.ESTELA;
    const COLORES_PLINKO = PlinkoTablero.COLORES;
    const RETRASO_BOLA = PlinkoTablero.RETRASO_BOLA;

    // La palabra guardada, que es la que escucha el servidor. Se ajusta en
    // Configuración, así que lo que haya en el campo sin guardar no cuenta.
    function palabraPlinko() {
      return (plinko.ajustes && plinko.ajustes.palabra) || '!bola';
    }

    async function cargarPlinko() {
      try {
        plinko = await api('/api/plinko');
      } catch (e) {
        console.warn('No se pudo leer el tablero:', e.message);
        return;
      }
      if (plinko.ajustes) {
        ponerSiNoLoTocas('plinkoPalabra', plinko.ajustes.palabra);
        ponerSiNoLoTocas('plinkoPuntos', plinko.ajustes.puntos);
        ponerSiNoLoTocas('plinkoFilas', plinko.ajustes.filas);
      }
      pintarPlinko();
    }

    function plinkoVigilar(encender) {
      // El servidor avisa por su canal y aquí solo se pide el estado. Queda un
      // reloj de repuesto por dentro, muy lento, por si el canal se cae.
      // Ver eventos.js.
      Eventos.vigilar('plinko', cargarPlinko, encender);
    }

    function pintarPlinko() {
      const cuantos = plinko.jugadores.length;
      const estado = document.getElementById('plinkoEstado');
      avisarChat('plinkoEstado', plinko.chat);
      estado.textContent = plinkoCayendo
        ? 'Cayendo…'
        : plinko.abierta
          ? (cerradaPorTiempo(plinko)
            ? `Inscripción cerrada: ${cuantos} apuntado(s). Pulsa «¡Soltar bolas!».`
            : `Inscripción abierta en ${plinko.escuchando || 'el chat'}: escriben «${palabraPlinko()}» para tirar. ${cuantos} apuntado(s).`)
          : plinko.tiradas.length
            ? `Ronda terminada: ${plinko.tiradas.length} bola(s). Abre otra para volver a tirar.`
            : 'Sin ronda abierta.';

      // Quien va entrando. Solo mientras hay ronda abierta: en cuanto se
      // sueltan las bolas manda el marcador, que ya dice quien es cada una.
      const apuntados = document.getElementById('plinkoApuntados');
      apuntados.hidden = !plinko.abierta || plinkoCayendo;
      if (!apuntados.hidden) {
        document.getElementById('plinkoApuntadosTitulo').textContent = 'Apuntados (' + cuantos + ')';
        document.getElementById('plinkoApuntadosLista').innerHTML = cuantos
          ? plinko.jugadores.map((j) =>
            '<span class="plinko-ficha"><span class="quien">' + escapeHtml(j.nombre) + '</span></span>').join('')
          : '<span class="vacio">Nadie todavía: en cuanto escriban «'
            + escapeHtml(palabraPlinko()) + '» en el chat van saliendo aquí.</span>';
      }

      // Con premios no hay puntos que valgan: el campo se esconde en lugar de
      // quedarse ahí sin hacer nada. Manda lo que dicen los ajustes, que es lo
      // que hará la próxima ronda, y no el modo de la que ya se tiró.
      const vanPremiosAhora = plinko?.ajustes?.modo === 'premios';
      ['plinkoPuntos', 'plinkoPuntosEtiqueta'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = vanPremiosAhora;
      });

      const tirar = document.getElementById('plinkoTirar');
      tirar.hidden = !plinko.abierta;
      tirar.disabled = plinkoCayendo || cuantos < 1;
      document.getElementById('plinkoCancelar').hidden = plinkoCayendo || !plinko.abierta;
      document.getElementById('plinkoRepetir').hidden = plinkoCayendo || !plinko.tiradas.length || cuantos < 1;
      ajustarAcciones();
      mostrarCrono('plinkoCrono', plinko.abierta ? plinko : null, cargarPlinko);

      // A pantalla completa solo hay algo que mirar con el tablero puesto, que
      // es siempre: pero sin nadie apuntado no hay nada que pase.
      pintarModoPlinko();
      pintarPremiosEditor();
      pintarPremiosCosas();
      dibujarTablero();
    }

    // --- El dibujo ----------------------------------------------------------
    // El tablero se pinta en js/plinko-tablero.js, que comparten esta página y
    // el widget de OBS. Aquí solo se le pasa lo que tiene que pintar.

    const BRILLO_CLAVIJA = PlinkoTablero.BRILLO_CLAVIJA;
    const clavijasDe = PlinkoTablero.clavijasDe;
    const colorCasilla = PlinkoTablero.colorCasilla;

    function dibujarTablero() {
      const lienzo = document.getElementById('plinkoLienzo');
      if (!lienzo || !plinko.tablero) return;
      PlinkoTablero.dibujar(lienzo, plinko, plinkoClavijasVivas, plinkoBolas, plinkoCasillasVivas);
    }

    // Una imagen de premio que carga tarde tiene que repintar el tablero.
    PlinkoTablero.alRepintar(dibujarTablero);

    // --- La caída -----------------------------------------------------------

    // Reproduce los recorridos que mandó el servidor. Cada bola sale un poco
    // después que la anterior y va pasando por sus puntos, sin inventarse nada.
    function verCaer(tiradas) {
      if (plinkoAnimacion) cancelAnimationFrame(plinkoAnimacion);
      plinkoCayendo = true;
      plinkoCasillasVivas = new Map();
      plinkoClavijasVivas = new Map();
      const caja = document.getElementById('plinkoResultado');
      caja.hidden = false;
      caja.innerHTML = '';

      plinkoBolas = tiradas.map((t, i) => {
        // Los golpes vienen como [fotograma, clavija]. Se agrupan por fotograma
        // para saber de un vistazo que clavija encender en cada uno.
        const golpes = new Map();
        (t.choques || []).forEach(([cuando, cual]) => {
          if (!golpes.has(cuando)) golpes.set(cuando, []);
          golpes.get(cuando).push(cual);
        });
        return {
          nombre: t.nombre,
          color: COLORES_PLINKO[i % COLORES_PLINKO.length],
          recorrido: t.recorrido,
          golpes,
          casilla: t.casilla,
          multiplicador: t.multiplicador,
          premio: t.premio || null,
          puntos: t.puntos,
          empiezaEn: i * RETRASO_BOLA,
          x: 0, y: 0, visible: false, acabada: false,
          ultimoFotograma: -1,
          estela: []   // las ultimas posiciones, de mas vieja a mas nueva
        };
      });
      pintarPlinko();

      const arranque = performance.now();
      const paso = (ahora) => {
        const t = (ahora - arranque) / 1000;
        let quedan = false;
        plinkoBolas.forEach((b) => {
          const suyo = t - b.empiezaEn;
          if (suyo < 0) { b.visible = false; quedan = true; return; }
          const cual = Math.floor(suyo * 60);
          if (cual >= b.recorrido.length) {
            // Ya ha llegado: se queda quieta en su casilla mientras dure la
            // marca, y se apunta en la lista una sola vez.
            const fin = b.recorrido[b.recorrido.length - 1];
            b.x = fin[0];
            b.y = fin[1];
            b.estela = [];
            if (!b.acabada) {
              b.acabada = true;
              plinkoCasillasVivas.set(b.casilla, ahora);
              apuntarTirada(b);
            }
            b.visible = plinkoCasillasVivas.has(b.casilla);
            return;
          }
          quedan = true;
          b.visible = true;
          const punto = b.recorrido[cual];
          // La estela se lleva por donde venia, sin repetir el sitio si el
          // fotograma no ha cambiado (pantallas de 120 Hz y demas).
          if (b.x !== punto[0] || b.y !== punto[1]) {
            b.estela.push([b.x, b.y]);
            if (b.estela.length > ESTELA_BOLA) b.estela.shift();
          }
          b.x = punto[0];
          b.y = punto[1];
          // Lo que se enciende es la clavija, no la bola: se ve donde ha dado.
          // Se miran tambien los fotogramas que se hayan saltado, que si no un
          // golpe rapido puede pasar sin encender nada.
          for (let f = b.ultimoFotograma + 1; f <= cual; f++) {
            (b.golpes.get(f) || []).forEach((clavija) => {
              if (clavija >= 0) plinkoClavijasVivas.set(clavija, ahora);
            });
          }
          b.ultimoFotograma = cual;
        });
        // La casilla se queda marcada medio segundo, y la clavija un momento.
        plinkoCasillasVivas.forEach((cuando, casilla) => {
          if (ahora - cuando > 600) plinkoCasillasVivas.delete(casilla);
        });
        plinkoClavijasVivas.forEach((cuando, clavija) => {
          if (ahora - cuando > BRILLO_CLAVIJA) plinkoClavijasVivas.delete(clavija);
        });
        dibujarTablero();
        if (quedan || plinkoCasillasVivas.size || plinkoClavijasVivas.size) {
          plinkoAnimacion = requestAnimationFrame(paso);
        } else {
          plinkoAnimacion = null;
          plinkoCayendo = false;
          plinkoBolas = [];
          dibujarTablero();
          pintarPlinko();
          cargarPuntos();
        }
      };
      plinkoAnimacion = requestAnimationFrame(paso);
    }

    // Cada bola que llega se apunta en la lista, con su casilla y sus puntos.
    function apuntarTirada(b) {
      const caja = document.getElementById('plinkoResultado');
      // El multiplicador va del color de su casilla, el mismo que se acaba de
      // ver encenderse en el tablero.
      const mayor = Math.max(1, ...(plinko.multiplicadores || []));
      const color = colorCasilla(b.multiplicador, mayor);
      const ficha = document.createElement('div');
      // Con premios lo que importa es qué le ha tocado: el multiplicador no
      // pinta nada ahí, así que no se enseña.
      const premio = b.premio;
      const conPremio = !!(premio && (premio.nombre || premio.imagen));
      ficha.className = 'plinko-ficha' + ((conPremio || (!premio && b.multiplicador > 1)) ? ' premiada' : '');
      ficha.innerHTML = premio
        ? `
        <span class="bolita" style="color:${b.color}"></span>
        <span class="quien" title="${escapeHtml(b.nombre)}">${escapeHtml(b.nombre)}</span>
        ${premio.imagen ? `<img class="premio-img" src="${escapeHtml(premio.imagen)}" alt="" />` : ''}
        <span class="gano">${conPremio ? escapeHtml(premio.nombre || 'premio') : 'sin premio'}</span>`
        : `
        <span class="bolita" style="color:${b.color}"></span>
        <span class="quien" title="${escapeHtml(b.nombre)}">${escapeHtml(b.nombre)}</span>
        <span class="gano">${b.puntos > 0 ? `+${b.puntos.toLocaleString('es-ES')} pts` : 'sin puntos'}</span>
        <span class="multi" style="background:linear-gradient(180deg,${color.claro},${color.oscuro})">x${b.multiplicador}</span>`;
      caja.appendChild(ficha);
    }

    // --- Los premios --------------------------------------------------------


    // --- Premios del tablero -----------------------------------------------
    // El tablero reparte puntos (multiplicadores) o premios (nombre e imagen).
    // Lo que sigue es el editor de Configuración: qué modo, y qué hay en cada
    // casilla cuando van premios.

    function modoPlinko() {
      return plinko?.ajustes?.modo === 'premios' ? 'premios' : 'puntos';
    }

    // Los premios que se están editando. Se guardan aquí y no se releen del
    // servidor en cada repintado: si no, al elegir una imagen se perdería lo
    // que estuvieras escribiendo en otra casilla.
    let premiosEditor = null;
    let premioEditando = -1;   // la casilla para la que se abrió el buscador

    // Los multiplicadores que valen para editar son siempre los de los
    // ajustes: plinko.multiplicadores se queda congelado con la ronda en
    // cuanto hay tiradas, y entonces diria las casillas de antes.
    function multiplicadoresVigentes() {
      return plinko?.ajustes?.multiplicadores || plinko.multiplicadores || [];
    }

    function premiosDeAjustes() {
      const casillas = multiplicadoresVigentes().length;
      const guardados = plinko?.ajustes?.premios || [];
      return Array.from({ length: casillas }, (_, i) => ({
        nombre: guardados[i]?.nombre || '',
        imagen: guardados[i]?.imagen || ''
      }));
    }

    function pintarModoPlinko() {
      const sel = document.getElementById('plinkoModo');
      if (!sel) return;
      const modo = modoPlinko();
      if (document.activeElement !== sel) sel.value = modo;

      const vanPremios = modo === 'premios';
      document.getElementById('plinkoPremios').hidden = vanPremios;
      document.getElementById('plinkoPremiosCosas').hidden = !vanPremios;
      document.getElementById('plinkoPremiosTitulo').textContent = vanPremios
        ? 'Premio de cada casilla'
        : 'Premios de cada casilla';
      document.getElementById('plinkoPremiosDefecto').textContent = vanPremios
        ? 'Vaciar todas las casillas'
        : 'Volver a los de siempre';
      document.getElementById('plinkoPremiosAyuda').innerHTML = vanPremios
        ? 'Lo que se lleva quien caiga ahí. Elige un objeto del catálogo o sube tu propia imagen; el nombre se puede cambiar. Una casilla en blanco es una casilla que no da nada.'
        : 'Lo que se lleva quien caiga ahí: el multiplicador de la casilla por lo que vale la tirada. Los de siempre están puestos para que el tablero devuelva de media una vez la tirada, caiga donde caiga.';
    }

    function pintarPremiosCosas() {
      const caja = document.getElementById('plinkoPremiosCosas');
      if (!caja || caja.hidden) return;
      // Como con los multiplicadores: no se repinta mientras se escribe, que
      // se borraría lo tecleado en cada refresco.
      if (caja.contains(document.activeElement)) return;
      if (!premiosEditor) premiosEditor = premiosDeAjustes();
      const casillas = multiplicadoresVigentes().length;
      if (premiosEditor.length !== casillas) premiosEditor = premiosDeAjustes();

      caja.innerHTML = '';
      premiosEditor.forEach((premio, i) => {
        const tarjeta = document.createElement('div');
        tarjeta.className = 'premio-casilla';
        tarjeta.innerHTML =
          '<span class="cual">Casilla ' + (i + 1) + '</span>'
          + '<span class="lienzo">'
          + (premio.imagen
            ? '<img src="' + escapeHtml(premio.imagen) + '" alt="" />'
            : '<span class="sin">Sin imagen</span>')
          + '</span>'
          + '<input type="text" maxlength="60" placeholder="Nombre del premio" value="'
          + escapeHtml(premio.nombre) + '" aria-label="Nombre del premio de la casilla ' + (i + 1) + '" />'
          + '<span class="botones">'
          + '<button type="button" class="elegir">Objeto</button>'
          + '<button type="button" class="subir">Imagen</button>'
          + (premio.nombre || premio.imagen ? '<button type="button" class="quitar" title="Vaciar la casilla">✕</button>' : '')
          + '</span>'
          + '<input type="file" accept="image/*" />';

        tarjeta.querySelector('input[type=text]').addEventListener('input', (ev) => {
          premiosEditor[i].nombre = ev.target.value;
        });
        tarjeta.querySelector('.elegir').addEventListener('click', () => abrirBuscadorPremio(i));
        const archivo = tarjeta.querySelector('input[type=file]');
        tarjeta.querySelector('.subir').addEventListener('click', () => archivo.click());
        archivo.addEventListener('change', (ev) => subirImagenPremio(ev, i));
        const quitar = tarjeta.querySelector('.quitar');
        if (quitar) quitar.addEventListener('click', () => {
          premiosEditor[i] = { nombre: '', imagen: '' };
          pintarPremiosCosas();
        });
        caja.appendChild(tarjeta);
      });
    }

    // La imagen no viaja dentro de los ajustes: se sube aparte y lo que se
    // guarda es la ruta que devuelve el servidor.
    async function subirImagenPremio(ev, casilla) {
      const archivo = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!archivo) return;
      const aviso = document.getElementById('plinkoPremiosEstado');
      try {
        const dataUrl = await new Promise((resolver, fallar) => {
          const lector = new FileReader();
          lector.onload = () => resolver(lector.result);
          lector.onerror = () => fallar(new Error('no se pudo leer el archivo'));
          lector.readAsDataURL(archivo);
        });
        const data = await api('/api/plinko/imagen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl })
        });
        premiosEditor[casilla].imagen = data.url;
        // Sin nombre puesto, el del archivo sirve de punto de partida.
        if (!premiosEditor[casilla].nombre) {
          premiosEditor[casilla].nombre = archivo.name.replace(/\.[^.]+$/, '').slice(0, 60);
        }
        pintarPremiosCosas();
        aviso.textContent = 'Imagen puesta. Acuérdate de guardar.';
      } catch (e) {
        aviso.textContent = e.message;
      }
    }

