import * as THREE from 'three';

/**
 * 场景搭建:夜景基地、地面网格、雾、灯光、星空。
 */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060c);
  scene.fog = new THREE.FogExp2(0x060a14, 0.0032);

  // ---------- 灯光 ----------
  const hemi = new THREE.HemisphereLight(0x35507a, 0x0a0d14, 0.55);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0x8fb4ff, 0.65);
  moon.position.set(-120, 180, -80);
  scene.add(moon);

  // 基地泛光灯
  const baseGlow = new THREE.PointLight(0x2ce8f5, 120, 160, 1.8);
  baseGlow.position.set(0, 6, 0);
  scene.add(baseGlow);

  // ---------- 地面 ----------
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(600, 96),
    new THREE.MeshStandardMaterial({
      color: 0x0b0f18,
      roughness: 0.92,
      metalness: 0.15,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // 工业风网格线
  const grid = new THREE.GridHelper(560, 56, 0x1a3350, 0x101c2e);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  grid.position.y = 0.02;
  scene.add(grid);

  // 中心停机坪同心圆标线
  const padRings = new THREE.Group();
  for (const [radius, color, opacity] of [
    [24, 0x2ce8f5, 0.8],
    [48, 0x1c5a70, 0.5],
    [90, 0x14405a, 0.35],
  ] as [number, number, number][]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.35, radius + 0.35, 128),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    padRings.add(ring);
  }
  scene.add(padRings);

  // 停机坪放射状标线
  const spokeMat = new THREE.MeshBasicMaterial({
    color: 0x17506a, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 22), spokeMat);
    const angle = (i / 8) * Math.PI * 2;
    spoke.rotation.x = -Math.PI / 2;
    spoke.rotation.z = angle;
    spoke.position.set(Math.sin(angle) * 36, 0.04, Math.cos(angle) * 36);
    scene.add(spoke);
  }

  // ---------- 基地建筑群(低多边形剪影) ----------
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0x0e1420, roughness: 0.85, metalness: 0.3,
  });
  const towerPositions: [number, number, number, number][] = [
    // x, z, 宽, 高
    [-150, -120, 18, 42],
    [-128, -138, 12, 28],
    [165, -100, 22, 36],
    [148, 130, 14, 50],
    [-160, 140, 16, 30],
    [180, 20, 10, 24],
  ];
  for (const [x, z, w, h] of towerPositions) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), buildingMat);
    tower.position.set(x, h / 2, z);
    scene.add(tower);
    // 塔顶警示灯
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3344 }),
    );
    beacon.position.set(x, h + 1.2, z);
    beacon.userData.isBeacon = true;
    scene.add(beacon);
  }

  // 指挥塔
  const commandTower = new THREE.Group();
  const towerBase = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 7, 26, 8),
    buildingMat,
  );
  towerBase.position.y = 13;
  commandTower.add(towerBase);
  const towerTop = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 6, 6, 8),
    new THREE.MeshStandardMaterial({
      color: 0x122030, roughness: 0.4, metalness: 0.6,
      emissive: 0x0a2a3a, emissiveIntensity: 0.8,
    }),
  );
  towerTop.position.y = 29;
  commandTower.add(towerTop);
  commandTower.position.set(-90, 0, 70);
  scene.add(commandTower);

  // ---------- 星空 ----------
  const starCount = 1600;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // 上半球均匀分布
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.95);
    const r = 900;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi);
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const intensity = 0.3 + Math.random() * 0.7;
    const warm = Math.random() > 0.8;
    starColors[i * 3] = intensity * (warm ? 1 : 0.8);
    starColors[i * 3 + 1] = intensity * 0.9;
    starColors[i * 3 + 2] = intensity;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 1.6, vertexColors: true, sizeAttenuation: false,
    transparent: true, opacity: 0.85, depthWrite: false,
  }));
  scene.add(stars);

  return scene;
}

/**
 * 反射环境(供 PMREM 烘焙):冷色调夜空穹顶 + 数条蓝白灯带,
 * 让金属机身呈现冷峻的高光,而不是影棚环境的暖白泛光。
 */
export function createEnvironmentScene(): THREE.Scene {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x01030a);

  // 穹顶:顶部深蓝微亮、地平线附近近黑
  const domeGeo = new THREE.SphereGeometry(50, 24, 16);
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0x0a1626,
    side: THREE.BackSide,
  });
  env.add(new THREE.Mesh(domeGeo, domeMat));

  // 月光方向的大面积柔和光板
  const moonPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 14),
    new THREE.MeshBasicMaterial({ color: 0x9cc4ff, side: THREE.DoubleSide }),
  );
  moonPanel.position.set(-24, 28, -16);
  moonPanel.lookAt(0, 0, 0);
  env.add(moonPanel);

  // 几条窄灯带:制造金属边缘的锐利高光
  const stripCfgs: [number, number, number, number][] = [
    // x, y, z, 色
    [22, 18, 8, 0x6fd8e8],
    [-6, 22, 26, 0xbdd6ff],
    [10, 6, -28, 0x3a86b8],
  ];
  for (const [x, y, z, color] of stripCfgs) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 1.6),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    strip.position.set(x, y, z);
    strip.lookAt(0, 4, 0);
    env.add(strip);
  }

  // 地面:基地青色泛光的微弱映照
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 24),
    new THREE.MeshBasicMaterial({ color: 0x06222a }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  env.add(floor);

  return env;
}

/** 每帧更新场景中的动态元素(警示灯闪烁) */
export function updateSceneEffects(scene: THREE.Scene, time: number): void {
  scene.traverse((obj) => {
    if (obj.userData.isBeacon) {
      const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const blink = Math.sin(time * 2.4 + obj.position.x) > 0.6 ? 1 : 0.12;
      mat.color.setRGB(blink, blink * 0.2, blink * 0.25);
    }
  });
}
