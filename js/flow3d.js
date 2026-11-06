// The page's 3D background: real coins fly in from the distance to a metal shield. Scams shatter
// on it, clean coins pass through. Scrolling moves the shield through the page and spins it.
// The coins are an illustration, not live data.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { $ } from './util.js';

const COLORS = { bg: 0x09090b, red: 0xf4525a, green: 0x3ecf8e, gold: 0xd8b36a };
const FLAGS = ['Honeypot', 'Hidden owner', 'Unlocked liquidity', 'Unlimited minting', 'Whale wallets', 'Huge fees'];
const COIN_COUNT = 14;
const BAD_SHARE = 0.45;
const SHARDS_PER_HIT = 22;
const SHARD_COUNT = 132;
const FOV = 30;

// Graphics chips that can't run the full bloom effect smoothly.
const WEAK_GPU = /intel.*(uhd|hd|iris)|mali|adreno|powervr|videocore|swiftshader|llvmpipe|software/i;

// Render resolution. Starts at the quality's maximum and steps down until the motion is smooth.
const MAX_RATIO = { full: 1.75, light: 1.25 };
const MIN_RATIO = 0.7;
const RATIO_STEP = 0.15;
const SLOW_FRAME_MS = 21;
const FRAMES_PER_CHECK = 40;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = THREE.MathUtils.lerp;

// The site's logo outline, centred and flipped so y points up.
function shieldShape(scale) {
  const x = (v) => (v - 16) * scale;
  const y = (v) => (15.3 - v) * scale;
  const s = new THREE.Shape();
  s.moveTo(x(16), y(4));
  s.lineTo(x(25), y(7.4));
  s.lineTo(x(25), y(14.2));
  s.bezierCurveTo(x(25), y(19.8), x(21.2), y(23.9), x(16), y(26.6));
  s.bezierCurveTo(x(10.8), y(23.9), x(7), y(19.8), x(7), y(14.2));
  s.lineTo(x(7), y(7.4));
  s.closePath();
  return s;
}

function buildShield(fullQuality) {
  const group = new THREE.Group();

  // The clear lacquer finish is the expensive part of these materials, so it's full quality only.
  const makeMaterial = (base, clearcoatRoughness) =>
    fullQuality
      ? new THREE.MeshPhysicalMaterial({ ...base, clearcoat: 1, clearcoatRoughness })
      : new THREE.MeshStandardMaterial(base);

  const frameMat = makeMaterial({ color: 0xc9ccd4, metalness: 1, roughness: 0.23, emissive: 0x000000 }, 0.2);
  const frameShape = shieldShape(0.135);
  frameShape.holes.push(new THREE.Path(shieldShape(0.105).getPoints(32).reverse()));
  const frame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(frameShape, {
      depth: 0.34, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 6, curveSegments: 32,
    }),
    frameMat
  );
  frame.position.z = -0.17;
  group.add(frame);

  const plateMat = makeMaterial({ color: 0x101116, metalness: 0.9, roughness: 0.3, emissive: 0x000000 }, 0.08);
  const plate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shieldShape(0.112), { depth: 0.16, bevelEnabled: false, curveSegments: 32 }),
    plateMat
  );
  plate.position.z = -0.08;
  group.add(plate);

  const tickMat = new THREE.MeshStandardMaterial({ color: COLORS.green, emissive: COLORS.green, emissiveIntensity: 2.4 });
  const tickPath = new THREE.CurvePath();
  const a = new THREE.Vector3(-0.56, -0.02, 0.14);
  const b = new THREE.Vector3(-0.14, -0.44, 0.14);
  const c = new THREE.Vector3(0.62, 0.42, 0.14);
  tickPath.add(new THREE.LineCurve3(a, b));
  tickPath.add(new THREE.LineCurve3(b, c));
  const tick = new THREE.Mesh(new THREE.TubeGeometry(tickPath, 48, 0.085, 12, false), tickMat);
  group.add(tick);
  for (const end of [a, c]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), tickMat);
    cap.position.copy(end);
    group.add(cap);
  }

  return { group, frameMat, plateMat, tickMat };
}

function pickQuality(gl) {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'full' || forced === 'light') return forced;
  if (innerWidth < 700) return 'light';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  return WEAK_GPU.test(gpu) ? 'light' : 'full';
}

function coinFaceTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#777';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#fff';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(size / 2, size / 2, 108, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#fff';
  g.font = '700 130px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', size / 2, size / 2 + 8);
  return new THREE.CanvasTexture(c);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function wireFlow3D() {
  const stage = $('flow-stage');
  const canvas = $('flow-canvas');
  const flag = $('flow-flag');

  const glowMap = glowTexture();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const quality = pickQuality(renderer.getContext());
  document.documentElement.classList.toggle('q-full', quality === 'full');
  renderer.setClearColor(COLORS.bg, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 1.4);
  rim.position.set(-5, 2, -4);
  scene.add(rim);
  const hitLight = new THREE.PointLight(0xffffff, 0, 16, 1.6);
  hitLight.position.set(0, 0, 2.4);

  // Everything that belongs to the shield moves together.
  const rig = new THREE.Group();
  scene.add(rig);
  rig.add(hitLight);

  const shield = buildShield(quality === 'full');
  rig.add(shield.group);

  const glowMat = new THREE.SpriteMaterial({
    map: glowMap, color: COLORS.green, transparent: true, opacity: 0.1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(9);
  glow.position.z = -1.4;
  rig.add(glow);

  // A soft sprite glows the tick on every device; full quality adds real bloom on top.
  const tickGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMap, color: COLORS.green, transparent: true, opacity: quality === 'full' ? 0.22 : 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  tickGlow.scale.setScalar(3.1);
  tickGlow.position.z = 0.28;
  shield.group.add(tickGlow);

  // Thin orbit rings around the shield.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8b8f9c, transparent: true, opacity: 0.55 });
  const rings = [
    { radius: 2.5, tilt: [1.2, 0.3], speed: 0.22 },
    { radius: 2.95, tilt: [1.45, -0.45], speed: -0.15 },
  ].map(({ radius, tilt, speed }) => {
    const pivot = new THREE.Group();
    pivot.rotation.set(tilt[0], tilt[1], 0);
    pivot.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 0.007, 8, 160), ringMat));
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.green })
    );
    node.position.x = radius;
    const spinner = new THREE.Group();
    spinner.add(node);
    pivot.add(spinner);
    rig.add(pivot);
    return { spinner, speed };
  });

  // Floating dust for depth.
  const dustCount = 420;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = rand(-16, 16);
    dustPos[i * 3 + 1] = rand(-8, 8);
    dustPos[i * 3 + 2] = rand(-14, 4);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.028, transparent: true, opacity: 0.4, depthWrite: false })
  );
  scene.add(dust);

  // Coins
  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.075, 64, 1);
  const face = coinFaceTexture();
  const makeCoinMats = () => {
    const side = new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 1, roughness: 0.3, emissive: 0x000000 });
    const top = new THREE.MeshStandardMaterial({
      color: COLORS.gold, metalness: 1, roughness: 0.34, bumpMap: face, bumpScale: 2.2, emissive: 0x000000,
    });
    return [side, top, top];
  };
  const coins = Array.from({ length: COIN_COUNT }, () => {
    const mats = makeCoinMats();
    const mesh = new THREE.Mesh(coinGeo, mats);
    mesh.visible = false;
    rig.add(mesh);
    return {
      mesh, mats, state: 'idle', t: 0, speed: 0, bad: false,
      from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(),
      spin: new THREE.Vector3(),
    };
  });

  // Shards from shattered coins
  const shardGeo = new THREE.TetrahedronGeometry(0.075);
  const shardMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.red).multiplyScalar(2) });
  const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, SHARD_COUNT);
  shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shardMesh.frustumCulled = false;
  rig.add(shardMesh);
  const shards = Array.from({ length: SHARD_COUNT }, () => ({
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), life: 0,
  }));
  let shardCursor = 0;

  // Shockwaves
  const waves = Array.from({ length: 5 }, () => {
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.red, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), mat);
    mesh.position.z = 0.35;
    mesh.visible = false;
    rig.add(mesh);
    return { mesh, mat, life: 0 };
  });

  let ratio = Math.min(devicePixelRatio || 1, MAX_RATIO[quality]);
  let composer = null;
  let useBloom = false;

  function resize() {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(ratio);
      composer.setSize(box.width, box.height);
    }
  }

  // Bloom's code is only downloaded by devices that will actually use it.
  async function enableBloom() {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
    const box = stage.getBoundingClientRect();
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(box.width, box.height), 0.38, 0.65, 0.82));
    composer.addPass(new OutputPass());
    resize();
    useBloom = true;
  }

  // Watch real frame times: if the machine can't keep up, drop bloom first, then resolution.
  let frameSum = 0;
  let frameCount = 0;
  function adaptQuality(ms) {
    frameSum += ms;
    if (++frameCount < FRAMES_PER_CHECK) return;
    const average = frameSum / frameCount;
    frameSum = frameCount = 0;
    if (average <= SLOW_FRAME_MS) return;
    if (useBloom) {
      useBloom = false;
      document.documentElement.classList.remove('q-full');
    } else if (ratio > MIN_RATIO) {
      ratio = Math.max(MIN_RATIO, ratio - RATIO_STEP);
      resize();
    }
  }

  // Scroll, smoothed so the camera glides instead of stepping with the wheel.
  let scrollTarget = 0;
  let scroll = 0;
  function readScroll() {
    const travel = document.documentElement.scrollHeight - innerHeight;
    scrollTarget = travel > 0 ? clamp01(scrollY / travel) : 0;
  }
  addEventListener('scroll', readScroll, { passive: true });

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  function launch(c) {
    // Coins come from far behind the shield, so they never cross the text beside it.
    const angle = rand(0, Math.PI * 2);
    const reach = rand(3.5, 7);
    c.bad = Math.random() < BAD_SHARE;
    c.state = 'in';
    c.t = 0;
    c.speed = rand(0.3, 0.42);
    c.from.set(Math.cos(angle) * reach, Math.sin(angle) * reach, -22);
    c.ctrl.set(Math.cos(angle + 1) * 2.3, Math.sin(angle + 1) * 2.3, -3);
    c.to.set(rand(-0.4, 0.4), rand(-0.5, 0.5), c.bad ? 0.55 : 0);
    c.spin.set(rand(1.5, 3.5), rand(1, 3), rand(-1, 1));
    c.mesh.visible = true;
    c.mesh.scale.setScalar(1);
    c.mesh.rotation.set(rand(0, 6), rand(0, 6), 0);
    for (const m of c.mats) m.emissive.setHex(0x000000);
  }

  function wave(color) {
    const w = waves.find((v) => v.life <= 0) || waves[0];
    w.life = 1;
    w.mat.color.setHex(color);
    w.mesh.visible = true;
  }

  const restColor = new THREE.Color(COLORS.green);
  const hitColor = new THREE.Color(COLORS.green);
  let hit = 0;
  function flashShield(color) {
    hitColor.setHex(color);
    // Clean coins pass all the time, so their flash stays soft; a scam gets the full hit.
    hit = color === COLORS.red ? 1 : 0.3;
    hitLight.color.setHex(color);
  }

  let flagIndex = 0;
  const flagPoint = new THREE.Vector3();
  function showFlag() {
    flagPoint.set(0, 2.25, 0);
    rig.localToWorld(flagPoint);
    flagPoint.project(camera);
    const box = stage.getBoundingClientRect();
    flag.style.left = `${((flagPoint.x + 1) / 2) * box.width}px`;
    flag.style.top = `${((1 - flagPoint.y) / 2) * box.height}px`;
    flag.textContent = FLAGS[flagIndex++ % FLAGS.length];
    flag.classList.remove('show');
    void flag.offsetWidth;
    flag.classList.add('show');
  }

  function shatter(position) {
    for (let i = 0; i < SHARDS_PER_HIT; i++) {
      const s = shards[shardCursor];
      shardCursor = (shardCursor + 1) % SHARD_COUNT;
      s.pos.copy(position);
      s.vel.set(rand(-3.4, 0.8), rand(-3, 3), rand(0.4, 3));
      s.rot.set(rand(0, 6), rand(0, 6), rand(0, 6));
      s.life = 1;
    }
    shardsActive = true;
  }

  function arrive(c) {
    if (c.bad) {
      shatter(c.mesh.position);
      c.mesh.visible = false;
      c.state = 'idle';
      flashShield(COLORS.red);
      wave(COLORS.red);
      showFlag();
      return;
    }
    flashShield(COLORS.green);
    wave(COLORS.green);
    // Through the shield and off past the right edge.
    c.state = 'out';
    c.t = 0;
    c.speed = rand(0.5, 0.65);
    c.from.set(0, c.mesh.position.y, -0.7);
    c.ctrl.set(2.6, rand(-1.5, 1.5), -1.6);
    c.to.set(11, rand(-4, 4), rand(1, 5));
    for (const m of c.mats) {
      m.emissive.setHex(COLORS.green);
      m.emissiveIntensity = 0.7;
    }
  }

  function updateCoin(c, dt) {
    if (c.state === 'idle') return;
    c.t += c.speed * dt;
    if (c.t >= 1) {
      if (c.state === 'in') arrive(c);
      else {
        c.state = 'idle';
        c.mesh.visible = false;
      }
      if (c.state !== 'out' || c.t >= 1) {
        if (c.state === 'idle') return;
      }
    }
    const t = c.t;
    const u = 1 - t;
    c.mesh.position.set(
      u * u * c.from.x + 2 * u * t * c.ctrl.x + t * t * c.to.x,
      u * u * c.from.y + 2 * u * t * c.ctrl.y + t * t * c.to.y,
      u * u * c.from.z + 2 * u * t * c.ctrl.z + t * t * c.to.z
    );
    c.mesh.rotation.x += c.spin.x * dt;
    c.mesh.rotation.y += c.spin.y * dt;
    c.mesh.rotation.z += c.spin.z * dt;

    // The scan: a bad coin heats up red as it nears the shield.
    if (c.state === 'in' && c.bad) {
      const heat = smooth(0.62, 1, t);
      for (const m of c.mats) {
        m.emissive.setHex(COLORS.red);
        m.emissiveIntensity = heat * 1.6;
      }
    }
  }

  const dummy = new THREE.Object3D();
  let shardsActive = true; // true at the start so every instance gets a zero scale once
  function updateShards(dt) {
    if (!shardsActive) return;
    shardsActive = false;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const s = shards[i];
      if (s.life > 0) {
        shardsActive = true;
        s.life -= dt * 1.15;
        s.vel.multiplyScalar(1 - dt * 1.4);
        s.pos.addScaledVector(s.vel, dt);
        s.rot.x += dt * 5;
        s.rot.y += dt * 4;
      }
      dummy.position.copy(s.pos);
      dummy.rotation.copy(s.rot);
      dummy.scale.setScalar(Math.max(0, s.life));
      dummy.updateMatrix();
      shardMesh.setMatrixAt(i, dummy.matrix);
    }
    shardMesh.instanceMatrix.needsUpdate = true;
  }

  function updateWaves(dt) {
    for (const w of waves) {
      if (w.life <= 0) continue;
      w.life -= dt * 1.5;
      const s = mix(3.2, 1.6, Math.max(0, w.life));
      w.mesh.scale.setScalar(s);
      w.mat.opacity = Math.max(0, w.life) * 0.28;
      if (w.life <= 0) w.mesh.visible = false;
    }
  }

  function applyScroll(time) {
    const p = scroll;
    const wide = camera.aspect > 1.1;

    // Wide screens start with the shield beside the headline; tall screens start below it.
    const startX = wide ? Math.min(3.6, 2.05 * camera.aspect) : 0;
    const startY = wide ? 0 : -2.35;

    // As the page scrolls the shield sweeps across and recedes into the distance.
    const sweep = smooth(0, 0.5, p);
    const sweepBack = smooth(0.5, 1, p);
    rig.position.x = mix(startX, -startX, sweep) + startX * 0.6 * sweepBack;
    rig.position.y = mix(startY, 0.6, sweep) - 1.1 * sweepBack;
    rig.position.z = -6 * sweep + 2 * sweepBack;

    const baseZ = wide ? 13 : 17;
    camera.position.set(pointer.x * 0.4 + Math.sin(p * Math.PI) * 1.6, 0.3 - pointer.y * 0.25, baseZ);
    camera.lookAt(0, 0, 0);

    shield.group.rotation.y = -0.38 + p * Math.PI * 3 + Math.sin(time * 0.6) * 0.12 + pointer.x * 0.22;
    shield.group.rotation.x = Math.sin(time * 0.45) * 0.05 + pointer.y * 0.1;
  }

  let running = false;
  let last = 0;
  let spawnTimer = 0;

  function render() {
    if (useBloom) composer.render();
    else renderer.render(scene, camera);
  }

  function frame(now) {
    if (document.hidden) {
      running = false;
      return;
    }
    const raw = (now - last) / 1000;
    const dt = Math.min(raw, 0.05);
    last = now;
    const time = now / 1000;

    // Ignore long gaps, such as returning to the tab; only real frames count.
    if (raw < 0.25) adaptQuality(raw * 1000);

    scroll += (scrollTarget - scroll) * (1 - Math.exp(-dt * 7));
    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 4));
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 4));

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = rand(0.5, 0.85);
      const free = coins.find((c) => c.state === 'idle');
      if (free) launch(free);
    }

    coins.forEach((c) => updateCoin(c, dt));
    updateShards(dt);
    updateWaves(dt);
    for (const r of rings) r.spinner.rotation.z += r.speed * dt * 4;
    dust.rotation.y = time * 0.012;

    hit = Math.max(0, hit - dt * 2.2);
    hitLight.intensity = hit * 60;
    shield.frameMat.emissive.copy(hitColor);
    shield.frameMat.emissiveIntensity = hit * 0.9;
    shield.plateMat.emissive.copy(hitColor);
    shield.plateMat.emissiveIntensity = hit * 0.35;
    glowMat.color.lerpColors(restColor, hitColor, hit);
    glowMat.opacity = 0.09 + hit * 0.28;

    applyScroll(time);
    render();
    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  new ResizeObserver(() => {
    resize();
    readScroll();
  }).observe(stage);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) start();
  });
  // Build the shaders now, so the first coin and first shatter don't cause a hitch.
  resize();
  renderer.compile(scene, camera);
  start();
  if (quality === 'full') enableBloom().catch((err) => console.warn('Bloom unavailable.', err));
}
