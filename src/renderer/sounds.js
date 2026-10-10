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

  // Needle landing: a soft thump followed by a second of crackle.
  function needleDrop() {
    const c = audio();
    const t = c.currentTime;

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

  // Stop button: a low "power down" as the platter brakes.
  function powerDown() {
    const c = audio();
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.4);
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900;
    osc.connect(low).connect(envelope(c, t, 0.18, 0.01, 0.42)).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  const effects = { scratch, needleDrop, powerDown };

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
