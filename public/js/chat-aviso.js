// Decir en pantalla cuando la escucha del chat no va.
//
// Hasta ahora los cinco minijuegos ponían «Inscripción abierta en tucanal:
// escriben «!correr» para apuntarse» en cuanto se abría la ronda, y eso era una
// promesa que el servidor no podía cumplir: el nombre del canal se sabe desde el
// primer momento, pero que Twitch te deje leer ese chat no.
//
// Con una letra de más en el nombre del canal, el socket abre igual y Twitch se
// calla. Así que la página decía que estaba escuchando, el chat escribía, no
// pasaba nada, y no había forma de saber por qué. Ver chat.ts.
//
// El texto lo escribe el servidor (chat.Salud.problema), no esto: el diagnóstico
// está donde se sabe lo que pasó, y así los cinco minijuegos dicen lo mismo con
// las mismas palabras.

(function () {
  'use strict';

  // Pone (o quita) el aviso justo debajo de la línea de estado de un minijuego.
  //
  // El elemento del aviso se crea al vuelo la primera vez, así que esto no pide
  // tocar el HTML de los cinco paneles.
  //
  //   idEstado  el elemento donde el panel escribe su «Inscripción abierta…»
  //   salud     lo que manda el servidor en estado.chat, o null si no se escucha
  function avisarChat(idEstado, salud) {
    const donde = document.getElementById(idEstado);
    if (!donde) return;

    const id = idEstado + 'ChatAviso';
    let aviso = document.getElementById(id);
    const problema = salud && salud.problema ? String(salud.problema) : '';

    if (!problema) {
      // Sin nada que decir se quita del todo, y no solo se vacía: un hueco con
      // borde debajo del estado se lee como que algo va mal.
      if (aviso) aviso.remove();
      return;
    }

    if (!aviso) {
      aviso = document.createElement('div');
      aviso.id = id;
      aviso.className = 'chat-aviso';
      // Se anuncia sin robar el foco: quien use lector de pantalla se entera de
      // que el chat no va sin perder donde estaba.
      aviso.setAttribute('role', 'status');
      aviso.setAttribute('aria-live', 'polite');
      donde.insertAdjacentElement('afterend', aviso);
    }
    // Lo grave se ve; lo que solo está pasando (los dos segundos de entrar) va
    // apagado, que si no la pantalla parpadea en rojo cada vez que se abre una
    // ronda y se acaba no mirando los avisos.
    aviso.classList.toggle('grave', Boolean(salud.grave));
    aviso.textContent = problema;
  }

  window.avisarChat = avisarChat;
})();
