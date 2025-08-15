(() => {
  'use strict';

  const CFG = window.RACING_CONFIG || {};

  // 基础 DOM
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const speedEl = document.getElementById('speed');
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  const bestEl = document.getElementById('best');
  const nitroFill = document.getElementById('nitroFill');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const lightBtn = document.getElementById('lightBtn');
  const endOverlay = document.getElementById('endOverlay');
  const finalTimeEl = document.getElementById('finalTime');
  const finalScoreEl = document.getElementById('finalScore');
  const finalBestEl = document.getElementById('finalBest');
  const againBtn = document.getElementById('againBtn');
  const muteBtn = document.getElementById('muteBtn');
  const countdownEl = document.getElementById('countdown');

  // 渲染器（动态分辨率自适应）
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let renderPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  document.body.appendChild(renderer.domElement);

  // 场景 & 摄像机
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(
    CFG.world?.skyColorBottom || 0x0e1227,
    CFG.world?.fogNear || 25,
    CFG.world?.fogFar || 220
  );

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  scene.add(camera);
  let targetFov = 65;
  // 后处理（FXAA 抗锯齿 + 轻微暗角），按需启用，失败则自动降级
  let composer = null; let fxaa = null; let vignette = null; let bloom = null; let chromatic = null;
  try {
    if (window.POSTPROCESSING && renderer && camera && scene) {
      const { EffectComposer, RenderPass, EffectPass, FXAAEffect, VignetteEffect, BloomEffect, ChromaticAberrationEffect } = window.POSTPROCESSING;
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      fxaa = new FXAAEffect();
      vignette = new VignetteEffect({ eskil: false, offset: 0.2, darkness: 0.8 });
      // 轻量泛光，基础值较保守，氮气时会临时增强
      try {
        bloom = new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.6, luminanceSmoothing: 0.12 });
      } catch { bloom = null; }
      // 极轻色散，默认极小，氮气时增强
      try { chromatic = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0006) }); } catch { chromatic = null; }
      const pass = bloom && chromatic
        ? new EffectPass(camera, fxaa, bloom, chromatic, vignette)
        : (bloom ? new EffectPass(camera, fxaa, bloom, vignette)
                 : (chromatic ? new EffectPass(camera, fxaa, chromatic, vignette)
                              : new EffectPass(camera, fxaa, vignette)));
      pass.renderToScreen = true;
      composer.addPass(pass);
    }
  } catch { composer = null; }

  // 光照
  const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x223355, 0.9);
  scene.add(hemiLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(8, 18, 12);
  scene.add(dirLight);
  // 车头光锥引用占位，避开 applyLighting 时未定义
  let headCone = null;

  // 赛道主题：先提供一个安全默认，避免 TDZ 报错
  // 调整为中等幅度，防止视角过激导致“看不见”
  let currentTheme = { name: '中等弯+起伏', xA1: 0.18, xF1: 0.012, xA2: 0.10, xF2: 0.004, yA: 0.08 };

  // 光照模式（白天/黄昏/夜晚）与自动切换
  const LIGHT_MODES = [
    { name: '白天', skyTop: 0x87caff, skyBottom: 0xbfe3ff, fog: 0xa7c9f5, hemi: 1.1, dir: 1.0, headCone: 0.10 },
    { name: '黄昏', skyTop: 0xff9966, skyBottom: 0xffe0b2, fog: 0xffd1a3, hemi: 0.9, dir: 0.7, headCone: 0.16 },
    { name: '夜晚', skyTop: 0x1b2340, skyBottom: 0x0e1227, fog: 0x0e1227, hemi: 0.9, dir: 0.5, headCone: 0.24 },
  ];
  let currentLight = 2; // 默认夜晚
  function applyLighting() {
    const m = LIGHT_MODES[currentLight];
    skyMat.uniforms.topColor.value.setHex(m.skyTop);
    skyMat.uniforms.bottomColor.value.setHex(m.skyBottom);
    scene.fog.color.setHex(m.fog);
    hemiLight.intensity = m.hemi;
    dirLight.intensity = m.dir;
    if (headCone) headCone.material.opacity = m.headCone;
  }
  function cycleLighting(step = 1) {
    currentLight = (currentLight + step + LIGHT_MODES.length) % LIGHT_MODES.length;
    applyLighting();
  }
  // 自动切换
  setInterval(() => cycleLighting(+1), 45000);

  // 天空背景（渐变立方体）
  const skyGeo = new THREE.BoxGeometry(1000, 1000, 1000);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(CFG.theme?.skyColorTop || 0x1b2340) },
      bottomColor: { value: new THREE.Color(CFG.theme?.skyColorBottom || 0x0e1227) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      void main() {
        float h = normalize(vWorldPos).y * 0.5 + 0.5;
        vec3 col = mix(bottomColor, topColor, smoothstep(0.0, 1.0, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  // 初始应用光照模式
  applyLighting();

  // 路面
  const roadWidth = CFG.world?.roadWidth ?? 14;
  const roadLength = 1200; // 视觉背景
  // 稍高细分；是否变形由开关控制
  const roadGeo = new THREE.PlaneGeometry(roadWidth, roadLength, 16, 200);
  const roadMat = new THREE.MeshStandardMaterial({
    color: CFG.theme?.roadColor ?? 0x2a2f3a,
    roughness: 0.95,
    metalness: 0.0,
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.z = -roadLength * 0.5 + 10;
  scene.add(road);
  // 程序化路面细节：微弱纵向条纹与柏油颗粒噪声（无贴图）
  road.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n varying vec3 vWorldPos;`
    ).replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>\n vWorldPos = (modelMatrix * vec4( transformed, 1.0 )).xyz;`
    );
    const head = `
      varying vec3 vWorldPos;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); float a = hash(i); float b = hash(i+vec2(1.0,0.0)); float c = hash(i+vec2(0.0,1.0)); float d = hash(i+vec2(1.0,1.0)); vec2 u = f*f*(3.0-2.0*f); return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y; }
    `;
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {', head + '\n void main() {'
    ).replace(
      '#include <output_fragment>',
      `#include <output_fragment>
        float stripe = smoothstep(0.45, 0.55, fract(vWorldPos.z * 0.05));
        float asphalt = 1.0 - stripe * 0.04;
        float grit = noise(vWorldPos.xz * 2.0) * 0.02;
        gl_FragColor.rgb *= clamp(asphalt - grit, 0.88, 1.0);
      `
    );
  };
  // 路面顶点基准（仅当启用形变时使用）
  const roadPos = road.geometry.attributes.position;
  const roadBase = roadPos.array.slice();
  const ENABLE_ROAD_DEFORM = true; // 开启路面形变（可见上坡与拐弯）

  // 中线虚线（用方块重复）
  const stripeLength = CFG.world?.stripeLength ?? 6;
  const stripeGap = CFG.world?.stripeGap ?? 10;
  const stripes = [];
  const stripeMat = new THREE.MeshStandardMaterial({ color: CFG.theme?.stripeColor ?? 0xffffff, roughness: 0.5, metalness: 0.2 });
  const stripeGeo = new THREE.BoxGeometry(0.6, 0.05, stripeLength);
  const stripeCount = Math.floor(roadLength / (stripeLength + stripeGap)) + 10;
  for (let i = 0; i < stripeCount; i++) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.03, -i * (stripeLength + stripeGap));
    scene.add(stripe);
    stripes.push(stripe);
  }

  // 路侧桩（用于配合弯道/起伏移动）
  const posts = [];
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5fa2ff, emissive: 0x0b2a66, roughness: 0.5 });
  const postCountPerSide = 40;
  for (let side of [-1, 1]) {
    for (let i = 0; i < postCountPerSide; i++) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.userData.side = side;
      p.userData.baseX = side * (roadWidth * 0.5 + 0.5);
      p.position.set(p.userData.baseX, 0.3, -i * (roadLength / postCountPerSide) - 10);
      scene.add(p);
      posts.push(p);
    }
  }

  // 路灯（InstancedMesh）与弯道指示牌（InstancedMesh）
  const lampCount = 60;
  const lampGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xaad4ff, emissive: 0x224477, roughness: 0.6 });
  const lamp = new THREE.InstancedMesh(lampGeo, lampMat, lampCount);
  lamp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lamp);
  const signCount = 20;
  const signGeo = new THREE.BoxGeometry(0.1, 1.2, 0.4);
  const signMat = new THREE.MeshStandardMaterial({ color: 0xff7b7b, emissive: 0x661a1a, roughness: 0.5 });
  const signs = new THREE.InstancedMesh(signGeo, signMat, signCount);
  signs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(signs);

  // 车辆（由简单几何体拼装）
  const car = new THREE.Group();
  scene.add(car);
  // 更精致的赛车模型（尾翼/玻璃/前唇/侧裙）
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.55, 3.3);
  const cabinGeo = new THREE.BoxGeometry(1.15, 0.5, 1.5);
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: CFG.theme?.carBodyColor ?? 0x18e0ff, metalness: 0.5, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const cabinMat = new THREE.MeshPhysicalMaterial({ color: CFG.theme?.carAccentColor ?? 0x1060ff, metalness: 0.55, roughness: 0.18, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.42;
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 0.75, -0.25);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.38, 0.02), new THREE.MeshStandardMaterial({ color: 0x99d9ff, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.7 }));
  windshield.position.set(0, 0.83, -0.3); // 车头（-z）
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.6 }));
  spoiler.position.set(0, 0.9, 1.6); // 车尾（+z）
  const frontLip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.7 }));
  frontLip.position.set(0, 0.35, -1.7); // 前唇置于车头
  const sideSkirtL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 2.6), new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.7 }));
  sideSkirtL.position.set(-1.0, 0.35, 0.0);
  const sideSkirtR = sideSkirtL.clone(); sideSkirtR.position.x = 1.0;
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 20);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const mkWheel = (x, z) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.35, z);
    return w;
  };
  const wheels = [
    mkWheel(-0.9, 1.0), mkWheel(0.9, 1.0),
    mkWheel(-0.9, -1.1), mkWheel(0.9, -1.1),
  ];
  car.add(body, cabin, windshield, spoiler, frontLip, sideSkirtL, sideSkirtR, ...wheels);

  // 外观细节增强：侧镜、车身条纹、轮毂/刹车盘、底盘霓虹
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.4, metalness: 0.2 });
  const mirrorGeo = new THREE.BoxGeometry(0.22, 0.1, 0.28);
  const mirrorL = new THREE.Mesh(mirrorGeo, mirrorMat); mirrorL.position.set(-1.15, 0.8, -0.5);
  const mirrorR = mirrorL.clone(); mirrorR.position.x = 1.15;
  const stripeMatCar = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.5 });
  const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2.6), stripeMatCar); stripeL.position.set(-0.65, 0.74, 0.0);
  const stripeR = stripeL.clone(); stripeR.position.x = 0.65;
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.25, metalness: 0.85 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x6d8190, roughness: 0.5, metalness: 0.6 });
  wheels.forEach((w)=>{
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16), rimMat);
    rim.rotation.z = Math.PI/2; rim.position.copy(w.position);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 20), discMat);
    disc.rotation.z = Math.PI/2; disc.position.copy(w.position); disc.position.y -= 0.02;
    car.add(rim, disc);
  });
  const underglowMat = new THREE.MeshBasicMaterial({ color: 0x00eaff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  const underglow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.0), underglowMat);
  underglow.rotation.x = -Math.PI/2; underglow.position.set(0, 0.05, 0.2); underglow.renderOrder = 1;
  car.add(underglow, mirrorL, mirrorR, stripeL, stripeR);

  // 贴地假阴影（提升贴地感）
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), shadowMat);
  shadow.rotation.x = -Math.PI/2; shadow.position.set(0, 0.04, 0.2); shadow.renderOrder = 0.9;
  car.add(shadow);

  // 车灯光晕（前白/后红）
  const glowMaterialFront = new THREE.SpriteMaterial({ color: 0x99e6ff, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending });
  const glowMaterialRear = new THREE.SpriteMaterial({ color: 0xff3b30, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const headL = new THREE.Sprite(glowMaterialFront); headL.scale.set(0.3, 0.3, 1); headL.position.set(-0.6, 0.45, -1.55);
  const headR = headL.clone(); headR.position.x = 0.6;
  const tailL = new THREE.Sprite(glowMaterialRear); tailL.scale.set(0.32, 0.32, 1); tailL.position.set(-0.6, 0.42, 1.6);
  const tailR = new THREE.Sprite(glowMaterialRear.clone()); tailR.scale.copy(tailL.scale); tailR.position.set(0.6, 0.42, 1.6);
  car.add(headL, headR, tailL, tailR);

  // 车头照地光锥
  const headConeGeo = new THREE.ConeGeometry(0.7, 3.3, 16, 1, true);
  const headConeMat = new THREE.MeshBasicMaterial({ color: 0xbbe9ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  headCone = new THREE.Mesh(headConeGeo, headConeMat);
  headCone.position.set(0, 0.2, -1.8);
  headCone.rotation.x = Math.PI / 2.1;
  car.add(headCone);

  // 漂移轮胎痕对象池（贴地短矩形，随时间拉长/衰减）
  const skidGeo = new THREE.PlaneGeometry(0.28, 1.0);
  const skidPool = []; const activeSkids = [];
  for (let i = 0; i < 180; i++) skidPool.push(new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x0c0f14, transparent: true, opacity: 0.0, depthWrite: false })));
  function spawnSkid(worldX, worldY, worldZ) {
    const m = skidPool.pop(); if (!m) return; activeSkids.push(m); scene.add(m);
    m.userData.t = 0; m.userData.max = 1.8 + Math.random() * 0.7;
    m.position.set(worldX, 0.021, worldZ);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(1.0, 0.8, 1.0);
    m.material.opacity = 0.0;
  }

  // 车尾喷口与喷焰/火花粒子池（氮气时可见）
  const exhaustL = new THREE.Object3D(); exhaustL.position.set(-0.55, 0.35, 1.7);
  const exhaustR = new THREE.Object3D(); exhaustR.position.set(0.55, 0.35, 1.7);
  car.add(exhaustL, exhaustR);
  const flameGeo = new THREE.ConeGeometry(0.12, 0.7, 16);
  const flameCoreGeo = new THREE.ConeGeometry(0.07, 0.55, 12);
  const sparkGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const flamePool = []; const flameCorePool = []; const sparkPool = [];
  const activeFlames = []; const activeFlameCores = []; const activeSparks = [];
  for (let i = 0; i < 80; i++) flamePool.push(new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0x33c9ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending })));
  for (let i = 0; i < 80; i++) flameCorePool.push(new THREE.Mesh(flameCoreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending })));
  for (let i = 0; i < 160; i++) sparkPool.push(new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending })));
  function spawnFlame(emitter) {
    const m = flamePool.pop(); if (!m) return; activeFlames.push(m); scene.add(m);
    m.userData.t = 0; m.userData.max = 0.28 + Math.random() * 0.2;
    m.userData.vx = (Math.random() * 2 - 1) * 0.7;
    m.userData.vy = 0.9 + Math.random() * 0.7;
    m.userData.vz = (3.8 + Math.random() * 2.6);
    emitter.getWorldPosition(m.position);
    m.rotation.x = Math.PI / 2; // 朝向 +z
    const c = flameCorePool.pop(); if (c) {
      activeFlameCores.push(c); scene.add(c);
      c.userData.t = 0; c.userData.max = m.userData.max * 0.85;
      c.userData.vx = m.userData.vx * 0.6;
      c.userData.vy = m.userData.vy * 0.6;
      c.userData.vz = m.userData.vz * 1.2;
      c.position.copy(m.position);
      c.rotation.copy(m.rotation);
    }
  }
  function spawnSpark(emitter) {
    const m = sparkPool.pop(); if (!m) return; activeSparks.push(m); scene.add(m);
    m.userData.t = 0; m.userData.max = 0.45 + Math.random() * 0.3;
    m.userData.vx = (Math.random() * 2 - 1) * 1.6;
    m.userData.vy = 1.0 + Math.random() * 0.8;
    m.userData.vz = (3.6 + Math.random() * 3.0);
    emitter.getWorldPosition(m.position);
  }

  // 尾喷口蓝色辉光
  const exhaustGlowMat = new THREE.SpriteMaterial({ color: 0x33ccff, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
  const exhaustGlowL = new THREE.Sprite(exhaustGlowMat.clone()); exhaustGlowL.position.copy(exhaustL.position); exhaustGlowL.scale.set(0.35, 0.35, 1);
  const exhaustGlowR = new THREE.Sprite(exhaustGlowMat.clone()); exhaustGlowR.position.copy(exhaustR.position); exhaustGlowR.scale.set(0.35, 0.35, 1);
  car.add(exhaustGlowL, exhaustGlowR);

  // 漂移烟尘粒子
  const smokeGeo = new THREE.PlaneGeometry(0.5, 0.5);
  const smokePool = []; const activeSmokes = [];
  for (let i = 0; i < 30; i++) smokePool.push(new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({ color: 0x99aabb, transparent: true, opacity: 0.0, depthWrite: false }))); 
  function spawnSmoke(worldX, worldY, worldZ) {
    const m = smokePool.pop(); if (!m) return; activeSmokes.push(m); scene.add(m);
    m.userData.t = 0; m.userData.max = 0.45 + Math.random() * 0.25;
    m.userData.vx = (Math.random() * 2 - 1) * 0.6;
    m.userData.vy = 0.8 + Math.random() * 0.4;
    m.userData.vz = - (0.6 + Math.random() * 0.6);
    m.position.set(worldX, worldY, worldZ);
    m.rotation.x = -Math.PI / 2;
  }

  // 摄像机跟随
  camera.position.set(0, 4.4, 7.2);
  const camTarget = new THREE.Vector3(0, 0.8, -4);
  // 碰撞相机抖动参数
  let camShake = 0; const camShakeDecay = 1.8;

  // 障碍物对象池
  const obstacleCount = CFG.gameplay?.obstacleCount ?? 24;
  const obstacles = [];
  // 多样化障碍物：方块/圆柱/锥体
  const obsBoxGeo = new THREE.BoxGeometry(1.8, 1.2, 1.8);
  const obsCylGeo = new THREE.CylinderGeometry(0.9, 0.9, 1.2, 16);
  const obsConeGeo = new THREE.ConeGeometry(0.9, 1.4, 12);
  const obsMat = new THREE.MeshStandardMaterial({ color: CFG.theme?.obstacleColor ?? 0xff4060, roughness: 0.55, metalness: 0.12 });
  const spawnZStart = CFG.world?.spawnZStart ?? -80;
  const spawnZEnd = CFG.world?.spawnZEnd ?? -800;

  function randomObstaclePosition() {
    // 安全生成：尽量避免与玩家初始位置同车道并保持最小横向距离
    let x = (Math.random() * 2 - 1) * (roadWidth * 0.5 - 1.2);
    if (Math.abs(x - 0) < 2.2) x += Math.sign(x || (Math.random()>0.5?1:-1)) * 2.6;
    const z = spawnZStart + Math.random() * (spawnZEnd - spawnZStart);
    return { x, z };
  }

  for (let i = 0; i < obstacleCount; i++) {
    const g = [obsBoxGeo, obsCylGeo, obsConeGeo][i % 3];
    const obs = new THREE.Mesh(g, obsMat);
    const { x, z } = randomObstaclePosition();
    obs.position.set(x, 0.6, z);
    scene.add(obs);
    obstacles.push(obs);
  }

  // 道具对象池（氮气/加分）
  const pickupCount = CFG.gameplay?.pickupCount ?? 10;
  const pickups = [];
  const pickupGeo = new THREE.IcosahedronGeometry(0.45, 0);
  const pickupNitroMat = new THREE.MeshStandardMaterial({ color: 0x00c8ff, emissive: 0x0050aa, metalness: 0.3, roughness: 0.2 });
  const pickupScoreMat = new THREE.MeshStandardMaterial({ color: 0xffc400, emissive: 0xaa6a00, metalness: 0.25, roughness: 0.25 });
  function spawnPickup(mesh) {
    const { x, z } = randomObstaclePosition();
    mesh.position.set(x, 0.6, z);
  }
  // 加速垫（地面材质）：驶过给予瞬时速度提升
  const boostPads = [];
  const boostPadGeo = new THREE.BoxGeometry(4, 0.04, 6);
  const boostPadMat = new THREE.MeshBasicMaterial({ color: 0x00ffd5, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(boostPadGeo, boostPadMat.clone());
    const { x, z } = randomObstaclePosition();
    p.position.set(x * 0.6, 0.02, z - 200 * i);
    scene.add(p);
    boostPads.push(p);
  }
  for (let i = 0; i < pickupCount; i++) {
    const type = i % 2 === 0 ? 'nitro' : 'score';
    const m = new THREE.Mesh(pickupGeo, type === 'nitro' ? pickupNitroMat : pickupScoreMat);
    m.userData.type = type;
    spawnPickup(m);
    scene.add(m);
    pickups.push(m);
  }

  // AI 车辆
  const aiCarCount = CFG.gameplay?.aiCarCount ?? 5;
  const aiCars = [];
  function makeAICar(colorMain, colorAccent) {
    const g = new THREE.Group();
    const bGeo = new THREE.BoxGeometry(1.7, 0.55, 3.0);
    const cGeo = new THREE.BoxGeometry(1.1, 0.45, 1.5);
    const wGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 16);
    const bMat = new THREE.MeshStandardMaterial({ color: colorMain, metalness: 0.15, roughness: 0.45 });
    const cMat = new THREE.MeshStandardMaterial({ color: colorAccent, metalness: 0.2, roughness: 0.35 });
    const wMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 });
    const b = new THREE.Mesh(bGeo, bMat); b.position.y = 0.42;
    const c = new THREE.Mesh(cGeo, cMat); c.position.set(0, 0.75, -0.15);
    const mkW = (x, z) => { const w = new THREE.Mesh(wGeo, wMat); w.rotation.z = Math.PI/2; w.position.set(x, 0.33, z); return w; };
    g.add(b, c, mkW(-0.85, 0.95), mkW(0.85, 0.95), mkW(-0.85, -1.05), mkW(0.85, -1.05));

    // AI 车灯（前白/后红）
    try {
      const aHeadMat = new THREE.SpriteMaterial({ color: 0x99e6ff, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending });
      const aTailMat = new THREE.SpriteMaterial({ color: 0xff3b30, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
      const ahL = new THREE.Sprite(aHeadMat); ahL.scale.set(0.26, 0.26, 1); ahL.position.set(-0.54, 0.42, -1.45);
      const ahR = new THREE.Sprite(aHeadMat.clone()); ahR.scale.copy(ahL.scale); ahR.position.set(0.54, 0.42, -1.45);
      const atL = new THREE.Sprite(aTailMat); atL.scale.set(0.28, 0.28, 1); atL.position.set(-0.54, 0.40, 1.45);
      const atR = new THREE.Sprite(aTailMat.clone()); atR.scale.copy(atL.scale); atR.position.set(0.54, 0.40, 1.45);
      g.add(ahL, ahR, atL, atR);
      g.userData.lightSprites = { ahL, ahR, atL, atR };
    } catch {}
    return g;
  }
  function randomAICarColor(i){
    const palette = [0xff6b6b, 0x96f7d2, 0xfddb3a, 0xb388ff, 0x4dd0e1, 0xff8a65, 0xa5d6a7];
    const accent = [0x4a148c, 0x1a237e, 0x0d47a1, 0x00695c, 0x37474f];
    return { main: palette[i % palette.length], accent: accent[i % accent.length] };
  }
  function spawnAICar(m){
    const { x, z } = randomObstaclePosition();
    m.position.set(x, 0.0, z);
    m.userData.speed = THREE.MathUtils.randFloat(CFG.gameplay?.aiSpeedMin ?? 18, CFG.gameplay?.aiSpeedMax ?? 58);
    m.userData.targetX = x;
  }
  for (let i = 0; i < aiCarCount; i++) {
    const col = randomAICarColor(i);
    const m = makeAICar(col.main, col.accent);
    spawnAICar(m);
    scene.add(m);
    aiCars.push(m);
  }

  // 输入控制
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // 触控（简易）
  let touchX = 0, touchY = 0, touching = false;
  window.addEventListener('pointerdown', (e) => { touching = true; touchX = e.clientX; touchY = e.clientY; });
  window.addEventListener('pointerup', () => touching = false);
  window.addEventListener('pointermove', (e) => { if (touching) { touchX = e.clientX; touchY = e.clientY; } });

  // 音效（WebAudio，无需音频文件）
  let audioCtx = null;
  let masterGain, engineGain, engineOsc, windGain, windNoise, hitGain, musicGain, musicNode, pickupGain;
  let muted = false;
  let comboOsc = null; let comboGain = null; let comboTimer = 0; let comboCount = 0;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioCtx.destination);

    // 引擎音：锯齿波 + 低频；根据速度调频、调幅
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0.0;
    engineOsc.connect(engineGain).connect(masterGain);
    engineOsc.start();

    // 风噪：噪声源 + 滤波
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    windNoise = audioCtx.createBufferSource();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;
    const windFilter = audioCtx.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 600;
    windGain = audioCtx.createGain();
    windGain.gain.value = 0.0;
    windNoise.connect(windFilter).connect(windGain).connect(masterGain);
    windNoise.start();

    // 撞击提示
    hitGain = audioCtx.createGain();
    hitGain.gain.value = 0.0;
    hitGain.connect(masterGain);

    // 背景音乐：简单三和弦轮换的合成器（无外部文件）
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.0; // 初始静音，开始时淡入
    musicGain.connect(masterGain);
    startBackgroundMusic();

    // 道具提示音
    pickupGain = audioCtx.createGain();
    pickupGain.gain.value = 0.0;
    pickupGain.connect(masterGain);
  }

  function startBackgroundMusic() {
    if (!audioCtx) return;
    // 创建一个循环的自定义序列：和弦 + 节拍噪声
    const tempo = 96; // BPM
    const beat = 60 / tempo;
    const seqLength = 16;
    const baseTime = audioCtx.currentTime + 0.05;

    // 简单双振荡器和弦器
    function scheduleChord(t, midiRoot) {
      const freqs = [midiToFreq(midiRoot), midiToFreq(midiRoot + 7), midiToFreq(midiRoot + 12)];
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = f;
        const g = audioCtx.createGain();
        g.gain.value = 0.0;
        o.connect(g).connect(musicGain);
        o.start(t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, t + beat * 1.5);
        o.stop(t + beat * 1.6);
      });
    }

    // 简单底鼓：短噪声 + 低频正弦
    function scheduleKick(t) {
      const o = audioCtx.createOscillator();
      o.type = 'sine';
      const g = audioCtx.createGain();
      g.gain.value = 0.0;
      o.connect(g).connect(musicGain);
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.start(t);
      o.stop(t + 0.14);
    }

    const chords = [57, 62, 64, 59]; // A, D, E, Bm roots (MIDI)
    for (let i = 0; i < seqLength; i++) {
      const t = baseTime + i * beat * 0.75; // 略快律动
      scheduleChord(t, chords[i % chords.length]);
      if (i % 2 === 0) scheduleKick(t);
    }

    // 循环下一段
    setTimeout(startBackgroundMusic, beat * 0.75 * seqLength * 1000);
    // 音量淡入
    musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
    musicGain.gain.linearRampToValueAtTime(muted ? 0 : 0.25, audioCtx.currentTime + 1.2);
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function playPickup() {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(990, audioCtx.currentTime + 0.08);
    g.gain.value = 0.0;
    o.connect(g).connect(pickupGain);
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.start(t);
    o.stop(t + 0.14);
  }

  // 氮气连发音效（短上滑音）
  function playNitroCombo() {
    if (!audioCtx) return;
    if (!comboOsc) {
      comboOsc = audioCtx.createOscillator();
      comboGain = audioCtx.createGain();
      comboOsc.type = 'sawtooth';
      comboGain.gain.value = 0.0;
      comboOsc.connect(comboGain).connect(masterGain);
      comboOsc.start();
    }
    const t = audioCtx.currentTime;
    const base = 440 * Math.pow(2, comboCount * 0.06);
    comboOsc.frequency.cancelScheduledValues(t);
    comboOsc.frequency.setValueAtTime(base, t);
    comboOsc.frequency.exponentialRampToValueAtTime(base * 1.8, t + 0.12);
    comboGain.gain.cancelScheduledValues(t);
    comboGain.gain.setValueAtTime(0.5, t);
    comboGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    comboTimer = performance.now();
    comboCount = Math.min(8, comboCount + 1);
  }

  function playHit() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    const g = audioCtx.createGain();
    g.gain.value = 0.0;
    osc.connect(g).connect(hitGain);
    const t = audioCtx.currentTime;
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start();
    osc.stop(t + 0.14);
  }

  function setMuted(nextMuted) {
    muted = nextMuted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.7;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (musicGain) musicGain.gain.value = muted ? 0 : 0.25;
  }

  muteBtn.addEventListener('click', () => setMuted(!muted));

  // 游戏状态
  let running = false;
  let paused = false;
  let canControl = false; // 倒计时期间禁止操控与计分
  let speed = 0; // m/s
  let score = 0;
  let remainTime = 120; // seconds
  let nitro = 0; // 0..CFG.gameplay.nitroMax
  let drifting = false;
  let driftDir = 0; // -1/0/1
  const maxSpeed = CFG.car?.maxSpeed ?? 72;
  const accel = CFG.car?.accel ?? 24;
  const brakeDecel = CFG.car?.brakeDecel ?? 48;
  const naturalDecel = CFG.car?.naturalDecel ?? 8;
  const steerSpeed = CFG.car?.steerSpeed ?? 18;
  const maxSteerX = CFG.car?.maxSteerX ?? 8;
  const nitroMax = CFG.gameplay?.nitroMax ?? 100;
  const nitroGainPerSecond = CFG.gameplay?.nitroGainPerSecond ?? 12;
  const nitroConsumePerSecond = CFG.gameplay?.nitroConsumePerSecond ?? 60;
  const nitroBoost = CFG.gameplay?.nitroBoost ?? 28;
  const driftGripLoss = CFG.gameplay?.driftGripLoss ?? 0.35;
  const driftScoreRate = CFG.gameplay?.driftScoreRate ?? 1.2;

  const clock = new THREE.Clock();
  let frameTimeAccumulator = 0;
  let frameCounter = 0;
  let lastFpsCheck = performance.now();
  let pathPhase = 0; // 弯道/起伏位相
  let difficultyT = 0; // 难度累计（秒）

  // 弯道与起伏路径
  // 简化稳定的“样条式”横向偏移（用于道具/标线/AI/路桩），不强行扭曲路面网格
  const curvePoints = [];
  function rebuildCurve() {
    curvePoints.length = 0;
    const segments = 6;
    let accumZ = 0;
    const segLen = roadLength / segments;
    let prevX = 0;
    const ct = (typeof currentTheme !== 'undefined' && currentTheme) ? currentTheme : { xA1: 0.12, xA2: 0.06, xF1: 0.015, xF2: 0.005 };
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // 依据主题给出更自然的目标偏移（缓变曲率）
      const target = (Math.sin(t * Math.PI * 2 * (ct.xF1 ? 1 : 0.5)) * (roadWidth * (ct.xA1 || 0.12)))
                   + (Math.sin(t * Math.PI * 4 * (ct.xF2 ? 1 : 0.25)) * (roadWidth * (ct.xA2 || 0.06)));
      const px = THREE.MathUtils.lerp(prevX, target, 0.6);
      curvePoints.push({ z: -accumZ, x: px });
      accumZ += segLen;
      prevX = px;
    }
  }
  rebuildCurve();
  function pathX(z) {
    // 在曲线点之间线性插值，z 是负值向远处
    const zz = -z % roadLength;
    for (let i = 0; i < curvePoints.length - 1; i++) {
      const a = curvePoints[i], b = curvePoints[i+1];
      if (zz >= -b.z && zz <= -a.z) {
        const t = (zz + a.z) / (a.z - b.z + 1e-6);
        return THREE.MathUtils.lerp(a.x, b.x, t);
      }
    }
    return 0;
  }
  // JS 版工具函数（GLSL 等价）
  function fract01(x) { return x - Math.floor(x); }
  function smoothstep01(edge0, edge1, x) {
    const e0 = Math.min(edge0, edge1); const e1 = Math.max(edge0, edge1);
    if (e1 === e0) return x >= e1 ? 1 : 0;
    let t = (x - e0) / (e1 - e0);
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  }
  function pathY(z) {
    const ay = currentTheme.yA || 0.0; // 振幅（米）
    const zz = -z % roadLength;
    const t = zz / roadLength;
    // 叠加两种不同频率的起伏 + 突出短坡
    let y = (Math.sin((t + pathPhase * 0.0006) * Math.PI * 2) * ay)
          + (Math.sin((t * 2.0 + pathPhase * 0.0003) * Math.PI * 2) * ay * 0.5);
    // 每段路加入一个平滑“上坡-下坡”窗口
    const rampPhase = fract01((t + 0.1) * 3.0);
    const up = smoothstep01(0.15, 0.35, rampPhase);
    const down = 1 - smoothstep01(0.55, 0.75, rampPhase);
    const ramp = Math.max(0, up * down);
    y += ramp * ay * 0.9;
    return y;
  }
  // 蓝色速度拖尾（粒子/带体）
  const trail = new THREE.Group();
  const trailMats = [
    new THREE.MeshBasicMaterial({ color: 0x00bfff, transparent: true, opacity: 0.22 }),
    new THREE.MeshBasicMaterial({ color: 0x33e1ff, transparent: true, opacity: 0.16 }),
    new THREE.MeshBasicMaterial({ color: 0x80ffff, transparent: true, opacity: 0.1 })
  ];
  const trailGeos = [
    new THREE.PlaneGeometry(0.35, 1.6),
    new THREE.PlaneGeometry(0.28, 1.2),
    new THREE.PlaneGeometry(0.22, 0.9)
  ];
  for (let i = 0; i < 3; i++) {
    const stripL = new THREE.Mesh(trailGeos[i], trailMats[i]);
    const stripR = stripL.clone();
    stripL.position.set(-0.55, 0.32, 1.7 + i * 0.15);
    stripR.position.set(0.55, 0.32, 1.7 + i * 0.15);
    stripL.rotation.x = -Math.PI * 0.05;
    stripR.rotation.x = -Math.PI * 0.05;
    stripL.renderOrder = 2; stripR.renderOrder = 2;
    trail.add(stripL, stripR);
  }
  car.add(trail);

  // 速度粒子（增强速度感）
  const speedParticleCount = 900;
  const spGeo = new THREE.BufferGeometry();
  const spPositions = new Float32Array(speedParticleCount * 3);
  function randInRange(a,b){ return a + Math.random()*(b-a); }
  for (let i = 0; i < speedParticleCount; i++) {
    spPositions[i*3+0] = randInRange(-roadWidth*1.2, roadWidth*1.2);
    spPositions[i*3+1] = randInRange(0.2, 3.0);
    spPositions[i*3+2] = randInRange(-180, 6);
  }
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPositions, 3));
  const spMat = new THREE.PointsMaterial({ color: 0x66e0ff, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  const speedParticles = new THREE.Points(spGeo, spMat);
  scene.add(speedParticles);

  // 城市楼群（InstancedMesh）
  const buildingCount = 160;
  const buildingGeo = new THREE.BoxGeometry(1,1,1);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x1a2138, emissive: 0x0a1228, roughness: 0.85, metalness: 0.1 });
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, buildingCount);
  buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(buildings);
  // 程序化窗光（CanvasTexture，无外部资源）
  try {
    const size = 96; const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0,0,size,size);
    const cols = 8, rows = 12; const w = size/cols, h = size/rows;
    for (let y=0;y<rows;y++){
      for (let x=0;x<cols;x++){
        if (Math.random() < 0.38) {
          const padX = 3 + Math.random()*2, padY = 2 + Math.random()*2;
          const bw = w - padX*2, bh = h - padY*2;
          const hue = 48 + Math.random()*16; const sat = 70 + Math.random()*20; const light = 60 + Math.random()*20;
          ctx.fillStyle = `hsl(${hue},${sat}%,${light}%)`;
          ctx.fillRect(x*w+padX, y*h+padY, bw, bh);
        }
      }
    }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
    buildingMat.emissiveMap = tex; buildingMat.emissiveIntensity = 1.0; buildingMat.needsUpdate = true;
  } catch {}
  const buildingData = Array.from({length: buildingCount}, (_, i) => ({
    side: Math.random() < 0.5 ? -1 : 1,
    // 两条带：近带更靠近道路（1.0~1.25），远带保持原来的 1.6~2.0
    xOffset: (i % 2 === 0)
      ? THREE.MathUtils.randFloat(roadWidth * 1.05, roadWidth * 1.25)
      : THREE.MathUtils.randFloat(roadWidth * 1.6, roadWidth * 2.0),
    width: THREE.MathUtils.randFloat(0.8, 2.2),
    depth: THREE.MathUtils.randFloat(0.8, 2.2),
    height: THREE.MathUtils.randFloat(3.0, 10.0),
    zShift: THREE.MathUtils.randFloat(-30, -260),
  }));

  function resetGame() {
    speed = 0;
    score = 0;
    remainTime = 120;
    nitro = nitroMax * 0.4;
    drifting = false;
    driftDir = 0;
    car.position.set(0, 0, 2);
    car.rotation.set(0, 0, 0);
    wheels.forEach(w => w.rotation.x = 0);
    obstacles.forEach(o => {
      const { x, z } = randomObstaclePosition();
      o.position.set(x, 0.6, z);
    });
    pickups.forEach(p => spawnPickup(p));
    aiCars.forEach(a => spawnAICar(a));
    stripes.forEach((s, i) => {
      s.position.z = -i * (stripeLength + stripeGap);
      s.userData.baseX = 0; s.userData.baseY = 0.03;
    });
    camera.position.set(0, 4.4, 7.2);
    camera.fov = targetFov = 65; camera.updateProjectionMatrix();
    difficultyT = 0;
    canControl = false;
    // 初始隐藏结算面板
    endOverlay?.classList.add('hidden');
  }

  // 赛道主题预设（弯道/起伏强度）
  const THEMES = [
    { name: '直道冲刺', xA1: 0.0, xF1: 0.0, xA2: 0.0, xF2: 0.0, yA: 0.05 },
    { name: '连发弯',  xA1: 0.25, xF1: 0.015, xA2: 0.15, xF2: 0.005, yA: 0.08 },
    { name: '强起伏',  xA1: 0.1,  xF1: 0.008, xA2: 0.05, xF2: 0.003, yA: 0.22 },
  ];
  // 如果上面已设置默认 currentTheme，这里只在未定义时覆盖
  if (!currentTheme) currentTheme = THEMES[0];
  function setTheme(idx) { currentTheme = THEMES[(idx+THEMES.length)%THEMES.length]; if (themeNameEl) themeNameEl.textContent = currentTheme.name; }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyT') setTheme(THEMES.indexOf(currentTheme)+1); });

  // 开场倒计时：3→2→1→GO
  function runCountdown() {
    if (!countdownEl) { canControl = true; return; }
    const seq = ['3','2','1','GO'];
    let i = 0;
    countdownEl.classList.remove('hidden');
    const showNext = () => {
      if (i >= seq.length) {
        countdownEl.classList.add('hidden');
        canControl = true;
        return;
      }
      countdownEl.innerHTML = `<span>${seq[i++]}</span>`;
      setTimeout(showNext, i === seq.length ? 600 : 900);
    };
    showNext();
  }

  function startGame() {
    resetGame();
    running = true;
    paused = false;
    overlay.classList.remove('show');
    endOverlay?.classList.add('hidden');
    initAudio();
    setMuted(muted);
    // 显示历史最佳分 & 主题名
    try { const best = Number(localStorage.getItem('bestScore') || 0); if (bestEl) bestEl.textContent = String(best|0); } catch {}
    // 开场倒计时演出
    runCountdown();
  }
  // 暂停与重开
  function togglePause() { if (!running) return; paused = !paused; }
  function restartGame() { startGame(); }
  pauseBtn?.addEventListener('click', togglePause);
  restartBtn?.addEventListener('click', restartGame);
  lightBtn?.addEventListener('click', () => cycleLighting(+1));
  againBtn?.addEventListener('click', restartGame);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'KeyR') restartGame();
    if (e.code === 'KeyL') cycleLighting(+1);
  });

  // 保险起见：页面任何一次点击也可开始（避免按钮被挡住或事件丢失）
  document.addEventListener('pointerdown', () => {
    if (!running && (!endOverlay || endOverlay.classList.contains('hidden'))) startGame();
  }, { once: false });

  // 移动端：双击触发氮气
  let lastTap = 0;
  window.addEventListener('pointerdown', () => {
    const now = performance.now();
    if (now - lastTap < 280) keys.add('Space');
    lastTap = now;
  });

  if (startBtn) {
    startBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startGame();
    });
  }

  // 窗口尺寸变化
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
    try { if (fxaa) fxaa.setSize(w, h); } catch {}
  }
  window.addEventListener('resize', onResize);

  // 碰撞检测（近似 AABB）
  const carHalf = new THREE.Vector3(0.9, 0.6, 1.4);
  function isCollide(aPos, aHalf, bPos, bHalf) {
    return Math.abs(aPos.x - bPos.x) <= (aHalf.x + bHalf.x)
        && Math.abs(aPos.y - bPos.y) <= (aHalf.y + bHalf.y)
        && Math.abs(aPos.z - bPos.z) <= (aHalf.z + bHalf.z);
  }

  // 主循环
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.035);
    if (paused) {
      renderer.render(scene, camera);
      return;
    }

    // 按键/触控输入
    const accelerating = canControl && (keys.has('KeyW') || keys.has('ArrowUp') || (touching && (touchY < window.innerHeight * 0.35)));
    const braking = canControl && (keys.has('KeyS') || keys.has('ArrowDown') || (touching && (touchY > window.innerHeight * 0.65)));
    // 空格释放储存的氮气
    const nitroUsing = canControl && keys.has('Space');
    let steer = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) steer -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) steer += 1;
    if (touching) {
      if (touchX < window.innerWidth * 0.35) steer -= 1;
      if (touchX > window.innerWidth * 0.65) steer += 1;
    }

    if (running) {
      // 确保进行中时结算面板始终隐藏（防止上局状态残留）
      if (endOverlay && !endOverlay.classList.contains('hidden')) {
        endOverlay.classList.add('hidden');
      }
      // 倒计时（暂停时不走），仅在可控后开始扣减
      if (canControl) remainTime -= dt;
      if (remainTime <= 0) {
        remainTime = 0;
        running = false;
        paused = false;
        // 结算
        if (finalTimeEl) finalTimeEl.textContent = '120';
        if (finalScoreEl) finalScoreEl.textContent = String(Math.round(score));
        try {
          const best = Number(localStorage.getItem('bestScore') || 0);
          const newBest = Math.max(best, Math.round(score));
          localStorage.setItem('bestScore', String(newBest));
          if (finalBestEl) finalBestEl.textContent = String(newBest);
          if (bestEl) bestEl.textContent = String(newBest);
        } catch {}
        endOverlay?.classList.remove('hidden');
      }
      // 纵向速度
      if (accelerating) speed += accel * dt;
      else speed -= naturalDecel * dt;
      if (braking) speed -= brakeDecel * dt;
      // 氮气加速/消耗
      if (nitroUsing && nitro > 0.1) {
        speed += nitroBoost * dt;
        nitro = Math.max(0, nitro - nitroConsumePerSecond * dt);
        // 连发音效与计时（短时间内连续使用强化音高）
        if (audioCtx) {
          if (performance.now() - comboTimer > 450) comboCount = 0;
          playNitroCombo();
        }
      } else {
        nitro = Math.min(nitroMax, nitro + nitroGainPerSecond * dt);
      }
      // 难度随时间提升：最大速度/AI 速度/障碍密度轻微上调
      difficultyT += dt;
      const diffK = Math.min(1.0, difficultyT / 90); // 1.5 分钟趋近满值
      const maxSpeedDynamic = (maxSpeed + 10 * diffK);
      speed = Math.max(0, Math.min(maxSpeedDynamic + nitroBoost * 0.6, speed));

      // 横向移动
      const gripFactor = drifting ? (1 - driftGripLoss) : 1;
      car.position.x += steer * steerSpeed * dt * gripFactor;
      car.position.x = Math.max(-maxSteerX, Math.min(maxSteerX, car.position.x));

      // 视觉：车身倾斜与方向
      const targetTilt = THREE.MathUtils.degToRad(-10 * steer - (drifting ? driftDir * 8 : 0));
      car.rotation.z = THREE.MathUtils.lerp(car.rotation.z, targetTilt, 0.12);
      // 简易漂移判断：高速且大幅转向时进入漂移
      const wantDrift = Math.abs(steer) > 0.6 && speed > maxSpeedDynamic * 0.45 && !braking && !nitroUsing;
      if (wantDrift && !drifting) {
        drifting = true; driftDir = Math.sign(steer);
      }
      if (!wantDrift) {
        drifting = false; driftDir = 0;
      }

      // 车轮转动
      const spin = speed * dt * 2.4;
      wheels.forEach(w => w.rotation.x -= spin);

      // 让场景向后运动（通过移动物体实现“前进”效果）
      const dz = speed * dt;
      pathPhase += dz; // 世界位相向后
      stripes.forEach((s) => {
        s.position.z += dz;
        if (s.position.z > 10) s.position.z -= (stripeLength + stripeGap) * stripeCount;
        s.position.x = (s.userData.baseX || 0) + pathX(s.position.z);
        s.position.y = (s.userData.baseY || 0.03) + pathY(s.position.z) * 0.2;
      });
      // 如需路面网格随弯道变形，可开启 ENABLE_ROAD_DEFORM。
      if (ENABLE_ROAD_DEFORM) {
        const pos = roadPos;
        const arr = pos.array;
        const base = roadBase;
        const verts = pos.count;
        for (let i = 0; i < verts; i++) {
          const ix = i * 3;
          const bx = base[ix];
          const by = base[ix+1];
          const bz = base[ix+2];
          const worldZ = road.position.z + bz + dz;
          // 横向随弯道偏移，纵向抬升表现上坡
          arr[ix]   = bx + pathX(worldZ);
          arr[ix+1] = by + pathY(worldZ) * 0.45; // 适中抬升，避免画面飞出
          arr[ix+2] = bz;
        }
        pos.needsUpdate = true;
      }

      obstacles.forEach((o) => {
        o.position.z += dz;
        if (o.position.z > 6) {
          const { x, z } = randomObstaclePosition();
          o.position.set(x, 0.6, z);
          o.userData.baseX = x;
        }
        o.position.x = (o.userData.baseX || 0) + pathX(o.position.z);
        o.position.y = 0.6 + pathY(o.position.z) * 0.25;
      });

      // 道具移动与旋转
      pickups.forEach((p) => {
        p.rotation.y += 1.4 * dt;
        p.position.z += dz;
        if (p.position.z > 6) { spawnPickup(p); p.userData.baseX = p.position.x; }
        p.position.x = (p.userData.baseX || 0) + pathX(p.position.z);
        p.position.y = 0.6 + pathY(p.position.z) * 0.25;
      });

      // AI 车辆行为
      aiCars.forEach((a) => {
        // 相对纵向运动：玩家速度 - AI 自身速度
        const aiV = (a.userData.speed || 0) + 6 * diffK; // 随难度略增
        a.position.z += (speed - aiV) * dt;
        if (a.position.z > 8) { spawnAICar(a); a.userData.baseX = a.position.x; }

        // 简单避让：接近玩家时尝试横向错位
        const zDelta = Math.abs(a.position.z - car.position.z);
        if (zDelta < 6) {
          const dx = a.position.x - car.position.x;
          const desired = dx >= 0 ? a.position.x + 2.0 : a.position.x - 2.0;
          a.userData.targetX = THREE.MathUtils.clamp(desired, -maxSteerX + 0.5, maxSteerX - 0.5);
        } else if (Math.random() < 0.003) {
          // 偶尔换道
          a.userData.targetX = THREE.MathUtils.randFloat(-maxSteerX + 0.5, maxSteerX - 0.5);
        }
        const steerSign = Math.sign((a.userData.targetX || 0) - a.position.x);
        a.position.x += steerSign * (CFG.gameplay?.aiSteerSpeed ?? 6) * dt;
        a.position.x = THREE.MathUtils.clamp(a.position.x, -maxSteerX, maxSteerX);
        a.position.x = (a.userData.baseX || 0) + pathX(a.position.z);
        a.position.y = pathY(a.position.z) * 0.2;
        // 跟车蓄力：在玩家前方一定距离内且同车道方向获得氮气
        const dzFollow = a.position.z - car.position.z;
        if (dzFollow > 0 && dzFollow < 6 && Math.abs(a.position.x - car.position.x) < 2.2) {
          nitro = Math.min(nitroMax, nitro + 6 * dt);
        }
      });

      // 路侧桩/加速垫移动
      posts.forEach((p) => {
        p.position.z += dz;
        if (p.position.z > 10) p.position.z -= roadLength;
        p.position.x = (p.userData.baseX || 0) + pathX(p.position.z);
        p.position.y = 0.3 + pathY(p.position.z) * 0.2;
      });
      // 更新路灯与指示牌（沿路径采样均匀分布，远处密近处疏）
      for (let i = 0; i < lampCount; i++) {
        const m = new THREE.Matrix4();
        const z = - (i * (roadLength / lampCount)) - (pathPhase % roadLength);
        const x = pathX(z) + ((i % 2 === 0) ? roadWidth * 0.55 : -roadWidth * 0.55);
        const y = 1.1 + pathY(z) * 0.25; // 适度跟随地形，避免过度起伏
        m.makeTranslation(x, y, z);
        lamp.setMatrixAt(i, m);
      }
      lamp.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < signCount; i++) {
        const m = new THREE.Matrix4();
        const z = - (i * (roadLength / signCount)) - (pathPhase % roadLength) - 20;
        const x = pathX(z) + roadWidth * 0.65; // 外弯一侧默认右侧
        const y = 0.6 + pathY(z) * 0.22;
        m.makeTranslation(x, y, z);
        signs.setMatrixAt(i, m);
      }
      signs.instanceMatrix.needsUpdate = true;
      boostPads.forEach((b)=>{
        b.position.z += dz;
        if (b.position.z > 10) b.position.z -= roadLength;
        b.position.x = pathX(b.position.z) * 0.6;
        b.position.y = 0.02 + pathY(b.position.z) * 0.02;
      });

      // 碰撞检测
      let hit = obstacles.find(o => isCollide(car.position, carHalf, o.position, new THREE.Vector3(0.9, 0.6, 0.9)));
      if (!hit) {
        hit = aiCars.find(a => isCollide(car.position, carHalf, a.position, new THREE.Vector3(0.9, 0.6, 1.4)));
      }
      if (hit) {
        playHit();
        score = Math.max(0, score - (CFG.gameplay?.hitPenalty ?? 150));
        // 反弹/减速
        speed = Math.max(0, speed * 0.5);
        // 轻微抖动
        car.position.z = 2 + Math.sin(performance.now() * 0.02) * 0.2;
        camShake = Math.min(0.35, camShake + 0.22);
        // 移走该障碍避免连续判定
        if (hit instanceof THREE.Group) {
          spawnAICar(hit);
        } else {
          const { x, z } = randomObstaclePosition();
          hit.position.set(x, 0.6, z);
        }
      } else {
        car.position.z = 2;
      }

      // 拾取道具
      const pIndex = pickups.findIndex(p => isCollide(car.position, carHalf, p.position, new THREE.Vector3(0.5, 0.5, 0.5)));
      if (pIndex >= 0) {
        const p = pickups[pIndex];
        playPickup();
        if (p.userData.type === 'nitro') {
          nitro = Math.min(nitroMax, nitro + (CFG.gameplay?.pickupNitroAmount ?? 35));
        } else {
          score += (CFG.gameplay?.pickupScoreAmount ?? 200);
        }
        spawnPickup(p);
      }

      // 经过加速垫
      if (boostPads.some(b => isCollide(car.position, carHalf, b.position, new THREE.Vector3(2.0, 0.1, 3.0)))) {
        speed = Math.min(maxSpeed + nitroBoost, speed + 12);
        // 小幅度氮气获取
        nitro = Math.min(nitroMax, nitro + 10);
      }

      // 积分（随时间与速度增长），开场倒计时期间不计分
      if (canControl) {
        score += dt * ((CFG.gameplay?.baseScoreRate ?? 2.0) + speed * (CFG.gameplay?.speedScoreFactor ?? 0.35)) * (1 + 0.25 * diffK);
      }
      if (drifting) {
        score += dt * driftScoreRate * (1 + Math.abs(steer));
        nitro = Math.min(nitroMax, nitro + 8 * dt); // 漂移蓄力
      }

      // 引擎/风噪联动
      if (audioCtx) {
        const rpm = 500 + speed * 60; // 速度对应转速感
        const vol = Math.min(0.65, speed / (maxSpeed * 0.9));
        engineOsc.frequency.setTargetAtTime(rpm / 60, audioCtx.currentTime, 0.04);
        // 漂移时提高引擎音与风噪
        engineGain.gain.setTargetAtTime(vol * (drifting ? 1.25 : 1.0), audioCtx.currentTime, 0.08);
        windGain.gain.setTargetAtTime(Math.max(0, vol - 0.25) * (drifting ? 1.4 : 1.0), audioCtx.currentTime, 0.12);
        hitGain.gain.value = 1.0; // 撞击包络会单独调制
      }

      // 拖尾强度与长度（随速度/氮气增强）
      const trailAlpha = THREE.MathUtils.clamp((speed - maxSpeed * 0.35) / (maxSpeed * 0.9), 0, 1);
      const nitroBoosting = nitroUsing && nitro > 0.1 ? 1 : 0;
      trail.visible = trailAlpha > 0.02 || nitroBoosting > 0;
      if (trail.visible) {
        const s = 1 + 0.8 * trailAlpha + 0.6 * nitroBoosting;
        trail.scale.set(1, s, 1);
        trail.position.z = -0.2 - 0.2 * s;
        trailMats[0].opacity = 0.18 + 0.35 * trailAlpha + 0.25 * nitroBoosting;
        trailMats[1].opacity = 0.12 + 0.25 * trailAlpha + 0.18 * nitroBoosting;
        trailMats[2].opacity = 0.08 + 0.20 * trailAlpha + 0.12 * nitroBoosting;
      }

      // 氮气喷焰/火花（尾部喷口） & 刹车灯增强
      if (nitroBoosting) {
        // 每帧多枚火焰与火花，形成更夸张喷射
        spawnFlame(exhaustL); spawnFlame(exhaustR);
        if (Math.random() < 0.8) { spawnFlame(exhaustL); spawnFlame(exhaustR); }
        spawnSpark(exhaustL); spawnSpark(exhaustR);
        if (Math.random() < 0.7) { spawnSpark(exhaustL); spawnSpark(exhaustR); }
        exhaustGlowL.material.opacity = 0.7; exhaustGlowR.material.opacity = 0.7;
      } else {
        exhaustGlowL.material.opacity = Math.max(0, exhaustGlowL.material.opacity - 0.08);
        exhaustGlowR.material.opacity = Math.max(0, exhaustGlowR.material.opacity - 0.08);
      }
      // 刹车时尾灯更亮更大
      const tailIntensity = braking ? 1.0 : 0.5;
      tailL.material.opacity = THREE.MathUtils.lerp(tailL.material.opacity, 0.55 * tailIntensity, 0.2);
      tailR.material.opacity = THREE.MathUtils.lerp(tailR.material.opacity, 0.55 * tailIntensity, 0.2);
      tailL.scale.setScalar(0.32 * (braking ? 1.25 : 1.0));
      tailR.scale.setScalar(0.32 * (braking ? 1.25 : 1.0));

      // 漂移烟尘/轮胎痕：从后轮位置生成
      if (drifting) {
        const rearL = new THREE.Vector3(-0.9, 0.35, 1.1).applyMatrix4(car.matrixWorld);
        const rearR = new THREE.Vector3(0.9, 0.35, 1.1).applyMatrix4(car.matrixWorld);
        spawnSmoke(rearL.x, rearL.y, rearL.z);
        spawnSmoke(rearR.x, rearR.y, rearR.z);
        if (Math.random() < 0.8) { spawnSkid(rearL.x, 0.02, rearL.z); }
        if (Math.random() < 0.8) { spawnSkid(rearR.x, 0.02, rearR.z); }
      }

      // 摄像机 FOV 随速度变化、并平滑跟随（含轻微抖动）
      const speedRatio = speed / (maxSpeed + nitroBoost);
      targetFov = 65 + 10 * speedRatio;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.06);
      camera.updateProjectionMatrix();

      // 底盘霓虹强度（随速度与氮气）
      const glowTarget = THREE.MathUtils.clamp(speedRatio * 0.6 + (nitro > 0.1 && keys.has('Space') ? 0.7 : 0), 0, 1);
      underglow.material.opacity = THREE.MathUtils.lerp(underglow.material.opacity, glowTarget, 0.15);

      // Bloom/色散 与氮气联动
      if (bloom) {
        const current = (typeof bloom.intensity === 'number') ? bloom.intensity : (bloom.blendMode && bloom.blendMode.opacity ? bloom.blendMode.opacity.value : 0);
        const target = 0.45 + 0.35 * (keys.has('Space') && nitro > 0.1 ? 1 : 0);
        const next = THREE.MathUtils.lerp(current, target, 0.1);
        if (typeof bloom.intensity === 'number') bloom.intensity = next;
        else if (bloom.blendMode && bloom.blendMode.opacity) bloom.blendMode.opacity.value = next;
      }
      if (chromatic && chromatic.offset) {
        const t = (keys.has('Space') && nitro > 0.1) ? 1.0 : speedRatio;
        const base = 0.0006; const extra = 0.0016 * t;
        chromatic.offset.set(base + extra, base + extra);
      }
      camShake = Math.max(0, camShake - camShakeDecay * dt);
      const jitterX = (Math.random() - 0.5) * camShake;
      const jitterY = (Math.random() - 0.5) * camShake * 0.6;
      // 摄像机随地形高度的影响适当减弱，避免上坡时镜头“抬太多”看不见地面
      const desiredCamPos = new THREE.Vector3(car.position.x * 0.25 + jitterX, 4.6 + pathY(0) * 0.05 + jitterY, 8.4);
      camera.position.lerp(desiredCamPos, 0.06);
      camTarget.set(car.position.x * 0.35, 0.8 + pathY(-4) * 0.05, -4);
      camera.lookAt(camTarget);
    } else {
      // 未开始：轻微呼吸动画
      car.rotation.y = Math.sin(performance.now() * 0.001) * 0.1;
      camera.lookAt(camTarget.set(0, 0.8, -4));
    }

    // HUD
    speedEl.textContent = Math.round(speed * 3.6);
    scoreEl.textContent = Math.round(score);
    if (nitroFill) nitroFill.style.width = `${(nitro / nitroMax) * 100}%`;
    if (timerEl) timerEl.textContent = String(Math.max(0, Math.ceil(remainTime)));

    // 保存最佳分
    try {
      const s = Math.round(score);
      const best = Number(localStorage.getItem('bestScore') || 0);
      if (s > best) {
        localStorage.setItem('bestScore', String(s));
        if (bestEl) bestEl.textContent = String(s);
      }
    } catch {}

    // 动态分辨率自适应（每秒评估帧率，低于 55fps 则降分辨率，上于 75fps 则升）
    frameCounter++;
    const now = performance.now();
    if (now - lastFpsCheck > 1000) {
      const fps = frameCounter * 1000 / (now - lastFpsCheck);
      frameCounter = 0; lastFpsCheck = now;
      if (fps < 55 && renderPixelRatio > 1.0) { renderPixelRatio = Math.max(0.8, renderPixelRatio - 0.1); renderer.setPixelRatio(renderPixelRatio); }
      else if (fps > 75 && renderPixelRatio < Math.min(window.devicePixelRatio || 1, 2)) { renderPixelRatio = Math.min(Math.min(window.devicePixelRatio || 1, 2), renderPixelRatio + 0.1); renderer.setPixelRatio(renderPixelRatio); }
    }

    // 更新喷焰/火花/烟尘/轮胎痕 生命周期
    for (let i = activeFlames.length - 1; i >= 0; i--) {
      const m = activeFlames[i]; m.userData.t += dt;
      const t = m.userData.t / m.userData.max;
      if (t >= 1) { scene.remove(m); flamePool.push(m); activeFlames.splice(i,1); continue; }
      m.position.x += m.userData.vx * dt;
      m.position.y += m.userData.vy * dt;
      m.position.z += m.userData.vz * dt + speed * dt * 0.05;
      m.scale.setScalar(1 + t * 2.2);
      m.material.opacity = 0.95 * (1 - t);
      m.material.color.setHSL(0.55 - 0.3 * t, 1.0, 0.5 + 0.25 * (1 - t));
    }
    for (let i = activeSparks.length - 1; i >= 0; i--) {
      const m = activeSparks[i]; m.userData.t += dt;
      const t = m.userData.t / m.userData.max;
      if (t >= 1) { scene.remove(m); sparkPool.push(m); activeSparks.splice(i,1); continue; }
      m.position.x += m.userData.vx * dt;
      m.position.y += m.userData.vy * dt;
      m.position.z += m.userData.vz * dt + speed * dt * 0.05;
      m.material.opacity = 0.85 * (1 - t);
      m.scale.setScalar(1 + t * 0.9);
    }
    for (let i = activeSmokes.length - 1; i >= 0; i--) {
      const m = activeSmokes[i]; m.userData.t += dt;
      const t = m.userData.t / m.userData.max;
      if (t >= 1) { scene.remove(m); smokePool.push(m); activeSmokes.splice(i,1); continue; }
      m.position.x += m.userData.vx * dt;
      m.position.y += m.userData.vy * dt;
      m.position.z += m.userData.vz * dt - speed * dt * 0.05;
      m.material.opacity = 0.35 * (1 - t);
      m.scale.set(1 + t * 1.2, 1 + t * 1.2, 1);
    }
    for (let i = activeSkids.length - 1; i >= 0; i--) {
      const m = activeSkids[i]; m.userData.t += dt;
      const t = m.userData.t / m.userData.max;
      // 跟随世界推进
      m.position.z += speed * dt;
      // 长度与透明度随时间增长后衰减
      const grow = Math.min(1.0, t * 3.0);
      m.scale.y = 0.8 + grow * 2.2;
      m.material.opacity = (1.0 - t) * 0.28;
      if (t >= 1 || m.position.z > 6) { scene.remove(m); skidPool.push(m); activeSkids.splice(i,1); }
    }

    // 速度粒子推进与回收
    {
      const attr = speedParticles.geometry.attributes.position;
      const arr = attr.array;
      for (let i = 0; i < speedParticleCount; i++) {
        const ix = i*3;
        arr[ix+2] += speed * dt * 1.8;
        if (arr[ix+2] > 6) {
          arr[ix+0] = randInRange(-roadWidth*1.2, roadWidth*1.2);
          arr[ix+1] = randInRange(0.2, 3.0);
          arr[ix+2] = -180 + Math.random() * -20;
        }
      }
      attr.needsUpdate = true;
    }

    // 更新楼群实例矩阵
    for (let i = 0; i < buildingCount; i++) {
      const d = buildingData[i];
      const m = new THREE.Matrix4();
      const z = - (i * (roadLength / buildingCount)) - (pathPhase % roadLength) + d.zShift;
      const x = pathX(z) + d.side * d.xOffset;
      const y = d.height/2 + pathY(z) * 0.05;
      const s = new THREE.Vector3(d.width, d.height, d.depth);
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), s);
      buildings.setMatrixAt(i, m);
    }
    buildings.instanceMatrix.needsUpdate = true;

    if (composer && window.POSTPROCESSING) composer.render();
    else renderer.render(scene, camera);
  }

  // 初次布局
  onResize();
  overlay.classList.add('show');
  setMuted(false);
  tick();
})();
