// Cargar el marcador desde una hoja de calculo: primero se mira lo que va a
// pasar y luego se aplica.
//
// Salio de index.html, que se habia puesto en casi once mil lineas. Se movio
// tal cual, sin tocar la sangria: dentro hay plantillas de varias lineas y
// quitarles los cuatro espacios cambiaria lo que generan. Sigue siendo un
// script normal, sin modulo: comparte el ambito global con el resto, y por eso
// el orden en el que index.html lo carga importa.

    // --- Cargar puntos desde una hoja de cálculo ----------------------------
    // Primero se mira, luego se aplica. En modo «dejar tal cual» esto pisa lo
    // que cada uno tuviera ganado, así que enseñar antes lo que va a pasar no
    // es un adorno.

    let importarPendiente = null;

    document.getElementById('puntosImportar').addEventListener('click', () => {
      document.getElementById('puntosImportarArchivo').click();
    });

    document.getElementById('puntosImportarArchivo').addEventListener('change', async (ev) => {
      const archivo = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!archivo) return;
      const estado = document.getElementById('puntosImportarEstado');
      estado.textContent = 'Leyendo…';
      try {
        const dataUrl = await new Promise((resolver, fallar) => {
          const lector = new FileReader();
          lector.onload = () => resolver(lector.result);
          lector.onerror = () => fallar(new Error('no se pudo leer el archivo'));
          lector.readAsDataURL(archivo);
        });
        importarPendiente = { dataUrl, nombre: archivo.name };
        const r = await api('/api/puntos/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl })
        });
        estado.textContent = '';
        pintarResumenImportar(r);
      } catch (e) {
        importarPendiente = null;
        estado.textContent = '';
        document.getElementById('puntosImportarResumen').hidden = true;
        showAlert('No se pudo leer', e.message);
      }
    });

    function pintarResumenImportar(r) {
      const caja = document.getElementById('puntosImportarResumen');
      caja.hidden = false;
      caja.innerHTML =
        'Del archivo «' + escapeHtml(importarPendiente?.nombre || '') + '»: '
        + '<b>' + r.validas + '</b> de ' + r.filas + ' filas, '
        + '<b>' + r.suma.toLocaleString('es-ES') + '</b> puntos en total. '
        + 'Se leen las columnas <b>' + escapeHtml(r.columnas.nombre) + '</b> y <b>'
        + escapeHtml(r.columnas.puntos) + '</b>.'
        + (r.sinNombre || r.sinNumero
          ? ' <span class="aviso">Se saltan ' + (r.sinNombre + r.sinNumero) + ' fila(s) sin nombre o sin número.</span>'
          : '')
        + '<br><b>' + r.nuevos + '</b> se crean y a <b>' + r.yaEstaban + '</b> se les suma.'
        + '<div class="muestra">' + (r.muestra || []).map((m) =>
          '<span class="linea"><span class="n">' + escapeHtml(m.nombre) + '</span>'
          + (m.tenia === null ? 'nuevo' : m.tenia.toLocaleString('es-ES'))
          + ' → <b>' + ((m.tenia || 0) + m.puntos).toLocaleString('es-ES')
          + '</b></span>').join('') + '</div>'
        + '<span class="mandos" style="margin-top:.6rem">'
        + '<button type="button" id="puntosImportarAplicar">Cargar estos ' + r.validas + '</button>'
        + '<button type="button" class="btn-cancel" id="puntosImportarCancelar">Dejarlo</button>'
        + '</span>';

      document.getElementById('puntosImportarCancelar').addEventListener('click', () => {
        importarPendiente = null;
        caja.hidden = true;
      });

      document.getElementById('puntosImportarAplicar').addEventListener('click', async () => {
        if (!importarPendiente) return;
        const ok = await showModal({
          title: 'Cargar los puntos',
          message: 'Se crean ' + r.nuevos + ' y se les suman los puntos a ' + r.yaEstaban
            + ' que ya estaban. Si cargas el mismo archivo otra vez, se vuelven a sumar.',
          okText: 'Cargar'
        });
        if (!ok) return;
        const estado = document.getElementById('puntosImportarEstado');
        estado.textContent = 'Cargando…';
        try {
          const hecho = await api('/api/puntos/importar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl: importarPendiente.dataUrl, aplicar: true })
          });
          importarPendiente = null;
          caja.hidden = true;
          estado.textContent = 'Cargados ' + hecho.validas + '.';
          setTimeout(() => { estado.textContent = ''; }, 4000);
          await cargarPuntos();
        } catch (e) {
          estado.textContent = '';
          showAlert('No se pudo cargar', e.message);
        }
      });
    }

    async function cargarPuntos() {
      try {
        puntos = (await api('/api/puntos?limite=1000')).puntos || [];
      } catch (e) {
        document.getElementById('puntosTabla').innerHTML = '<div class="meta">No se pudieron cargar los puntos.</div>';
        return;
      }
      pintarPuntos();
    }

    function pintarPuntos() {
      const caja = document.getElementById('puntosTabla');
      const busca = (document.getElementById('puntosBuscar').value || '').trim().toLowerCase();
      // El puesto es el del marcador entero, aunque estés filtrando.
      const lista = puntos
        .map((p, i) => ({ ...p, puesto: i + 1 }))
        .filter((p) => !busca || p.nombre.toLowerCase().includes(busca));

      if (!lista.length) {
        caja.innerHTML = `<div class="meta">${puntos.length ? 'Nadie con ese nombre.' : 'Nadie tiene puntos todavía.'}</div>`;
        return;
      }

      const medallas = ['🥇', '🥈', '🥉'];
      caja.innerHTML = '';
      lista.forEach((p) => {
        const fila = document.createElement('div');
        fila.className = 'fila';
        fila.innerHTML = `
          <span class="puesto">${medallas[p.puesto - 1] || p.puesto}</span>
          <span class="nombre">${escapeHtml(p.nombre)}</span>
          <input type="number" class="editar" min="0" max="1000000000" value="${p.puntos}" aria-label="Puntos de ${escapeHtml(p.nombre)}" />
          <button type="button" class="quitar" title="Quitar del marcador">✕</button>`;

        const campo = fila.querySelector('.editar');
        // Se guarda al salir del campo o con Enter, no a cada tecla.
        const guardar = async () => {
          const valor = Math.max(0, Math.floor(Number(campo.value) || 0));
          if (valor === p.puntos) return;
          try {
            puntos = (await api('/api/puntos', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombre: p.nombre, puntos: valor })
            })).puntos;
            avisoPuntos(`${p.nombre}: ${valor} puntos.`);
            pintarPuntos();
          } catch (e) {
            showAlert('No se pudo guardar', e.message);
          }
        };
        campo.addEventListener('blur', guardar);
        campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') campo.blur(); });

        fila.querySelector('.quitar').addEventListener('click', async () => {
          const ok = await showConfirm('Quitar del marcador',
            `${p.nombre} pierde sus ${p.puntos} puntos. No se puede deshacer.`, 'Quitar', true);
          if (!ok) return;
          try {
            puntos = (await api(`/api/puntos/${encodeURIComponent(p.nombre)}`, { method: 'DELETE' })).puntos;
            pintarPuntos();
          } catch (e) {
            showAlert('No se pudo quitar', e.message);
          }
        });
        caja.appendChild(fila);
      });
    }

    function avisoPuntos(texto) {
      const donde = document.getElementById('puntosEstado');
      donde.textContent = texto;
      setTimeout(() => { if (donde.textContent === texto) donde.textContent = ''; }, 2500);
    }

    // Dar y quitar de golpe, para premiar o corregir sin buscar la fila.
    async function moverPuntos(signo) {
      const nombre = document.getElementById('puntosNombre').value.trim();
      const cuantos = Math.floor(Number(document.getElementById('puntosCuantos').value) || 0);
      if (!nombre) { showAlert('Falta el nombre', 'Escribe a quién se los das.'); return; }
      if (!cuantos) { showAlert('Falta la cantidad', 'Escribe cuántos puntos.'); return; }
      try {
        puntos = (await api('/api/puntos/sumar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, cuantos: cuantos * signo })
        })).puntos;
        avisoPuntos(`${signo > 0 ? '+' : '−'}${cuantos} a ${nombre}.`);
        document.getElementById('puntosNombre').value = '';
        pintarPuntos();
      } catch (e) {
        showAlert('No se pudo', e.message);
      }
    }

    document.getElementById('puntosDar').addEventListener('click', () => moverPuntos(1));
    document.getElementById('puntosQuitar').addEventListener('click', () => moverPuntos(-1));
    document.getElementById('puntosBuscar').addEventListener('input', pintarPuntos);

    document.getElementById('puntosVaciar').addEventListener('click', async () => {
      const ok = await showConfirm('Vaciar el marcador',
        `Los ${puntos.length} espectador(es) del marcador pierden sus puntos. No se puede deshacer.`, 'Vaciar', true);
      if (!ok) return;
      try {
        puntos = (await api('/api/puntos/vaciar', { method: 'POST' })).puntos;
        pintarPuntos();
      } catch (e) {
        showAlert('No se pudo vaciar', e.message);
      }
    });

    function vigilar(encender) {
      if (vigilante) { clearInterval(vigilante); vigilante = null; }
      // Mientras la inscripción está abierta se pregunta cada 2 s quién se ha
      // apuntado por el chat; el resto del tiempo no se molesta al servidor.
      if (encender) vigilante = setInterval(cargarCarrera, 2000);
    }

    document.getElementById('carreraAbrir').addEventListener('click', async () => {
      // El canal sale de Configuración; aquí solo se elige la palabra.
      try {
        carrera = await api('/api/carrera/abrir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            palabra: document.getElementById('carreraPalabra').value.trim(),
            segundos: segundosDe('carreraMinutos')
          })
        });
        document.getElementById('carreraPodio').hidden = true;
        document.getElementById('carreraRelato').hidden = true;
        pintarCarrera();
        vigilar(true);
      } catch (e) {
        showAlert('No se pudo abrir la carrera', e.message);
      }
    });

    document.getElementById('carreraCorrer').addEventListener('click', async () => {
      if (corriendo) return;
      corriendo = true;
      vigilar(false);
      pintarCarrera();
      let hecha;
      try {
        hecha = await api('/api/carrera/correr', { method: 'POST' });
      } catch (e) {
        corriendo = false;
        showAlert('No se pudo correr', e.message);
        pintarCarrera();
        return;
      }
      carrera = { ...carrera, ...hecha };
      const tarda = animarCarrera(hecha.resultado);
      setTimeout(() => {
        corriendo = false;
        pintarPodio(hecha.resultado);
        cargarPuntos();
        pintarCarrera();
        makeConfetti(30);
      }, tarda + 200);
    });

    document.getElementById('carreraRepetir').addEventListener('click', async () => {
      try {
        carrera = await api('/api/carrera/repetir', { method: 'POST' });
      } catch (e) {
        showAlert('No se pudo repetir', e.message);
        return;
      }
      // El podio y el relato anteriores sobran; la pista la redibuja
      // pintarCarrera() desde cero, así que las balineras vuelven a la salida.
      document.getElementById('carreraPodio').hidden = true;
      document.getElementById('carreraRelato').hidden = true;
      pintarCarrera();
      vigilar(true);
    });

    document.getElementById('carreraCancelar').addEventListener('click', async () => {
      try {
        carrera = await api('/api/carrera/cancelar', { method: 'POST' });
      } catch (e) { /* se repinta igual */ }
      vigilar(false);
      document.getElementById('carreraPista').hidden = true;
      pintarCarrera();
    });

    document.getElementById('carreraApuntar').addEventListener('click', async () => {
      const campo = document.getElementById('carreraNombre');
      const nombre = campo.value.trim();
      if (!nombre) return;
      try {
        carrera = await api('/api/carrera/apuntar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre })
        });
        campo.value = '';
        pintarCarrera();
      } catch (e) {
        showAlert('No se pudo apuntar', e.message);
      }
    });



