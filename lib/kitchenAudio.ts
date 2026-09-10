// Web Audio ile sentezlenen mikro efektler — ses dosyası yok, her şey anlık üretiliyor.
// Tarayıcılar kullanıcı etkileşimi olmadan ses açmaya izin vermediği için
// AudioContext ilk etkileşimde (unlockAudio) kuruluyor ve açılıyor.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

/**
 * Askıya alınmış context'i açar; ses gerçekten çalabiliyorsa `true` döner.
 *
 * Tarayıcı, kullanıcı sayfayla etkileşmeden ses çalmaya izin vermez. Bu yüzden
 * panel bunu iki yerden çağırır: açılışta (sayfa daha önce etkileşim görmüşse
 * hemen açılır) ve ilk dokunuş/tuşta. Dönen değer, "ses açık" rozetinin
 * yalan söylememesi için gerekli — `resume()` sessizce reddedilebilir.
 */
export async function unlockAudio(): Promise<boolean> {
  const c = ensureContext();
  if (!c) return false;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  return c.state === "running";
}

/** Ses şu anda çalınabilir durumda mı — context kurulmamışsa kurmaz. */
export function audioReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

function whiteNoise(c: AudioContext) {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.4);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}

/**
 * Katmanın yığına oturması: kısa, tok bir vuruş.
 * `pitch` 0→1 arası; üst katmanlar biraz daha tiz duyulsun diye.
 */
export function playLayerThud(pitch = 0.5) {
  const c = ensureContext();
  if (!c || !master || c.state !== "running") return;
  const t = c.currentTime;

  // gövde: hızla düşen sinüs
  const osc = c.createOscillator();
  osc.type = "sine";
  const base = 96 + pitch * 54;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 0.45, t + 0.16);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);

  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.26);

  // çıtırtı: kısa filtrelenmiş gürültü
  const n = whiteNoise(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800 + pitch * 900;
  bp.Q.value = 0.9;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.09, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

  n.connect(bp).connect(ng).connect(master);
  n.start(t);
  n.stop(t + 0.1);
}

/** Sos katmanı: ince, ıslak bir damla. */
export function playDrip() {
  const c = ensureContext();
  if (!c || !master || c.state !== "running") return;
  const t = c.currentTime;

  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(680, t);
  osc.frequency.exponentialRampToValueAtTime(1500, t + 0.05);
  osc.frequency.exponentialRampToValueAtTime(420, t + 0.16);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.22);
}

/**
 * Yeni sipariş uyarısı — panelde çalar.
 *
 * İki tonlu, yükselen kısa bir zil. Mutfakta gürültü olduğu için diğer
 * efektlerden belirgin biçimde yüksek ve tiz tutulur; kısa olması da önemli,
 * çünkü sipariş onaylanana kadar düzenli aralıklarla tekrar çalınır.
 *
 * `unlockAudio` başarıyla çağrılmadan sessizdir: tarayıcı, kullanıcı etkileşimi
 * olmadan ses çalmaya izin vermez. Panel bunu kendi kendine dener — açılışta ve
 * ilk dokunuş/tuşta — kullanıcıdan ayrıca bir düğmeye basmasını beklemez.
 */
export function playOrderAlert() {
  const c = ensureContext();
  if (!c || !master || c.state !== "running") return;

  // `master` modül düzeyinde bir `let`; geri çağırım içinde daraltma korunmaz,
  // bu yüzden yerel bir sabite alınır.
  const out = master;
  const t = c.currentTime;
  const notes = [880, 1320];

  notes.forEach((freq, i) => {
    const at = t + i * 0.16;
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, at);

    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.9, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);

    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + 0.36);
  });
}
