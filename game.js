(() => {
  "use strict";

  // ------------------------------------------------------------------
  // Konfigurasi
  // ------------------------------------------------------------------
  const W = 480;
  const H = 640;

  const GROUND_H = 96;
  const GROUND_Y = H - GROUND_H;

  const GRAVITY = 1650;
  const FLAP_VY = -470;
  const MAX_VY = 900;

  const PIPE_W = 74;
  const PIPE_SPACING = 245;
  const GAP_START = 172;
  const GAP_MIN = 128;
  const GAP_SHRINK_PER_SCORE = 1.1;

  const SPEED_START = 165;
  const SPEED_MAX = 300;
  const SPEED_PER_SCORE = 3.2;

  const BIRD_X = W * 0.3;
  const BIRD_R = 17;

  const STORAGE_KEY = "flappy-highscore";
  const SOUND_KEY = "flappy-sound";

  const STATE = { MENU: "menu", PLAYING: "playing", DYING: "dying", OVER: "over" };

  // ------------------------------------------------------------------
  // Canvas
  // ------------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------
  const overlay = document.getElementById("overlay");
  const menuPanel = document.getElementById("menu-panel");
  const overPanel = document.getElementById("over-panel");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const newBestEl = document.getElementById("new-best");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");
  const soundBtn = document.getElementById("sound-btn");

  // ------------------------------------------------------------------
  // Audio (Web Audio API, tanpa file)
  // ------------------------------------------------------------------
  const Sound = {
    ctx: null,
    enabled: localStorage.getItem(SOUND_KEY) !== "off",

    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    },

    tone(freqFrom, freqTo, dur, type, vol, delay = 0) {
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freqFrom, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    noise(dur, vol) {
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime;
      const len = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1400;
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(t0);
    },

    flap() {
      this.tone(560, 880, 0.1, "square", 0.16);
    },

    score() {
      this.tone(740, 740, 0.07, "square", 0.14);
      this.tone(1040, 1040, 0.13, "square", 0.14, 0.08);
    },

    hit() {
      this.noise(0.28, 0.32);
      this.tone(220, 70, 0.35, "sawtooth", 0.2);
    },

    die() {
      this.tone(400, 90, 0.5, "triangle", 0.16, 0.18);
    },

    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem(SOUND_KEY, this.enabled ? "on" : "off");
      if (this.enabled) this.ensure();
      return this.enabled;
    },
  };

  // ------------------------------------------------------------------
  // Aset latar (digambar ke offscreen canvas sekali)
  // ------------------------------------------------------------------
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // Layer awan (di-wrap)
  const cloudTileW = W;
  const cloudTile = (() => {
    const c = makeCanvas(cloudTileW, GROUND_Y);
    const g = c.getContext("2d");
    const puffs = [
      [60, 90, 34], [95, 82, 26], [130, 92, 30],
      [250, 150, 26], [278, 143, 20], [305, 152, 23],
      [400, 60, 30], [430, 54, 24], [455, 64, 20],
      [170, 220, 22], [196, 214, 17],
      [340, 250, 25], [368, 243, 19],
    ];
    for (const [x, y, r] of puffs) {
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  })();

  // Layer gedung (di-wrap)
  const cityTileW = W;
  const cityTile = (() => {
    const c = makeCanvas(cityTileW, GROUND_Y);
    const g = c.getContext("2d");
    let x = -10;
    let i = 0;
    while (x < cityTileW + 10) {
      const w = 34 + ((i * 37) % 40);
      const h = 70 + ((i * 53) % 140);
      const shade = 70 + ((i * 29) % 30);
      g.fillStyle = `rgb(${shade - 30},${shade - 10},${shade + 30})`;
      g.fillRect(x, GROUND_Y - h, w, h);
      g.fillStyle = "rgba(255,235,150,0.55)";
      for (let wy = GROUND_Y - h + 12; wy < GROUND_Y - 14; wy += 20) {
        for (let wx = x + 8; wx < x + w - 10; wx += 16) {
          if ((wx + wy + i) % 3 !== 0) g.fillRect(wx, wy, 7, 9);
        }
      }
      x += w + 6;
      i++;
    }
    return c;
  })();

  // Layer tanah (di-wrap)
  const groundTileW = 48;
  const groundTile = (() => {
    const c = makeCanvas(groundTileW, GROUND_H);
    const g = c.getContext("2d");
    g.fillStyle = "#ded895";
    g.fillRect(0, 0, groundTileW, GROUND_H);
    g.fillStyle = "#73bf2e";
    g.fillRect(0, 0, groundTileW, 14);
    g.fillStyle = "#5aa524";
    for (let i = -GROUND_H; i < groundTileW; i += 18) {
      g.beginPath();
      g.moveTo(i, 14);
      g.lineTo(i + 9, 14);
      g.lineTo(i + 9 - 14, GROUND_H);
      g.lineTo(i - 14, GROUND_H);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fillRect(0, GROUND_H - 8, groundTileW, 8);
    return c;
  })();

  // ------------------------------------------------------------------
  // State game
  // ------------------------------------------------------------------
  const game = {
    state: STATE.MENU,
    started: false,
    score: 0,
    best: parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10) || 0,
    time: 0,
    dyingAt: 0,
    pipes: [],
    bgCloud: 0,
    bgCity: 0,
    bgGround: 0,
    shake: 0,
  };

  const bird = {
    x: BIRD_X,
    y: H * 0.42,
    vy: 0,
    rot: 0,
    wing: 0,
  };

  function speed() {
    return Math.min(SPEED_MAX, SPEED_START + game.score * SPEED_PER_SCORE);
  }

  function gapSize() {
    return Math.max(GAP_MIN, GAP_START - game.score * GAP_SHRINK_PER_SCORE);
  }

  function reset() {
    game.score = 0;
    game.started = false;
    game.pipes.length = 0;
    game.shake = 0;
    bird.y = H * 0.42;
    bird.vy = 0;
    bird.rot = 0;
    scoreEl.textContent = "0";
  }

  function spawnPipe() {
    const gap = gapSize();
    const margin = 60;
    const minTop = margin;
    const maxTop = GROUND_Y - gap - margin;
    const top = minTop + Math.random() * Math.max(1, maxTop - minTop);
    game.pipes.push({ x: W + 20, gapTop: top, gap: gap, scored: false });
  }

  function startGame() {
    reset();
    game.state = STATE.PLAYING;
    overlay.classList.add("hidden");
    hud.classList.remove("hidden");
  }

  function showMenu() {
    game.state = STATE.MENU;
    reset();
    menuPanel.classList.remove("hidden");
    overPanel.classList.add("hidden");
    overlay.classList.remove("hidden");
    hud.classList.add("hidden");
  }

  function endGame() {
    game.state = STATE.OVER;
    const isNew = game.score > game.best;
    if (isNew) {
      game.best = game.score;
      localStorage.setItem(STORAGE_KEY, String(game.best));
    }
    finalScoreEl.textContent = game.score;
    bestScoreEl.textContent = game.best;
    newBestEl.classList.toggle("hidden", !isNew);
    menuPanel.classList.add("hidden");
    overPanel.classList.remove("hidden");
    overlay.classList.remove("hidden");
    hud.classList.add("hidden");
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------
  function flap() {
    if (game.state === STATE.MENU) {
      startGame();
      bird.vy = FLAP_VY;
      game.started = true;
      Sound.flap();
      return;
    }
    if (game.state === STATE.PLAYING) {
      bird.vy = FLAP_VY;
      game.started = true;
      Sound.flap();
    }
  }

  function onPrimaryAction(e) {
    if (e && e.cancelable) e.preventDefault();
    if (game.state === STATE.OVER) return;
    Sound.ensure();
    flap();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      if (e.repeat) return;
      if (game.state === STATE.OVER) return;
      Sound.ensure();
      flap();
    }
  });

  canvas.addEventListener("mousedown", onPrimaryAction);
  canvas.addEventListener("touchstart", onPrimaryAction, { passive: false });

  startBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    Sound.ensure();
    startGame();
  });

  retryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    Sound.ensure();
    startGame();
  });

  soundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = Sound.toggle();
    soundBtn.textContent = on ? "🔊" : "🔇";
  });
  soundBtn.textContent = Sound.enabled ? "🔊" : "🔇";

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------
  function collidePipe(p) {
    const inX = bird.x + BIRD_R - 3 > p.x && bird.x - BIRD_R + 3 < p.x + PIPE_W;
    if (!inX) return false;
    const r = BIRD_R - 3;
    const topHit = bird.y - r < p.gapTop;
    const botHit = bird.y + r > p.gapTop + p.gap;
    return topHit || botHit;
  }

  function die() {
    game.state = STATE.DYING;
    game.dyingAt = game.time;
    bird.vy = Math.min(bird.vy, -140);
    game.shake = 14;
    Sound.hit();
    Sound.die();
  }

  function update(dt) {
    game.time += dt;
    bird.wing += dt * 14;

    const s = speed();

    if (game.state === STATE.MENU) {
      bird.y = H * 0.42 + Math.sin(game.time * 3) * 10;
      bird.rot = Math.sin(game.time * 3) * 0.08;
      game.bgCloud += 12 * dt;
      game.bgCity += 24 * dt;
      game.bgGround += s * dt;
      return;
    }

    if (game.state === STATE.PLAYING) {
      game.bgCloud += 14 * dt;
      game.bgCity += 30 * dt;
      game.bgGround += s * dt;

      // state siap: burung melayang sampai input pertama
      if (!game.started) {
        bird.y = H * 0.42 + Math.sin(game.time * 3) * 9;
        bird.rot = Math.sin(game.time * 3) * 0.07;
        return;
      }

      bird.vy = Math.min(MAX_VY, bird.vy + GRAVITY * dt);
      bird.y += bird.vy * dt;

      const target = Math.max(-0.5, Math.min(1.35, bird.vy / 420));
      bird.rot += (target - bird.rot) * Math.min(1, dt * 9);

      if (bird.y < BIRD_R + 4) {
        bird.y = BIRD_R + 4;
        bird.vy = 0;
      }

      if (bird.y + BIRD_R >= GROUND_Y) {
        bird.y = GROUND_Y - BIRD_R;
        die();
        return;
      }

      if (game.started) {
        if (game.pipes.length === 0 || game.pipes[game.pipes.length - 1].x <= W - PIPE_SPACING) {
          spawnPipe();
        }

        for (const p of game.pipes) {
          p.x -= s * dt;
          if (!p.scored && p.x + PIPE_W < bird.x - BIRD_R) {
            p.scored = true;
            game.score++;
            scoreEl.textContent = game.score;
            Sound.score();
          }
          if (collidePipe(p)) {
            die();
            return;
          }
        }

        while (game.pipes.length && game.pipes[0].x + PIPE_W < -20) {
          game.pipes.shift();
        }
      }
      return;
    }

    if (game.state === STATE.DYING) {
      game.shake = Math.max(0, game.shake - dt * 45);
      bird.vy = Math.min(MAX_VY, bird.vy + GRAVITY * dt);
      bird.y += bird.vy * dt;
      bird.rot = Math.min(Math.PI / 2, bird.rot + dt * 5);

      if (bird.y + BIRD_R >= GROUND_Y) {
        bird.y = GROUND_Y - BIRD_R;
        bird.vy = 0;
      }

      if ((bird.y + BIRD_R >= GROUND_Y - 1 && game.time - game.dyingAt > 0.35) ||
          game.time - game.dyingAt > 1.4) {
        endGame();
      }
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    grad.addColorStop(0, "#4ec0e8");
    grad.addColorStop(0.65, "#7fd8f2");
    grad.addColorStop(1, "#c8f0f8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, GROUND_Y);

    const cc = -(game.bgCloud % cloudTileW);
    ctx.drawImage(cloudTile, cc, 0);
    ctx.drawImage(cloudTile, cc + cloudTileW, 0);

    const ci = -(game.bgCity % cityTileW);
    ctx.drawImage(cityTile, ci, 0);
    ctx.drawImage(cityTile, ci + cityTileW, 0);
  }

  function drawGround() {
    const off = -(game.bgGround % groundTileW);
    for (let x = off - groundTileW; x < W + groundTileW; x += groundTileW) {
      ctx.drawImage(groundTile, x, GROUND_Y);
    }
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, GROUND_Y, W, 3);
  }

  function drawPipe(p) {
    const gapBottom = p.gapTop + p.gap;
    const capH = 26;

    const body = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
    body.addColorStop(0, "#3f9e26");
    body.addColorStop(0.22, "#7ada4f");
    body.addColorStop(0.5, "#9ae86a");
    body.addColorStop(0.8, "#5cbf37");
    body.addColorStop(1, "#2e7a1c");

    function column(top, height) {
      ctx.fillStyle = body;
      ctx.fillRect(p.x, top, PIPE_W, height);
      ctx.strokeStyle = "#215e14";
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x + 1.5, top + 1.5, PIPE_W - 3, height - 3);
    }

    function cap(top) {
      ctx.fillStyle = body;
      ctx.fillRect(p.x - 6, top, PIPE_W + 12, capH);
      ctx.strokeStyle = "#215e14";
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 4.5, top + 1.5, PIPE_W + 9, capH - 3);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(p.x - 2, top + 4, PIPE_W + 4, 5);
    }

    column(0, p.gapTop - capH + 4);
    cap(p.gapTop - capH);

    const botTop = gapBottom;
    column(botTop + capH - 4, GROUND_Y - botTop - capH + 4);
    cap(botTop);
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);

    // sayap
    const wingY = Math.sin(bird.wing) * 5;
    ctx.fillStyle = "#f4d03f";
    ctx.strokeStyle = "#7a5a00";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(-6, 4 + wingY, 11, 7.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // badan
    ctx.fillStyle = "#ffd93b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // perut
    ctx.fillStyle = "#fff3c4";
    ctx.beginPath();
    ctx.ellipse(2, 5, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // mata
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(8, -5, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(10, -5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(11, -6, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // paruh
    ctx.fillStyle = "#f07f1a";
    ctx.strokeStyle = "#a8500a";
    ctx.beginPath();
    ctx.moveTo(14, -1);
    ctx.lineTo(26, 2);
    ctx.lineTo(14, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function render() {
    ctx.save();

    if (game.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * game.shake,
        (Math.random() - 0.5) * game.shake
      );
    }

    drawBackground();

    for (const p of game.pipes) drawPipe(p);

    drawGround();
    drawBird();

    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Loop
  // ------------------------------------------------------------------
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  showMenu();
  requestAnimationFrame(loop);
})();
