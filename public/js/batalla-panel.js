// El panel de la batalla de viewers: vigilar quien se apunta, pedirle al
// servidor que empiece o resuelva, y los botones del cuadro.
//
// Estaba dentro de dofus-arte.js, que es donde cayo al cortar index.html por
// el primer comentario del trozo. El arte lo comparten la batalla y el rey de
// la colina; esto de aqui es solo de la batalla, asi que el nombre de aquel
// archivo mentia sobre estas lineas.
//
// Sigue siendo un script normal, sin modulo, y va detras de dofus-arte.js,
// que es de donde saca contarRonda() y los dibujos.

    function vigilarBatalla(encender) {
      // Mientras se apuntan, el servidor avisa de quién ha entrado con su
      // código. Ver eventos.js.
      Eventos.vigilar('batalla', cargarBatalla, encender);
    }

    async function accionBatalla(ruta, cuerpo) {
      try {
        const r = await api(ruta, cuerpo ? {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
        } : { method: 'POST' });
        // Algunas respuestas traen solo el torneo, sin el arte: se conserva el
        // que ya había para no volver a los dibujos a mitad de ronda.
        batalla = { arte: batalla.arte, ...r };
        pintarBatalla();
        return true;
      } catch (e) {
        showAlert('Batalla', e.message);
        return false;
      }
    }

    document.getElementById('batallaAbrir').addEventListener('click', async () => {
      if (await accionBatalla('/api/batalla/abrir', { segundos: segundosDe('batallaMinutos') })) vigilarBatalla(true);
    });
    document.getElementById('batallaEmpezar').addEventListener('click', async () => {
      // Ya no se apunta nadie más: deja de preguntar.
      if (await accionBatalla('/api/batalla/empezar')) vigilarBatalla(false);
    });
    document.getElementById('batallaRonda').addEventListener('click', async () => {
      const boton = document.getElementById('batallaRonda');
      boton.disabled = true;
      // El servidor devuelve la ronda ya resuelta, con todos los golpes; aquí
      // se cuenta poco a poco y hasta el final no se dice quién ha ganado.
      const eraCampeon = batalla.campeon;
      // Los que estaban sin pelear: puede que alguno ya se soltara suelto, y
      // esos no hay que volver a contarlos.
      const antes = batalla.rondas[batalla.rondas.length - 1];
      const pendientes = (antes ? antes.duelos : [])
        .map((d, i) => (d.ganador ? -1 : i)).filter((i) => i >= 0);
      narrando = true;   // que no se repinte el cuadro y se destripe el final
      if (!await accionBatalla('/api/batalla/ronda')) {
        narrando = false;
        rondaNarrando = -1;
        pintarBatalla();
        return;
      }

      // La ronda que se acaba de resolver: la última si ya hay campeón, y la
      // penúltima si se ha creado otra detrás.
      const indice = batalla.rondas.length - (batalla.campeon ? 1 : 2);
      // Ya viene resuelta del servidor: se aparta de Combates hasta que acabe
      // de contarse, o desde ahi se leeria quien gana antes de verlo.
      rondaNarrando = indice;
      if (batalla.rondas[indice]) await contarRonda(batalla.rondas[indice], indice, pendientes);

      narrando = false;
      rondaNarrando = -1;
      pintarBatalla();
      if (batalla.campeon && !eraCampeon) {
        cargarPuntos();
        makeConfetti(30);
      }
    });
    // Soltar un combate concreto, el que se quiera ver ahora. La ronda no
    // avanza hasta que están todos peleados, se suelten en el orden que sea.
    async function pelearDuelo(di) {
      if (narrando) return;
      const indice = batalla.rondas.length - 1;
      const eraCampeon = batalla.campeon;
      narrando = true;
      rondaNarrando = indice;
      pintarBatalla();
      if (!await accionBatalla('/api/batalla/duelo', { duelo: di })) {
        narrando = false;
        rondaNarrando = -1;
        pintarBatalla();
        return;
      }
      // La ronda peleada es la que estaba antes de llamar: si con este combate
      // se acabó, el servidor habrá montado otra detrás, pero esta no se mueve.
      if (batalla.rondas[indice]) await contarRonda(batalla.rondas[indice], indice, [di]);
      narrando = false;
      rondaNarrando = -1;
      pintarBatalla();
      if (batalla.campeon && !eraCampeon) {
        cargarPuntos();
        makeConfetti(30);
      }
    }

    document.getElementById('batallaRepetir').addEventListener('click', async () => {
      // El cuadro se sortea de nuevo, así que no salen los mismos duelos.
      await accionBatalla('/api/batalla/repetir');
    });

    document.getElementById('batallaCancelar').addEventListener('click', async () => {
      await accionBatalla('/api/batalla/cancelar');
      vigilarBatalla(false);
    });
    // Pulsar un combate lo agranda; pulsarlo otra vez lo devuelve a su tamaño.
    // Delegado en el cuadro, que se repinta entero en cada ronda.
    document.getElementById('batallaCuadro').addEventListener('click', (ev) => {
      const caja = ev.target.closest('.duelo[data-ronda]');
      if (!caja) return;
      const clave = `${caja.dataset.ronda}:${caja.dataset.duelo}`;

      // El mando del combate va primero: si no, pulsarlo lo agrandaría.
      const pelear = ev.target.closest('.duelo-pelear');
      if (pelear) {
        pelearDuelo(Number(pelear.dataset.duelo));
        return;
      }

      // Un combate terminado no se pone en grande.
      if (caja.classList.contains('resuelto')) return;
      dueloAmpliado = dueloAmpliado === clave ? '' : clave;
      aplicarDueloAmpliado();
    });

    document.getElementById('batallaApuntar').addEventListener('click', async () => {
      const campo = document.getElementById('batallaNombre');
      if (!campo.value.trim()) return;
      if (await accionBatalla('/api/batalla/entrar', { nombre: campo.value.trim() })) campo.value = '';
    });
    document.getElementById('batallaGuardar').addEventListener('click', async () => {
      if (await accionBatalla('/api/batalla/config', { puntos: document.getElementById('batallaPuntos').value, palabra: document.getElementById('batallaPalabra').value })) {
        olvidarTocados(['batallaPalabra', 'batallaPuntos']);
        document.getElementById('batallaGuardado').textContent = 'Guardado.';
      }
    });
