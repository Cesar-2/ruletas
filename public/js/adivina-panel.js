// El panel de Adivina la palabra: empezar con una palabra secreta, ir dando
// pistas y ver por donde va el chat. Quien acierta lo decide el servidor, que
// es quien lee el chat (ver src/adivina.ts).
//
// La palabra va tapada salvo que se pida verla: esta pantalla se comparte en el
// directo muy a menudo.
//
// Es un script normal, sin modulo: comparte el ambito global con index.html
// (api, showAlert, escapeHtml, makeConfetti...), y por eso va cargado despues.

    let adivina = { hay: false, partida: null, ajustes: null };
    // Si se esta ensenando la palabra en el panel.
    let adivinaVisible = false;
    // El ganador que ya se celebro, para no tirar confeti en cada repintado.
    let adivinaCelebrado = '';
    // El objeto del premio tal como esta en el editor, y si se ha tocado sin guardar.
    let adivinaObjeto = null;
    let adivinaObjetoTocado = false;

    async function cargarAdivina() {
      try {
        adivina = await api('/api/adivina');
      } catch (e) {
        console.warn('No se pudo leer Adivina la palabra:', e.message);
        return;
      }
      pintarAdivina();
    }

    function adivinaVigilar(encender) {
      // Cada intento del chat y quien acierta llegan solos. Ver eventos.js.
      Eventos.vigilar('adivina', cargarAdivina, encender);
    }

    async function adivinaPedir(ruta, cuerpo, titulo) {
      try {
        adivina = await api(ruta, cuerpo ? {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
        } : { method: 'POST' });
        pintarAdivina();
        return true;
      } catch (e) {
        showAlert(titulo || 'Adivina la palabra', e.message);
        return false;
      }
    }

    function pintarAdivina() {
      const p = adivina.partida;
      const jugando = Boolean(p && p.fase === 'jugando');
      const fin = Boolean(p && p.fase === 'fin');

      // Sin partida, o con la anterior acabada, se puede empezar otra.
      document.getElementById('adivinaNueva').hidden = jugando;
      document.getElementById('adivinaJuego').hidden = !p;

      const estado = document.getElementById('adivinaEstado');
      avisarChat('adivinaEstado', jugando ? adivina.chat : null);
      estado.textContent = !p
        ? 'Sin partida. Escribe la palabra y empieza.'
        : jugando
          ? `En juego: ${p.pistas.length} pista(s) dadas · ${p.intentos} intento(s) de ${p.cuantos} persona(s).`
          : p.ganador
            ? `La acertó ${p.ganador} con ${p.pistas.length} pista(s), tras ${p.intentos} intento(s). Escribe otra palabra para jugar de nuevo.`
            : 'Nadie la sacó. Escribe otra palabra para jugar de nuevo.';
      if (!p) return;

      // La palabra: tapada mientras se juega, salvo que se pida; al acabar, a la vista.
      const secreta = document.getElementById('adivinaSecreta');
      const ver = adivinaVisible || fin;
      secreta.textContent = ver ? p.palabra : '•'.repeat(Math.min(12, Math.max(4, p.palabra.length)));
      secreta.classList.toggle('tapada', !ver);
      const botonVer = document.getElementById('adivinaVer');
      botonVer.hidden = fin;
      botonVer.textContent = adivinaVisible ? '🙈 Ocultar' : '👁 Ver';

      const forma = document.getElementById('adivinaForma');
      forma.hidden = !(p.letras && jugando);
      if (p.letras) forma.textContent = formaDe(p.palabra);

      document.getElementById('adivinaPistas').innerHTML = p.pistas.map((x, i) =>
        '<li>' + escapeHtml(x.texto || (x.imagen ? '🖼' : ''))
        + (jugando ? '<button type="button" data-quitar="' + i + '" title="Quitar esta pista">✕</button>' : '')
        + (x.imagen ? '<img src="' + escapeHtml(x.imagen) + '" alt="" loading="lazy" />' : '')
        + '</li>').join('');
      document.getElementById('adivinaPistaFila').hidden = !jugando;
      if (!jugando) ponerImagenPendiente(null);
      document.getElementById('adivinaMandos').hidden = !jugando;

      // Por dónde va el chat: los últimos que han fallado.
      const ultimos = document.getElementById('adivinaUltimos');
      ultimos.hidden = !jugando || !p.ultimos.length;
      ultimos.innerHTML = 'Últimos intentos: ' + p.ultimos.slice().reverse()
        .map((u) => '<b>' + escapeHtml(u.nombre) + '</b> «' + escapeHtml(u.texto) + '»').join(' · ');

      const ganador = document.getElementById('adivinaGanador');
      ganador.hidden = !fin;
      ganador.classList.toggle('pierde', fin && !p.ganador);
      if (fin) {
        const premio = [
          p.puntos > 0 ? p.puntos + ' puntos' : '',
          p.premio && p.premio.texto ? p.premio.texto : '',
          p.premio && p.premio.kamas > 0 ? Number(p.premio.kamas).toLocaleString('es-ES') + ' kamas' : ''
        ].filter(Boolean).join(' + ');
        const sinApuntar = p.ganador && p.premio && (p.premio.kamas > 0 || p.premio.texto) && !p.apuntado;
        ganador.innerHTML = p.ganador
          ? '🎉 <strong>' + escapeHtml(p.ganador) + '</strong> lo ha adivinado: era «' + escapeHtml(p.palabra) + '»'
            + (premio ? '<br><span class="meta">Se lleva ' + escapeHtml(premio) + '</span>' : '')
            + (sinApuntar ? '<br><strong>No se pudo apuntar en Ganadores: apúntalo a mano.</strong>' : '')
          : 'Nadie lo ha adivinado. Era «' + escapeHtml(p.palabra) + '»';
        const clave = p.empezo + ':' + p.ganador;
        if (p.ganador && adivinaCelebrado !== clave) {
          // La primera vez que se ve este ganador, y no al recargar la página.
          if (adivinaCelebrado) {
            makeConfetti(30);
            if (typeof cargarPuntos === 'function') cargarPuntos();
            if (p.apuntado) { loadWinners(); loadRanking(); loadHistory(); }
          }
          adivinaCelebrado = clave;
        }
        adivinaVigilar(false);
      } else if (!adivinaCelebrado) {
        adivinaCelebrado = '-';
      }

      pintarAjustesAdivina();
    }

    // Lo mismo que forma() en src/adivina.ts: un hueco por letra.
    function formaDe(palabra) {
      return String(palabra).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9ñ]+/g, ' ').trim().split(' ').filter(Boolean)
        .map((p) => Array.from(p).map(() => '_').join(' ')).join('   ');
    }

    // --- Ajustes del premio (Configuración › Minijuegos) ------------------

    function pintarAjustesAdivina() {
      const a = adivina.ajustes;
      if (!a) return;
      ponerSiNoLoTocas('adivinaPuntos', a.puntos);
      ponerSiNoLoTocas('adivinaKamas', a.premio && a.premio.kamas ? a.premio.kamas : '');
      if (!adivinaObjetoTocado) {
        adivinaObjeto = a.premio && a.premio.texto ? { texto: a.premio.texto, imagen: a.premio.imagen || '' } : null;
        pintarObjetoAdivina();
      }
    }

    function pintarObjetoAdivina() {
      const caja = document.getElementById('adivinaObjeto');
      const o = adivinaObjeto;
      caja.innerHTML = o
        ? (o.imagen ? '<img src="' + escapeHtml(o.imagen) + '" alt="" />' : '')
          + '<span>' + escapeHtml(o.texto) + '</span>'
          + '<button type="button" data-quitar="1" title="Quitar el objeto">✕</button>'
        : '';
      document.getElementById('adivinaElegir').textContent = o ? 'Cambiar' : 'Elegir objeto';
    }

    ['adivinaPuntos', 'adivinaKamas'].forEach((id) => {
      const campo = document.getElementById(id);
      campo.addEventListener('input', () => { campo.dataset.tocado = '1'; });
    });

    document.getElementById('adivinaElegir').addEventListener('click', () => {
      abrirBuscadorCatalogo({
        titulo: 'Premio de Adivina la palabra',
        familias: true,
        alElegir: (cosa) => {
          adivinaObjeto = { texto: cosa.nombre, imagen: cosa.imagen };
          adivinaObjetoTocado = true;
          pintarObjetoAdivina();
          document.getElementById('adivinaGuardado').textContent = 'Objeto puesto. Acuérdate de guardar.';
        }
      });
    });

    document.getElementById('adivinaObjeto').addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-quitar]')) return;
      adivinaObjeto = null;
      adivinaObjetoTocado = true;
      pintarObjetoAdivina();
      document.getElementById('adivinaGuardado').textContent = 'Objeto quitado. Acuérdate de guardar.';
    });

    document.getElementById('adivinaGuardar').addEventListener('click', async () => {
      const ok = await adivinaPedir('/api/adivina/config', {
        puntos: Number(document.getElementById('adivinaPuntos').value) || 0,
        premio: {
          kamas: Number(document.getElementById('adivinaKamas').value) || 0,
          texto: adivinaObjeto ? adivinaObjeto.texto : '',
          imagen: adivinaObjeto ? adivinaObjeto.imagen : ''
        }
      }, 'No se pudieron guardar los ajustes');
      if (!ok) return;
      olvidarTocados(['adivinaPuntos', 'adivinaKamas']);
      adivinaObjetoTocado = false;
      pintarAjustesAdivina();
      const aviso = document.getElementById('adivinaGuardado');
      aviso.textContent = adivina.partida && adivina.partida.fase === 'jugando'
        ? 'Guardado. Vale para la próxima partida.'
        : 'Guardado.';
      setTimeout(() => { aviso.textContent = ''; }, 2500);
    });

    // --- Jugar -------------------------------------------------------------

    document.getElementById('adivinaVerNueva').addEventListener('click', () => {
      const campo = document.getElementById('adivinaPalabra');
      campo.type = campo.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('adivinaVer').addEventListener('click', () => {
      adivinaVisible = !adivinaVisible;
      pintarAdivina();
    });

    document.getElementById('adivinaEmpezar').addEventListener('click', async () => {
      const campo = document.getElementById('adivinaPalabra');
      if (!campo.value.trim()) {
        showAlert('Falta la palabra', 'Escribe la palabra que tiene que adivinar el chat.');
        return;
      }
      adivinaVisible = false;
      const ok = await adivinaPedir('/api/adivina/abrir', {
        palabra: campo.value,
        pista: document.getElementById('adivinaPrimera').value,
        letras: document.getElementById('adivinaLetras').checked
      }, 'No se pudo empezar');
      if (!ok) return;
      campo.value = '';
      campo.type = 'password';
      document.getElementById('adivinaPrimera').value = '';
      adivinaVigilar(true);
    });

    // La imagen de la próxima pista, como dataUrl, hasta que se da la pista.
    let adivinaImagen = null;

    function ponerImagenPendiente(dataUrl) {
      adivinaImagen = dataUrl;
      document.getElementById('adivinaPendiente').hidden = !dataUrl;
      document.getElementById('adivinaPendienteImg').src = dataUrl || '';
    }

    function leerImagenAdivina(archivo) {
      if (!archivo || !/^image\/(png|jpeg|webp|gif)$/.test(archivo.type)) {
        showAlert('Esa imagen no vale', 'Tiene que ser PNG, JPG, WEBP o GIF.');
        return;
      }
      if (archivo.size > 12 * 1024 * 1024) {
        showAlert('Imagen demasiado grande', 'Como mucho 12 MB.');
        return;
      }
      const lector = new FileReader();
      lector.onload = () => ponerImagenPendiente(lector.result);
      lector.readAsDataURL(archivo);
    }

    document.getElementById('adivinaImagen').addEventListener('click', () => {
      document.getElementById('adivinaImagenArchivo').click();
    });
    document.getElementById('adivinaImagenArchivo').addEventListener('change', (ev) => {
      leerImagenAdivina(ev.target.files && ev.target.files[0]);
      ev.target.value = '';
    });
    document.getElementById('adivinaPendienteQuitar').addEventListener('click', () => ponerImagenPendiente(null));
    // Pegar una imagen (una captura, una copiada del navegador) en el campo de
    // la pista la deja puesta para la próxima.
    document.getElementById('adivinaPista').addEventListener('paste', (ev) => {
      const item = Array.from((ev.clipboardData && ev.clipboardData.items) || [])
        .find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (!item) return;
      ev.preventDefault();
      leerImagenAdivina(item.getAsFile());
    });

    async function darPistaAdivina() {
      const campo = document.getElementById('adivinaPista');
      if (!campo.value.trim() && !adivinaImagen) return;
      const boton = document.getElementById('adivinaDarPista');
      boton.disabled = true;
      const ok = await adivinaPedir('/api/adivina/pista',
        { texto: campo.value, dataUrl: adivinaImagen || undefined }, 'No se pudo dar la pista');
      boton.disabled = false;
      if (ok) {
        campo.value = '';
        ponerImagenPendiente(null);
        campo.focus();
      }
    }
    document.getElementById('adivinaDarPista').addEventListener('click', darPistaAdivina);
    document.getElementById('adivinaPista').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); darPistaAdivina(); }
    });

    document.getElementById('adivinaPistas').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-quitar]');
      if (b) adivinaPedir('/api/adivina/quitar-pista', { cual: Number(b.dataset.quitar) });
    });

    document.getElementById('adivinaAcertada').addEventListener('click', async () => {
      const campo = document.getElementById('adivinaNombre');
      const nombre = campo.value.trim();
      if (!nombre) return;
      const ok = await showConfirm('Dar por acertada',
        `${nombre} se lleva el premio y la partida se acaba.`, 'Dársela', false);
      if (!ok) return;
      if (await adivinaPedir('/api/adivina/acertada', { nombre }, 'No se pudo dar por acertada')) campo.value = '';
    });

    document.getElementById('adivinaRevelar').addEventListener('click', async () => {
      const ok = await showConfirm('Revelar la palabra',
        'Se acaba la partida sin ganador y se enseña la palabra en el widget y en el chat.', 'Revelar', true);
      if (ok) adivinaPedir('/api/adivina/revelar');
    });

    document.getElementById('adivinaCancelar').addEventListener('click', async () => {
      const ok = await showConfirm('Cancelar la partida',
        'Se olvida sin enseñar la palabra y nadie se lleva nada.', 'Cancelar partida', true);
      if (!ok) return;
      await adivinaPedir('/api/adivina/cancelar');
      adivinaVigilar(false);
    });
