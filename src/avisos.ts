// Avisar de que algo cambio, para que la pantalla no tenga que preguntar.
//
// Antes cada panel preguntaba cada dos segundos: la pagina abierta con tres
// widgets en OBS eran unas dos peticiones por segundo por cliente aunque no
// pasara nada. Y al reves, cuando pasaba algo se tardaba hasta dos segundos en
// verlo, que en un sorteo en directo se nota.
//
// Ahora el servidor avisa. Cada minijuego dice «he cambiado» donde ya guardaba
// su foto, y esto se lo cuenta a quien este mirando esa cuenta.
//
// Lo que se manda por el canal es solo QUE minijuego cambio, no su estado: el
// que escucha pide el estado como siempre. Asi no hay dos maneras distintas de
// armar la misma respuesta, que es como se acaba enseñando una cosa en la
// pagina y otra en el widget.

// 'widgets' no es un minijuego: es el aviso de que el dueño ha cambiado como se
// ven sus widgets, para que los que esten puestos en OBS lo cojan al momento.
export type Juego = 'carrera' | 'plinko' | 'batalla' | 'colina' | 'nombres' | 'sorteo' | 'bingo' | 'widgets';

export const JUEGOS: Juego[] = ['carrera', 'plinko', 'batalla', 'colina', 'nombres', 'sorteo', 'bingo', 'widgets'];

type Oyente = (juego: Juego) => void;

// uid -> quienes estan mirando esa cuenta. Es un Set y no una lista porque lo
// que se hace todo el rato es quitar al que cierra la pestaña.
const oyentes = new Map<string, Set<Oyente>>();

// Se pone a escuchar los cambios de una cuenta. Devuelve la funcion de dejar de
// escuchar, que HAY que llamar al cerrarse la conexion: si no, cada pestaña que
// se cierra deja aqui un oyente muerto al que se seguiria avisando.
export function escuchar(uid: string, oyente: Oyente): () => void {
  let suyos = oyentes.get(uid);
  if (!suyos) { suyos = new Set(); oyentes.set(uid, suyos); }
  suyos.add(oyente);
  return () => {
    const s = oyentes.get(uid);
    if (!s) return;
    s.delete(oyente);
    // Sin nadie mirando, fuera la entrada: esto se recorre por cuenta y no
    // interesa que crezca con las cuentas que ya no tienen a nadie.
    if (!s.size) oyentes.delete(uid);
  };
}

// Un minijuego ha cambiado. Se llama muchas veces seguidas (cuarenta personas
// apuntandose son cuarenta avisos), asi que quien escucha es el que junta los
// avisos seguidos; aqui no se guarda nada ni se espera a nadie.
export function cambio(uid: string, juego: Juego): void {
  const suyos = oyentes.get(uid);
  if (!suyos || !suyos.size) return;
  for (const oyente of Array.from(suyos)) {
    try {
      oyente(juego);
    } catch (err) {
      // Un oyente roto (una conexion que se acaba de cortar) no puede impedir
      // que se avise a los demas ni tumbar la partida que provoco el aviso.
      console.error('Failed to notify listener:', err);
    }
  }
}

// Como escuchar de verdad: juntando los avisos seguidos.
//
// Cuarenta personas apuntandose son cuarenta cambios en un segundo, y mandar
// cuarenta avisos solo haria que el que escucha pidiera el estado cuarenta
// veces para pintar lo mismo. Se espera un pelin y se manda una sola vez lo que
// haya cambiado, sin repetidos.
//
// Esto vive aqui y no en el canal porque es de los avisos, no de como se
// escriben: asi se puede probar sin levantar un servidor.
//
//   esperaMs  cuanto se junta antes de soltar
//   alSoltar  se llama con los juegos que han cambiado, cada uno una vez
//
// Devuelve la funcion de dejar de escuchar, que HAY que llamar al cerrarse:
// suelta el oyente y tambien la espera a medias, que si no se queda un
// temporizador apuntando a una conexion que ya no esta.
export function escucharJuntando(
  uid: string,
  esperaMs: number,
  alSoltar: (juegos: Juego[]) => void
): () => void {
  let pendientes = new Set<Juego>();
  let espera: ReturnType<typeof setTimeout> | null = null;

  const soltar = escuchar(uid, (juego) => {
    pendientes.add(juego);
    if (espera) return;
    espera = setTimeout(() => {
      espera = null;
      const cuales = Array.from(pendientes);
      pendientes = new Set();
      alSoltar(cuales);
    }, esperaMs);
  });

  return () => {
    if (espera) { clearTimeout(espera); espera = null; }
    pendientes = new Set();
    soltar();
  };
}

// Cuantos estan mirando ahora mismo, para poder decirlo en el arranque y en los
// registros cuando algo va raro.
export function cuantos(): number {
  let n = 0;
  for (const s of oyentes.values()) n += s.size;
  return n;
}
