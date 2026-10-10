// Little turntable sound effects, synthesised with Web Audio (no audio files).
window.Sounds = (() => {
  let ctx = null;
  let enabled = true;

  const audio = () => (ctx ??= new AudioContext());

  function noise(c, seconds, fill = () => Math.random() * 2 - 1) {
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = fill(i);
    const src = c.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  function envelope(c, t, peak, attack, decay) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  // A quick "wikka" record scratch. direction 1 = forward (next), -1 = back (previous).
  function scratch(direction = 1) {
    const c = audio();
    const t = c.currentTime;
    const src = noise(c, 0.32);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 7;
    const [a, b, z] = direction > 0 ? [500, 2800, 700] : [2600, 450, 1400];
    band.frequency.setValueAtTime(a, t);
    band.frequency.exponentialRampToValueAtTime(b, t + 0.11);
    band.frequency.exponentialRampToValueAtTime(z, t + 0.26);
    src.connect(band).connect(envelope(c, t, 0.5, 0.015, 0.28)).connect(c.destination);
    src.start(t);
  }

  // The classic needle-dragged-across-the-grooves "rrrrip".
  // direction -1 = needle coming off (pitch falls), 1 = needle going on (pitch rises).
  function needleScratch(direction, t, length = 0.38) {
    const c = audio();
    const [f0, f1] = direction < 0 ? [3200, 550] : [650, 2800];
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(f0, t);
    band.frequency.exponentialRampToValueAtTime(f1, t + length);

    // Chop the noise with a square wave so it rasps like grooves passing under the needle.
    const rasp = c.createGain();
    rasp.gain.value = 0.5;
    const grooves = c.createOscillator();
    grooves.type = 'square';
    grooves.frequency.setValueAtTime(direction < 0 ? 75 : 28, t);
    grooves.frequency.linearRampToValueAtTime(direction < 0 ? 22 : 75, t + length);
    const depth = c.createGain();
    depth.gain.value = 0.5;
    grooves.connect(depth).connect(rasp.gain);

    // A little pitched "zip" underneath.
    const zip = c.createOscillator();
    zip.type = 'sawtooth';
    zip.frequency.setValueAtTime(direction < 0 ? 720 : 160, t);
    zip.frequency.exponentialRampToValueAtTime(direction < 0 ? 110 : 680, t + length);
    const zipLevel = c.createGain();
    zipLevel.gain.value = 0.1;

    const src = noise(c, length + 0.05);
    const out = envelope(c, t, 0.6, 0.01, length);
    src.connect(band);
    zip.connect(zipLevel).connect(band);
    band.connect(rasp).connect(out).connect(c.destination);
    for (const node of [src, grooves, zip]) {
      node.start(t);
      node.stop(t + length + 0.05);
    }
  }

  // Needle off the record (pause).
  function needleOff() {
    needleScratch(-1, audio().currentTime);
  }

  // Needle onto the record (play): scratch in, a soft thump, then a second of crackle.
  function needleOn() {
    const c = audio();
    needleScratch(1, c.currentTime, 0.28);
    const t = c.currentTime + 0.26;

    const thump = c.createOscillator();
    thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    thump.connect(envelope(c, t, 0.35, 0.005, 0.16)).connect(c.destination);
    thump.start(t);
    thump.stop(t + 0.2);

    const crackle = noise(c, 1.1, () =>
      Math.random() < 0.0015 ? Math.random() * 2 - 1 : (Math.random() * 2 - 1) * 0.015);
    const high = c.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1200;
    crackle.connect(high).connect(envelope(c, t + 0.04, 0.45, 0.05, 1)).connect(c.destination);
    crackle.start(t + 0.04);
  }

  const effects = { scratch, needleOn, needleOff };

  return {
    play(name, ...args) {
      if (!enabled) return;
      try {
        effects[name](...args);
      } catch (err) {
        console.warn('Sound failed:', err);
      }
    },
    setEnabled(value) {
      enabled = value;
    },
  };
})();
