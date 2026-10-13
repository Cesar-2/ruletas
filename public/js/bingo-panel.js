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

    async function cargarBingo() {
      try {
        bingo = await api('/api/bingo');
      } catch (e) {
        console.warn('No se pudo leer el bingo:', e.message);
        return;
      }
      if (bingo.ajustes) {
        ponerSiNoLoTocas('bingoPalabra', bingo.ajustes.palabra);
        ponerSiNoLoTocas('bingoCantar', bingo.ajustes.cantar);
        ponerSiNoLoTocas('bingoPuntosLinea', bingo.ajustes.puntosLinea);
        ponerSiNoLoTocas('bingoPuntosBingo', bingo.ajustes.puntosBingo);
      }
      pintarBingo();
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
      const palabra = (bingo.ajustes && bingo.ajustes.palabra) || '!carton';
      const cantar = (bingo.ajustes && bingo.ajustes.cantar) || '!bingo';
      const estado = document.getElementById('bingoEstado');
      avisarChat('bingoEstado', bingo.chat);
      const seJuega = bingo.fase === 'linea' ? 'la línea' : 'el cartón lleno';
      estado.textContent = !bingo.hay
        ? 'Sin partida.'
        : bingo.fase === 'fin'
          ? `Partida terminada tras ${bingo.salidas.length} bola(s). Abre otra para volver a jugar.`
          : bingo.abierta && !cerradaPorTiempo(bingo)
            ? `Cartones abiertos en ${bingo.escuchando || 'el chat'}: escriben «${palabra}» para pedir el suyo. ${cuantos} cartón(es). La primera bola cierra la entrada.`
            : `Se juega ${seJuega}. Cantan escribiendo «${cantar}». ${jugando} de ${cuantos} cartón(es) en juego · ${bingo.salidas.length} de 75 bolas.`;

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
        + ` <span class="meta">(bola ${c.bola})</span></li>`).join('');
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
        : `Cartones (${bingo.jugadores.length})`;

      const fila = (j) => {
        const falta = cuanto(j);
        const dice = j.descalificado ? 'descalificado'
          : !bingo.salidas.length ? ''
            : falta === 0 ? '¡lo tiene!' : `le falta${falta === 1 ? '' : 'n'} ${falta}`;
        const abierto = bingoAbiertos.has(j.nombre);
        return `<li class="bingo-jugador${j.descalificado ? ' fuera' : ''}${falta === 0 && !j.descalificado ? ' lo-tiene' : ''}">`
          + `<button type="button" class="bingo-ver" data-nombre="${escapeHtml(j.nombre)}" aria-expanded="${abierto}">`
          + `<span class="quien">${escapeHtml(j.nombre)}</span><span class="falta">${dice}</span></button>`
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
        if (j) BingoDibujo.carton(el, j.carton, bingo.salidas, { mini: true, fuera: j.descalificado });
      });
    }

    // En cuanto tocas uno, deja de refrescarse hasta que lo guardas.
    ['bingoPalabra', 'bingoCantar', 'bingoPuntosLinea', 'bingoPuntosBingo'].forEach((id) => {
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
      const ok = await bingoPedir('/api/bingo/config', {
        palabra: document.getElementById('bingoPalabra').value.trim(),
        cantar: document.getElementById('bingoCantar').value.trim(),
        puntosLinea: Number(document.getElementById('bingoPuntosLinea').value) || 0,
        puntosBingo: Number(document.getElementById('bingoPuntosBingo').value) || 0
      }, 'No se pudieron guardar los ajustes');
      if (!ok) return;
      // Lo que se guarda puede no ser lo escrito (si las dos palabras eran la
      // misma, por ejemplo): se pone lo que de verdad quedó.
      ['bingoPalabra', 'bingoCantar', 'bingoPuntosLinea', 'bingoPuntosBingo'].forEach((id) => {
        delete document.getElementById(id).dataset.tocado;
      });
      document.getElementById('bingoPalabra').value = bingo.ajustes.palabra;
      document.getElementById('bingoCantar').value = bingo.ajustes.cantar;
      aviso.textContent = bingo.hay && bingo.fase !== 'fin'
        ? 'Guardado. Vale para la próxima partida.'
        : 'Guardado.';
      setTimeout(() => { aviso.textContent = ''; }, 2500);
    });

    document.getElementById('bingoAbrir').addEventListener('click', async () => {
      if (bingo.hay && bingo.fase !== 'fin' && bingo.salidas.length
          && !confirm('Hay una partida a medias. ¿Empezar otra? Los cartones de ahora se pierden.')) return;
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
      if (bingo.fase !== 'fin' && bingo.salidas.length && !confirm('¿Cancelar la partida? Nadie se lleva nada.')) return;
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
      if (!confirm(`¿Cantar por ${nombre}? Si no lo tiene, queda descalificado.`)) return;
      if (await bingoPedir('/api/bingo/cantar', { nombre }, 'No se pudo cantar')) campo.value = '';
    });

    document.getElementById('bingoCopiar').addEventListener('click', async () => {
      const ok = await copyToClipboard(urlCartones());
      const b = document.getElementById('bingoCopiar');
      b.textContent = ok ? '¡Copiado!' : 'No se pudo copiar';
      setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
    });
