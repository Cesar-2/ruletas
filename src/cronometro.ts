// Cronometro para cerrar una inscripcion a una hora. Lo usan la ruleta de
// nombres, la carrera y la batalla: al abrir se dice cuantos segundos quedan
// y, al llegar la hora, se avisa al minijuego para que deje de escuchar el
// chat. La hora de cierre se sigue recordando despues, para que la pagina
// pueda decir «inscripcion cerrada» y para rechazar a quien llegue tarde.
//
// Quien manda es el servidor, no la pagina: asi da igual que se recargue o
// que haya dos pestañas abiertas.

// Una hora como tope: una inscripcion mas larga no tiene sentido en directo.
const MAX_SEGUNDOS = 3600;

export class Cronometro {
  private cierres = new Map<string, number>();
  private temporizadores = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private alCerrar: (uid: string) => void) {}

  // Pone el cronometro. Con 0 (o nada) no hay limite y se quita el que hubiera.
  poner(uid: string, segundos: unknown): void {
    this.quitar(uid);
    const s = Math.max(0, Math.min(MAX_SEGUNDOS, Math.floor(Number(segundos) || 0)));
    if (!s) return;
    this.cierres.set(uid, Date.now() + s * 1000);
    this.temporizadores.set(uid, setTimeout(() => {
      this.temporizadores.delete(uid);
      this.alCerrar(uid);
    }, s * 1000));
  }

  // Vuelve a poner una hora de cierre que YA paso, sin temporizador: es para
  // recuperar tras un reinicio una inscripcion a la que se le paso la hora
  // mientras el servidor estaba apagado. No se avisa al minijuego, porque el
  // que rehace ya sabe que esa ronda esta cerrada; esto solo sirve para que
  // `vencido()` diga la verdad y la pagina siga poniendo «inscripcion
  // cerrada» en vez de parecer abierta de nuevo.
  rehacerVencido(uid: string, cierraEn: number): void {
    this.quitar(uid);
    const c = Math.floor(Number(cierraEn) || 0);
    if (c > 0 && Date.now() >= c) this.cierres.set(uid, c);
  }

  // Lo olvida del todo: al empezar, cancelar o cerrar a mano.
  quitar(uid: string): void {
    const t = this.temporizadores.get(uid);
    if (t) clearTimeout(t);
    this.temporizadores.delete(uid);
    this.cierres.delete(uid);
  }

  // Cuando se cierra (en milisegundos, reloj del servidor); 0 si no hay.
  cierraEn(uid: string): number {
    return this.cierres.get(uid) || 0;
  }

  // Si ya ha pasado la hora de cierre.
  vencido(uid: string): boolean {
    const c = this.cierraEn(uid);
    return c > 0 && Date.now() >= c;
  }
}
