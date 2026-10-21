// Los turnos de la Ruleta de objetos: quien ha canjeado la recompensa de puntos
// del canal que crea el Ruletón (Configuración › Twitch). Su nombre va solo al
// «Nombre del ganador» y el streamer le da a sortear en directo, como con los
// cartones del bingo: canjeas y sale tu nombre. Ver src/turnosruleta.ts.
//
// Solo se pone un nombre cuando el campo está libre: vacío, o con el del
// último ganador ya guardado. Nunca encima de un sorteo sin guardar ni de un
// nombre que se esté escribiendo a mano. Los demás esperan en la fila, con
// «Poner» para adelantar uno y ✕ para quitarlo (Twitch le devuelve los puntos).
//
// Script normal, sin módulo, como los demás paneles: usa api(), showAlert(),
// showConfirm(), actualizarBotonSortear() y `sorteando` de index.html.

    let turnosRuleta = [];
    // El último ganador guardado: su nombre se queda en el campo, pero ya no
    // es de nadie, así que el siguiente de la fila lo puede pisar.
    let ultimoGuardadoRuleta = '';
    let tomandoTurno = false;
    let vigilandoTurnos = false;

    async function cargarTurnosRuleta() {
      if (!vigilandoTurnos) {
        vigilandoTurnos = true;
        // El servidor avisa al momento de cada canje. Ver eventos.js.
        Eventos.vigilar('turnos', cargarTurnosRuleta, true);
      }
      try {
        turnosRuleta = (await api('/api/ruleta/turnos')).turnos || [];
      } catch (e) {
        console.warn('No se pudieron leer los turnos de la ruleta:', e.message);
        return;
      }
      pintarTurnosRuleta();
      tomarTurnoSiToca();
    }

    function campoGanadorLibre() {
      const campo = document.getElementById('winnerName');
      const v = campo.value.trim();
      return !campo.readOnly && !sorteando && (!v || (ultimoGuardadoRuleta && v === ultimoGuardadoRuleta));
    }

    function tomarTurnoSiToca() {
      if (turnosRuleta.length && !tomandoTurno && campoGanadorLibre()) tomarTurno(turnosRuleta[0]);
    }

    // Se ha guardado un ganador (ver guardarGanador en index.html): el campo
    // queda libre para el siguiente.
    function turnoRuletaGuardado(nombre) {
      ultimoGuardadoRuleta = String(nombre || '').trim();
      tomarTurnoSiToca();
    }

    // Su nombre a la ruleta. En Twitch el canje queda cumplido.
    async function tomarTurno(t) {
      const campo = document.getElementById('winnerName');
      tomandoTurno = true;
      campo.value = t.nombre;
      actualizarBotonSortear();
      turnosRuleta = turnosRuleta.filter((x) => x.id !== t.id);
      pintarTurnosRuleta();
      try {
        const r = await ruletaPedir('/api/ruleta/turnos/tomar', t.id);
        turnosRuleta = r.turnos || [];
        pintarTurnosRuleta();
      } catch (e) {
        showAlert('Ruleta de objetos', 'No se pudo sacar a ' + t.nombre + ' de la fila: ' + e.message);
      } finally {
        tomandoTurno = false;
      }
    }

    function ruletaPedir(ruta, id) {
      return api(ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
    }

    function pintarTurnosRuleta() {
      const caja = document.getElementById('turnosRuleta');
      caja.hidden = !turnosRuleta.length;
      caja.innerHTML = '';
      if (!turnosRuleta.length) return;
      const titulo = document.createElement('span');
      titulo.textContent = '🎟️ Han canjeado la ruleta:';
      caja.appendChild(titulo);
      turnosRuleta.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'turno';
        const nombre = document.createElement('span');
        nombre.textContent = t.nombre;
        const poner = document.createElement('button');
        poner.type = 'button';
        poner.textContent = '▶ Poner';
        poner.title = 'Poner su nombre en la ruleta';
        poner.addEventListener('click', () => {
          if (sorteando || document.getElementById('winnerName').readOnly) {
            showAlert('Hay un sorteo sin guardar', 'Guarda al ganador o descarta el sorteo antes de poner a ' + t.nombre + '.');
            return;
          }
          tomarTurno(t);
        });
        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'btn-cancel';
        quitar.textContent = '✕';
        quitar.title = 'Quitarlo de la fila: Twitch le devuelve los puntos';
        quitar.setAttribute('aria-label', 'Quitar a ' + t.nombre + ' de la fila');
        quitar.addEventListener('click', async () => {
          const ok = await showConfirm('Quitar de la fila',
            t.nombre + ' sale de la fila sin girar la ruleta y Twitch le devuelve los puntos.', 'Quitar', true);
          if (!ok) return;
          try {
            const r = await ruletaPedir('/api/ruleta/turnos/quitar', t.id);
            turnosRuleta = r.turnos || [];
            pintarTurnosRuleta();
            if (r.turno && !r.twitchOk) {
              showAlert('Puntos sin devolver', 'Twitch no dejó devolverle los puntos a ' + t.nombre
                + '. Puedes devolvérselos a mano desde la cola de canjes de tu canal.');
            }
          } catch (e) {
            showAlert('Ruleta de objetos', e.message);
          }
        });
        chip.append(nombre, poner, quitar);
        caja.appendChild(chip);
      });
    }

    // Si la sesión ya estaba abierta cuando cargó este archivo, arrancarRuleton()
    // pudo pasar antes de que existiera cargarTurnosRuleta.
    if (typeof usuario !== 'undefined' && usuario) cargarTurnosRuleta();
