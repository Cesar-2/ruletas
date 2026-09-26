// La ronda que estaba abierta, guardada en disco para que sobreviva a un
// reinicio.
//
// Los minijuegos llevaban su partida solo en memoria, en un Map. Eso vale
// mientras el servidor no se mueva, pero se mueve: un despliegue, una caida, o
// en desarrollo cada vez que se guarda un archivo (ts-node-dev respawnea). Y
// cuando se movia, una inscripcion con cuarenta personas apuntadas se perdia a
// mitad del directo, sin aviso y sin manera de recuperarla. El streamer tenia
// que pedir al chat que se apuntara otra vez.
//
// Asi que cada minijuego guarda una foto de lo que tiene vivo y, al arrancar,
// la recupera: los apuntados, el canal que estaba escuchando, la palabra y lo
// que quedaba de cronometro.
//
// Lo que NO se guarda es el relleno de las repeticiones (las marcas tick a
// tick de la carrera, la caida de cada bola del plinko). Son miles de numeros
// que solo sirven para animar un resultado que ya se vio en pantalla; si un
// reinicio pilla justo ahi, la pagina enseña el resultado sin la animacion, y
// eso no es una perdida que merezca escribir medio megabyte cada vez.

import fs from 'fs';
import path from 'path';

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
}

// Mas vieja que esto, la foto se tira. Un directo dura horas, no dias: que
// reaparezca en pantalla una ronda del martes es peor que haberla perdido,
// porque nadie entiende de donde ha salido ni por que el chat no responde.
const CADUCA_MS = 12 * 60 * 60 * 1000;

export interface Foto<T> {
  // Lo que el minijuego tenga por estado, tal cual.
  estado: T;
  // El canal del chat que se estaba escuchando, o '' si no habia escucha.
  canal: string;
  // La palabra con la que se apunta la gente. Va aparte del estado porque la
  // escucha la necesita para rehacerse, y los ajustes pueden haber cambiado
  // desde que se abrio la ronda.
  palabra: string;
  // Cuando se cierra la inscripcion (ms del reloj del servidor); 0 si no hay
  // cronometro. Se guarda la hora y no los segundos que quedaban: asi el
  // tiempo que el servidor pasa apagado cuenta, que es lo que espera quien
  // esta mirando el reloj del directo.
  cierraEn: number;
}

interface Guardada<T> extends Foto<T> {
  v: number;
  guardadoEn: number;
}

export class Vivo<T> {
  // `deps` es una funcion y no un objeto porque el minijuego llama a
  // `iniciar()` despues de construir esto.
  constructor(private nombre: string, private deps: () => Dependencias) {}

  private archivo(uid: string): string {
    return path.join(this.deps().userDir(uid), `vivo-${this.nombre}.json`);
  }

  guardar(uid: string, foto: Foto<T>): void {
    try {
      this.deps().ensureUserDir(uid);
      const guardada: Guardada<T> = { v: 1, ...foto, guardadoEn: Date.now() };
      this.deps().writeJson(this.archivo(uid), guardada);
    } catch (err) {
      // Que no se pueda guardar no puede tumbar la ronda que esta en marcha:
      // se pierde la red de seguridad, no la partida.
      console.error(`Failed to save live ${this.nombre}:`, err);
    }
  }

  // La foto de esa cuenta, o null si no hay, esta caducada o no se entiende.
  // Una foto que no se entiende se borra: reintentarla en cada arranque no la
  // va a arreglar.
  leer(uid: string): Foto<T> | null {
    const f = this.archivo(uid);
    try {
      if (!fs.existsSync(f)) return null;
      const crudo = JSON.parse(fs.readFileSync(f, 'utf8')) as Guardada<T>;
      if (!crudo || typeof crudo !== 'object' || crudo.v !== 1 || !crudo.estado) {
        this.borrar(uid);
        return null;
      }
      if (Date.now() - (Number(crudo.guardadoEn) || 0) > CADUCA_MS) {
        this.borrar(uid);
        return null;
      }
      return {
        estado: crudo.estado,
        canal: String(crudo.canal || ''),
        palabra: String(crudo.palabra || ''),
        cierraEn: Number(crudo.cierraEn) || 0
      };
    } catch (err) {
      console.error(`Failed to read live ${this.nombre}:`, err);
      this.borrar(uid);
      return null;
    }
  }

  borrar(uid: string): void {
    try {
      fs.rmSync(this.archivo(uid), { force: true });
    } catch (err) {
      console.error(`Failed to drop live ${this.nombre}:`, err);
    }
  }
}

// Los segundos que le quedan a un cierre guardado, para volver a poner el
// cronometro. 0 si no habia cronometro; -1 si ya se le paso la hora mientras
// el servidor estaba apagado, que el minijuego trata como «ya cerro».
export function quedanSegundos(cierraEn: number): number {
  if (!cierraEn) return 0;
  const ms = cierraEn - Date.now();
  if (ms <= 0) return -1;
  // Hacia arriba: con 900ms de sobra quedan 1s, no 0, que seria «sin limite».
  return Math.max(1, Math.ceil(ms / 1000));
}
