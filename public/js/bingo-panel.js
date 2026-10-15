// El panel del bingo: abrir la partida, sacar bolas y ver quien esta a punto.
// El dibujo (bola, tablero y carton) es aparte, en bingo-dibujo.js.
//
// Es un script normal, sin modulo: comparte el ambito global con index.html
// (api, showAlert, escapeHtml, mostrarCrono...), y por eso va cargado despues.

    // --- Bingo -------------------------------------------------------------
    // Aquí no se decide nada: las bolas las saca el servidor, y quién gana lo
    // decide el servidor cuando alguien canta en el chat. Esto lo enseña.

    let bingo = { hay: false, abierta: false, salidas: [], jugadores: [], cantos: [] };
    // La última bola que se pintó, para hacer rodar solo la que es nueva.
    let bingoUltimaPintada = 0;
    // A quién se le está enseñando el cartón en la lista de «más cerca».
    const bingoAbiertos = new Set();
    // Cuántos premios iban apuntados en Ganadores la última vez que se miró.
    // Los apunta el servidor al cantar; cuando sube, se refresca Ganadores.
    let bingoApuntados = -1;
    const BINGO_CAMPOS = ['bingoMaxCartones', 'bingoCantar', 'bingoCantarLinea', 'bingoJugarLinea', 'bingoJugarBingo',
      'bingoKamasLinea', 'bingoKamasBingo'];
    // El objeto del catálogo de cada premio, tal como está en el editor. Se
    // relee de los ajustes solo mientras no lo hayas cambiado sin guardar.
    const bingoObjetos = { Linea: null, Bingo: null };
    let bingoObjetosTocados = false;

    async function cargarBingo() {
      try {
        bingo = await api('/api/bingo');
      } catch (e) {
        console.warn('No se pudo leer el bingo:', e.message);
        return;
      }
      if (bingo.ajustes) {
        ponerSiNoLoTocas('bingoMaxCartones', bingo.ajustes.maxCartones);
        ponerSiNoLoTocas('bingoCantar', bingo.ajustes.cantar);
        ponerSiNoLoTocas('bingoCantarLinea', bingo.ajustes.cantarLinea);
        // Las casillas de qué se juega: como los campos, no se tocan mientras
        // las estás cambiando.
        [['bingoJugarLinea', bingo.ajustes.jugarLinea], ['bingoJugarBingo', bingo.ajustes.jugarBingo]].forEach(([id, valor]) => {
          const caja = document.getElementById(id);
          if (caja && caja.dataset.tocado !== '1') caja.checked = valor !== false;
        });
        const pl = bingo.ajustes.premioLinea || {};
        const pb = bingo.ajustes.premioBingo || {};
        ponerSiNoLoTocas('bingoKamasLinea', pl.kamas || '');

        ponerSiNoLoTocas('bingoKamasBingo', pb.kamas || '');
        if (!bingoObjetosTocados) {
          bingoObjetos.Linea = pl.texto ? { texto: pl.texto, imagen: pl.imagen || '' } : null;
          bingoObjetos.Bingo = pb.texto ? { texto: pb.texto, imagen: pb.imagen || '' } : null;
          pintarObjetosBingo();
        }
      }
      const apuntados = (bingo.cantos || []).filter((c) => c.apuntado).length;
      if (bingoApuntados >= 0 && apuntados > bingoApuntados) {
        loadWinners();
        loadRanking();
        loadHistory();
      }
      bingoApuntados = apuntados;
      pintarBingo();
      // La recompensa vive en la conexión con Twitch: se pide una vez.
      if (!bingoRecompensaLeida) { bingoRecompensaLeida = true; cargarRecompensa(); }
      else pintarRecompensa();
    }
    let bingoRecompensaLeida = false;

    // La recompensa de puntos que vende cartones. Se lee de la conexión con
    // Twitch, que es donde se guarda (con su coste).
    let bingoRecompensa = null;
    let bingoTwitchConectado = false;
    async function cargarRecompensa() {
      try {
        const t = await api('/api/twitch/status');
        bingoRecompensa = t.bingoRecompensa || null;
        bingoTwitchConectado = Boolean(t.conectado);
      } catch (e) { /* se queda como estaba */ }
      if (bingoRecompensa) {
        ponerSiNoLoTocas('bingoRecompensaTitulo', bingoRecompensa.titulo);
        ponerSiNoLoTocas('bingoRecompensaCoste', bingoRecompensa.coste);
      }
      pintarRecompensa();
    }

    function pintarRecompensa() {
      const estado = document.getElementById('bingoRecompensaEstado');
      const boton = document.getElementById('bingoRecompensaCrear');
      boton.textContent = bingoRecompensa ? 'Actualizar en Twitch' : 'Crear en Twitch';
      estado.textContent = !bingoTwitchConectado && !bingoRecompensa
        ? 'Para vender cartones hace falta conectar tu cuenta en Configuración › Twitch (y que el canal sea afiliado o partner).'
        : bingoRecompensa
          ? `Se compran canjeando «${bingoRecompensa.titulo}» por ${Number(bingoRecompensa.coste).toLocaleString('es-ES')} puntos. Si no se le puede dar cartón, Twitch le devuelve los puntos.`
          : 'Pon nombre y precio y pulsa «Crear en Twitch»: el Ruletón crea la recompensa en tu canal.';
    }

    function bingoVigilar(encender) {
      // El servidor avisa por su canal: los cartones que se piden y los cantos
      // del chat llegan sin pulsar nada. Ver eventos.js.
      Eventos.vigilar('bingo', cargarBingo, encender);
    }

    function urlCartones() {
      return location.origin + '/bingo?p=' + encodeURIComponent(bingo.codigo || '');
    }

    function pintarBingo() {
      const cuantos = bingo.jugadores.length;
      const jugando = bingo.jugadores.filter((j) => !j.descalificado).length;
      const cantar = bingo.fase === 'linea'
        ? (bingo.ajustes && bingo.ajustes.cantarLinea) || '!linea'
        : (bingo.ajustes && bingo.ajustes.cantar) || '!bingo';
      const estado = document.getElementById('bingoEstado');
      avisarChat('bingoEstado', bingo.chat);
      const seJuega = bingo.fase === 'linea' ? 'la línea' : 'el cartón lleno';
      estado.textContent = !bingo.hay
        ? 'Sin partida.'
        : bingo.fase === 'fin'
          ? `Partida terminada tras ${bingo.salidas.length} bola(s). Abre otra para volver a jugar.`
          : bingo.abierta && !cerradaPorTiempo(bingo)
            ? `Venta de cartones abierta${bingo.recompensa ? `: canjean «${bingo.recompensa}» con puntos del canal` : ' (falta crear la recompensa de puntos)'}. ${bingo.cartones || 0} cartón(es) de ${cuantos} persona(s). La primera bola cierra la venta.`
            : `Se juega ${seJuega}. Cantan escribiendo «${cantar}». ${jugando} de ${cuantos} persona(s) en juego · ${bingo.salidas.length} de 75 bolas.`;

      // La dirección de los cartones, para decirla en el directo.
      const enlace = document.getElementById('bingoEnlace');
      enlace.hidden = !bingo.hay;
      if (bingo.hay) {
        document.getElementById('bingoCodigo').textContent = bingo.codigo;
        const a = document.getElementById('bingoUrl');
        a.href = urlCartones();
        a.textContent = urlCartones();
      }

      // La bola y el tablero.
      const ultima = bingo.salidas[bingo.salidas.length - 1] || 0;
      BingoDibujo.bola(document.getElementById('bingoBola'), ultima, ultima && ultima !== bingoUltimaPintada);
      bingoUltimaPintada = ultima;
      BingoDibujo.tablero(document.getElementById('bingoTablero'), bingo.salidas);
      const previas = bingo.salidas.slice(-6, -1).reverse();
      document.getElementById('bingoPrevias').innerHTML = previas.length
        ? 'Antes: ' + previas.map((n) => BingoDibujo.letraDe(n) + n).join(' · ')
        : '';

      // Lo que ha pasado al cantar, lo último arriba.
      const cantos = document.getElementById('bingoCantos');
      cantos.innerHTML = (bingo.cantos || []).slice().reverse().map((c) =>
        `<li class="bingo-canto ${c.que}">${escapeHtml(BingoDibujo.textoCanto(c))}`
        + ` <span class="meta">(bola ${c.bola})</span>`
        + (c.premio && !c.apuntado ? ' <strong>· no se pudo apuntar en Ganadores: apúntalo a mano</strong>' : '')
        + '</li>').join('');
      cantos.hidden = !(bingo.cantos || []).length;

      pintarBingoCerca();

      // Los botones de la esquina.
      const sacar = document.getElementById('bingoSacar');
      sacar.hidden = !bingo.hay || bingo.fase === 'fin';
      sacar.disabled = !cuantos || bingo.salidas.length >= 75;
      sacar.textContent = bingo.salidas.length ? 'Sacar bola' : 'Primera bola';
      document.getElementById('bingoCancelar').hidden = !bingo.hay;
      document.getElementById('bingoCancelar').textContent = bingo.fase === 'fin' ? 'Cerrar' : 'Cancelar';
      ajustarAcciones();
      mostrarCrono('bingoCrono', bingo.abierta ? bingo : null, cargarBingo);
    }

    // Quién está más cerca de lo que se juega ahora. Es solo para el panel:
    // en el widget destriparía la emoción.
    function pintarBingoCerca() {
      const caja = document.getElementById('bingoCerca');
      const lista = document.getElementById('bingoCercaLista');
      caja.hidden = !bingo.jugadores.length;
      if (caja.hidden) return;
      const porLinea = bingo.fase === 'linea';
      const cuanto = (j) => (porLinea ? j.linea : j.bingo);
      const enJuego = bingo.jugadores.filter((j) => !j.descalificado)
        .sort((a, b) => cuanto(a) - cuanto(b) || a.bingo - b.bingo);
      const fuera = bingo.jugadores.filter((j) => j.descalificado);
      document.getElementById('bingoCercaTitulo').textContent = bingo.salidas.length
        ? `Más cerca de ${porLinea ? 'la línea' : 'cantar bingo'}`
        : `Cartones (${bingo.cartones || 0} de ${bingo.jugadores.length} persona(s))`;

      const fila = (j) => {
        const falta = cuanto(j);
        const dice = j.descalificado ? 'descalificado'
          : !bingo.salidas.length ? ''
            : falta === 0 ? '¡lo tiene!' : `le falta${falta === 1 ? '' : 'n'} ${falta}`;
        const abierto = bingoAbiertos.has(j.nombre);
        return `<li class="bingo-jugador${j.descalificado ? ' fuera' : ''}${falta === 0 && !j.descalificado ? ' lo-tiene' : ''}">`
          + `<button type="button" class="bingo-ver" data-nombre="${escapeHtml(j.nombre)}" aria-expanded="${abierto}">`
          + `<span class="quien">${escapeHtml(j.nombre)}${(j.cartones || []).length > 1 ? ` <span class="meta">×${j.cartones.length}</span>` : ''}</span><span class="falta">${dice}</span></button>`
          + (abierto ? `<div class="bingo-mini" data-carton="${escapeHtml(j.nombre)}"></div>` : '')
          + '</li>';
      };
      // Con mucha gente no caben todos: los veinte más cerca, y los demás se
      // cuentan.
      const caben = enJuego.slice(0, 20);
      lista.innerHTML = caben.map(fila).join('')
        + (enJuego.length > caben.length ? `<li class="meta">y ${enJuego.length - caben.length} más</li>` : '')
        + fuera.map(fila).join('');
      lista.querySelectorAll('.bingo-mini').forEach((el) => {
        const j = bingo.jugadores.find((x) => x.nombre === el.dataset.carton);
        if (j) BingoDibujo.cartones(el, j.cartones, bingo.salidas, { mini: true, fuera: j.descalificado });
      });
    }

    // En cuanto tocas uno, deja de refrescarse hasta que lo guardas.
    BINGO_CAMPOS.forEach((id) => {
      const campo = document.getElementById(id);
      campo.addEventListener('input', () => { campo.dataset.tocado = '1'; });
    });

    document.getElementById('bingoCercaLista').addEventListener('click', (ev) => {
      const boton = ev.target.closest('.bingo-ver');
      if (!boton) return;
      const nombre = boton.dataset.nombre;
      if (bingoAbiertos.has(nombre)) bingoAbiertos.delete(nombre); else bingoAbiertos.add(nombre);
      pintarBingoCerca();
    });

    async function bingoPedir(ruta, cuerpo, siFalla) {
      try {
        bingo = await api(ruta, cuerpo === undefined ? { method: 'POST' } : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo)
        });
        pintarBingo();
        return true;
      } catch (e) {
        showAlert(siFalla, e.message);
        return false;
      }
    }

    document.getElementById('bingoGuardar').addEventListener('click', async () => {
      const aviso = document.getElementById('bingoGuardado');
      if (!document.getElementById('bingoJugarLinea').checked && !document.getElementById('bingoJugarBingo').checked) {
        showAlert('Elige qué se juega', 'Marca la línea, el bingo, o las dos: sin ninguna no hay partida.');
        return;
      }
      const ok = await bingoPedir('/api/bingo/config', {
        maxCartones: Number(document.getElementById('bingoMaxCartones').value) || 1,
        cantar: document.getElementById('bingoCantar').value.trim(),
        cantarLinea: document.getElementById('bingoCantarLinea').value.trim(),
        jugarLinea: document.getElementById('bingoJugarLinea').checked,
        jugarBingo: document.getElementById('bingoJugarBingo').checked,
        premioLinea: {
          kamas: Number(document.getElementById('bingoKamasLinea').value) || 0,
          texto: bingoObjetos.Linea ? bingoObjetos.Linea.texto : '',
          imagen: bingoObjetos.Linea ? bingoObjetos.Linea.imagen : ''
        },
        premioBingo: {
          kamas: Number(document.getElementById('bingoKamasBingo').value) || 0,
          texto: bingoObjetos.Bingo ? bingoObjetos.Bingo.texto : '',
          imagen: bingoObjetos.Bingo ? bingoObjetos.Bingo.imagen : ''
        }
      }, 'No se pudieron guardar los ajustes');
      if (!ok) return;
      // Lo que se guarda puede no ser lo escrito (si las dos palabras eran la
      // misma, por ejemplo): se pone lo que de verdad quedó.
      BINGO_CAMPOS.forEach((id) => {
        delete document.getElementById(id).dataset.tocado;
      });
      bingoObjetosTocados = false;
      document.getElementById('bingoMaxCartones').value = bingo.ajustes.maxCartones;
      document.getElementById('bingoCantar').value = bingo.ajustes.cantar;
      document.getElementById('bingoCantarLinea').value = bingo.ajustes.cantarLinea;
      aviso.textContent = bingo.hay && bingo.fase !== 'fin'
        ? 'Guardado. Vale para la próxima partida.'
        : 'Guardado.';
      setTimeout(() => { aviso.textContent = ''; }, 2500);
    });

    document.getElementById('bingoAbrir').addEventListener('click', async () => {
      if (bingo.hay && bingo.fase !== 'fin' && bingo.salidas.length) {
        const ok = await showConfirm('Hay una partida a medias',
          'Si empiezas otra, los cartones y las bolas de ahora se pierden.', 'Empezar otra', true);
        if (!ok) return;
      }
      bingoAbiertos.clear();
      bingoUltimaPintada = 0;
      if (await bingoPedir('/api/bingo/abrir', { segundos: segundosDe('bingoMinutos') }, 'No se pudo abrir el bingo')) {
        bingoVigilar(true);
      }
    });

    document.getElementById('bingoSacar').addEventListener('click', async () => {
      const boton = document.getElementById('bingoSacar');
      // Dos clics seguidos sacarían dos bolas: se apaga hasta que contesta.
      boton.disabled = true;
      await bingoPedir('/api/bingo/sacar', undefined, 'No se pudo sacar bola');
      boton.disabled = false;
    });

    document.getElementById('bingoCancelar').addEventListener('click', async () => {
      if (bingo.fase !== 'fin' && bingo.salidas.length) {
        const ok = await showConfirm('Cancelar la partida',
          'Se acaba aquí y nadie se lleva nada. Los puntos ya repartidos se quedan.', 'Cancelar partida', true);
        if (!ok) return;
      }
      await bingoPedir('/api/bingo/cancelar', undefined, 'No se pudo cancelar');
      bingoVigilar(false);
    });

    document.getElementById('bingoApuntar').addEventListener('click', async () => {
      const campo = document.getElementById('bingoNombre');
      const nombre = campo.value.trim();
      if (!nombre) return;
      if (await bingoPedir('/api/bingo/apuntar', { nombre }, 'No se pudo dar cartón')) campo.value = '';
    });

    document.getElementById('bingoCantarPor').addEventListener('click', async () => {
      const campo = document.getElementById('bingoNombre');
      const nombre = campo.value.trim();
      if (!nombre) return;
      // Se elige qué se canta, línea o bingo, y se juzga cada uno como en el
      // chat. Las dos opciones salen siempre: la línea se puede cantar aunque
      // ya la haya ganado alguien (quien la completó con esa misma bola
      // también gana). Si no se puede cantar, el servidor dice por qué.
      const eleccion = await showModal({
        title: `Cantar por ${nombre}`,
        message: 'Se juzga igual que si lo hubiera escrito en el chat: si no lo tiene, queda descalificado.',
        okText: 'Cantar línea',
        extraText: 'Cantar bingo',
        cancelText: 'Cancelar',
        danger: true
      });
      if (!eleccion) return;
      const que = eleccion === 'extra' ? 'bingo' : 'linea';
      if (await bingoPedir('/api/bingo/cantar', { nombre, que }, `No se pudo cantar ${que === 'linea' ? 'línea' : 'bingo'}`)) campo.value = '';
    });

    document.getElementById('bingoCopiar').addEventListener('click', async () => {
      const ok = await copyToClipboard(urlCartones());
      const b = document.getElementById('bingoCopiar');
      b.textContent = ok ? '¡Copiado!' : 'No se pudo copiar';
      setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
    });

    // Crear (o actualizar) en Twitch la recompensa que vende cartones.
    ['bingoRecompensaTitulo', 'bingoRecompensaCoste'].forEach((id) => {
      const campo = document.getElementById(id);
      campo.addEventListener('input', () => { campo.dataset.tocado = '1'; });
    });
    document.getElementById('bingoRecompensaCrear').addEventListener('click', async () => {
      const boton = document.getElementById('bingoRecompensaCrear');
      const titulo = document.getElementById('bingoRecompensaTitulo').value.trim() || 'Cartón de bingo';
      const coste = Number(document.getElementById('bingoRecompensaCoste').value) || 0;
      if (coste < 1) {
        showAlert('Falta el precio', 'Pon cuántos puntos del canal cuesta cada cartón.');
        return;
      }
      boton.disabled = true;
      const ok = await bingoPedir('/api/bingo/recompensa', { titulo, coste }, 'No se pudo crear la recompensa en Twitch');
      boton.disabled = false;
      if (!ok) return;
      ['bingoRecompensaTitulo', 'bingoRecompensaCoste'].forEach((id) => {
        delete document.getElementById(id).dataset.tocado;
      });
      await cargarRecompensa();
    });

    // El objeto del catálogo de cada premio: su icono, su nombre y una ✕ para
    // quitarlo. Se elige con el mismo buscador que el tablero de clavijas, pero
    // aquí con recursos, objetos y cosméticos.
    function pintarObjetosBingo() {
      ['Linea', 'Bingo'].forEach((que) => {
        const caja = document.getElementById('bingoObjeto' + que);
        const o = bingoObjetos[que];
        caja.innerHTML = o
          ? (o.imagen ? '<img src="' + escapeHtml(o.imagen) + '" alt="" />' : '')
            + '<span>' + escapeHtml(o.texto) + '</span>'
            + '<button type="button" data-quitar="' + que + '" title="Quitar el objeto">✕</button>'
          : '';
        const boton = document.querySelector('.bingo-elegir[data-que="' + que + '"]');
        if (boton) boton.textContent = o ? 'Cambiar' : 'Elegir objeto';
      });
    }

    document.querySelectorAll('.bingo-elegir').forEach((boton) => {
      boton.addEventListener('click', () => {
        const que = boton.dataset.que;
        abrirBuscadorCatalogo({
          titulo: 'Premio de ' + (que === 'Linea' ? 'la línea' : 'el bingo'),
          familias: true,
          alElegir: (cosa) => {
            bingoObjetos[que] = { texto: cosa.nombre, imagen: cosa.imagen };
            bingoObjetosTocados = true;
            pintarObjetosBingo();
            document.getElementById('bingoGuardado').textContent = 'Objeto puesto. Acuérdate de guardar.';
          }
        });
      });
    });

    ['Linea', 'Bingo'].forEach((que) => {
      document.getElementById('bingoObjeto' + que).addEventListener('click', (ev) => {
        if (!ev.target.closest('[data-quitar]')) return;
        bingoObjetos[que] = null;
        bingoObjetosTocados = true;
        pintarObjetosBingo();
        document.getElementById('bingoGuardado').textContent = 'Objeto quitado. Acuérdate de guardar.';
      });
    });
