/**
 * Muted portfolio hardware renderer.
 *
 * The display treatment adapts the VHS shader and Bayer dither technique from
 * Canvas UI by David Haz (MIT + Commons Clause, 2026). The semantic DOM screens
 * remain authoritative; these shaders only add optional glass/noise and a small
 * dithered status object. See docs/licenses/canvas-ui.md.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const stage = document.querySelector<HTMLElement>('[data-device-stage]');
const canvas = document.querySelector<HTMLCanvasElement>('[data-device-canvas]');

if (stage && canvas) {
  startDevice(stage, canvas);
}

function startDevice(stage: HTMLElement, canvas: HTMLCanvasElement): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const surface = stage.dataset.deviceSurface === 'home' ? 'home' : 'route';
  let renderer: THREE.WebGLRenderer;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    document.documentElement.dataset.webgl = 'unavailable';
    return;
  }

  if (renderer.getContext().isContextLost()) {
    document.documentElement.dataset.webgl = 'unavailable';
    renderer.dispose();
    return;
  }

  document.documentElement.dataset.webgl = 'available';
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 60);
  camera.position.set(0, 14, 0.001);
  camera.lookAt(0, 0, 0);

  const world = new THREE.Group();
  scene.add(world);

  const graphite = new THREE.MeshStandardMaterial({
    color: 0x253349,
    roughness: 0.78,
    metalness: 0.08,
  });
  const graphiteDark = new THREE.MeshStandardMaterial({
    color: 0x111b2a,
    roughness: 0.72,
    metalness: 0.12,
  });
  const seam = new THREE.MeshStandardMaterial({
    color: 0x0b111c,
    roughness: 0.88,
    metalness: 0.04,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x06111f,
    roughness: 0.2,
    metalness: 0.05,
    transmission: 0.08,
    transparent: true,
    opacity: 0.9,
    clearcoat: 0.45,
  });

  const ambient = new THREE.HemisphereLight(0xd6dcf0, 0x1a2030, 1.5);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xe6e8f1, 4.5);
  key.position.set(-5, 12, -7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7890b6, 1.4);
  fill.position.set(8, 8, 7);
  scene.add(fill);

  const desk = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 28),
    new THREE.MeshStandardMaterial({ color: 0x77798a, roughness: 0.96 }),
  );
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.5;
  desk.receiveShadow = true;
  scene.add(desk);

  const statusPass = createDitheredStatus(renderer);
  if (surface === 'home') buildHome();
  else buildRoute();

  const startedAt = performance.now();
  let visible = !document.hidden;
  let inView = true;
  let disposed = false;
  const pointerTarget = new THREE.Vector2();
  const pointerCurrent = new THREE.Vector2();

  const onPointer = (event: PointerEvent) => {
    if (reducedMotion.matches) return;
    pointerTarget.set(
      (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2,
      (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2,
    );
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const onVisibility = () => {
    visible = !document.hidden;
  };
  document.addEventListener('visibilitychange', onVisibility);

  const viewObserver = new IntersectionObserver((entries) => {
    inView = entries.at(-1)?.isIntersecting ?? true;
  });
  viewObserver.observe(stage);

  const resize = () => {
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    const frustumHeight = surface === 'home' ? 8.75 : 9.25;
    const aspect = width / height;
    camera.left = (-frustumHeight * aspect) / 2;
    camera.right = (frustumHeight * aspect) / 2;
    camera.top = frustumHeight / 2;
    camera.bottom = -frustumHeight / 2;
    camera.updateProjectionMatrix();
    statusPass.resize(dpr);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  renderer.setAnimationLoop(() => {
    if (!visible || !inView || disposed) return;
    const elapsed = reducedMotion.matches ? 0 : (performance.now() - startedAt) / 1000;
    pointerCurrent.lerp(pointerTarget, 0.045);
    if (!reducedMotion.matches) {
      world.rotation.z = -pointerCurrent.x * 0.009;
      world.rotation.x = pointerCurrent.y * 0.006;
    } else {
      world.rotation.set(0, 0, 0);
    }
    statusPass.render(elapsed);
    updateVhsTime(world, elapsed);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  });

  const destroy = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    viewObserver.disconnect();
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    statusPass.dispose();
    disposeObject(scene);
    renderer.dispose();
  };
  window.addEventListener('pagehide', destroy, { once: true });

  function buildHome() {
    const top = roundedHousing(7.45, 3.65);
    top.position.set(0, 0, -2.12);
    world.add(top);
    const bottom = roundedHousing(7.45, 4.15);
    bottom.position.set(0, 0, 2.03);
    world.add(bottom);

    const topScreen = screen(6.5, 2.62);
    topScreen.position.set(0, 0.42, -2.16);
    world.add(topScreen);
    const lowerScreen = screen(3.55, 2.52);
    lowerScreen.position.set(0, 0.43, 2.08);
    world.add(lowerScreen);

    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6.9, 24), graphiteDark);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, 0.26, -0.12);
    hinge.castShadow = true;
    world.add(hinge);
    for (const x of [-3.45, 3.45]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.48, 20), seam);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x, 0.26, -0.12);
      world.add(cap);
    }

    const dpad = new THREE.Group();
    const padVertical = controlBox(0.62, 1.45, 0.17);
    const padHorizontal = controlBox(1.45, 0.62, 0.17);
    dpad.add(padVertical, padHorizontal);
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 24), graphiteDark);
    center.position.y = 0.12;
    dpad.add(center);
    dpad.position.set(-2.62, 0.44, 2.05);
    world.add(dpad);

    const open = controlBox(0.76, 0.7, 0.18);
    open.position.set(2.69, 0.44, 1.45);
    world.add(open);
    const back = controlBox(0.76, 0.7, 0.18);
    back.position.set(2.69, 0.44, 2.58);
    world.add(back);

    const statusPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.45, 1.45),
      new THREE.MeshBasicMaterial({
        map: statusPass.texture,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    statusPlane.rotation.x = -Math.PI / 2;
    statusPlane.position.set(2.08, 0.49, -2.14);
    world.add(statusPlane);

    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.68, 1.15, 24),
      new THREE.MeshStandardMaterial({ color: 0x303444, roughness: 0.82 }),
    );
    mug.position.set(-6.15, 0.1, -4.12);
    mug.castShadow = true;
    world.add(mug);

    const notebook = new THREE.Mesh(
      new RoundedBoxGeometry(3.3, 0.12, 4.4, 2, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x666977, roughness: 0.96 }),
    );
    notebook.position.set(6.25, -0.2, -3.8);
    notebook.rotation.y = -0.12;
    notebook.castShadow = true;
    world.add(notebook);
  }

  function buildRoute() {
    const aspect = Math.min(window.innerWidth / Math.max(window.innerHeight, 1), 1.75);
    const frameWidth = Math.max(9.2, 8.35 * aspect);
    const frame = roundedHousing(frameWidth, 8.1, 0.52);
    frame.position.set(0, 0, 0);
    world.add(frame);
    const routeGlass = screen(frameWidth - 0.72, 7.38);
    routeGlass.position.set(0, 0.43, 0);
    world.add(routeGlass);
    const statusPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.48),
      new THREE.MeshBasicMaterial({
        map: statusPass.texture,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    statusPlane.rotation.x = -Math.PI / 2;
    statusPlane.position.set(frameWidth / 2 - 0.74, 0.49, -3.42);
    world.add(statusPlane);
  }

  function roundedHousing(width: number, depth: number, height = 0.52): THREE.Group {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 5, 0.2), graphite);
    shell.castShadow = true;
    shell.receiveShadow = true;
    group.add(shell);
    const inset = new THREE.Mesh(
      new RoundedBoxGeometry(width - 0.28, 0.06, depth - 0.28, 4, 0.14),
      graphiteDark,
    );
    inset.position.y = height / 2 + 0.02;
    group.add(inset);
    return group;
  }

  function screen(width: number, depth: number): THREE.Group {
    const group = new THREE.Group();
    const recess = new THREE.Mesh(new RoundedBoxGeometry(width + 0.2, 0.15, depth + 0.2, 4, 0.12), seam);
    group.add(recess);
    const pane = new THREE.Mesh(new RoundedBoxGeometry(width, 0.09, depth, 4, 0.1), glass);
    pane.position.y = 0.08;
    group.add(pane);
    const vhs = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.985, depth * 0.98), createVhsGlassMaterial());
    vhs.rotation.x = -Math.PI / 2;
    vhs.position.y = 0.135;
    vhs.userData.vhs = true;
    group.add(vhs);
    return group;
  }

  function controlBox(width: number, depth: number, height: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, 0.09), graphiteDark);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    return mesh;
  }
}

function createVhsGlassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0x8192b5) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uTint;

      float hash(vec2 v) {
        return fract(sin(dot(v, vec2(89.44, 19.36))) * 22189.22);
      }

      void main() {
        float grain = hash(vUv * vec2(780.0, 480.0) + fract(uTime) * vec2(127.1, 311.7)) - 0.5;
        float scan = sin(vUv.y * 900.0 * 3.14159265) * 0.5;
        float slowBeat = sin(vUv.y * 9.0 - uTime * 0.45) * 0.5 + 0.5;
        float alpha = 0.024 + grain * 0.018 + scan * 0.012 + slowBeat * 0.008;
        gl_FragColor = vec4(uTint, clamp(alpha, 0.006, 0.065));
      }
    `,
  });
}

function updateVhsTime(root: THREE.Object3D, elapsed: number): void {
  root.traverse((object) => {
    if (!object.userData.vhs) return;
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    mesh.material.uniforms.uTime.value = elapsed;
  });
}

function createDitheredStatus(renderer: THREE.WebGLRenderer) {
  const size = 256;
  const rawTarget = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  const ditherTarget = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  rawTarget.texture.colorSpace = THREE.SRGBColorSpace;
  ditherTarget.texture.colorSpace = THREE.SRGBColorSpace;

  const statusScene = new THREE.Scene();
  const statusCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
  statusCamera.position.set(0, 0, 4.4);
  const object = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.05, 1),
    new THREE.MeshBasicMaterial({ color: 0x9aa9c7, wireframe: true }),
  );
  statusScene.add(object);

  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postGeometry = new THREE.BufferGeometry();
  postGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const postMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: {
      tDiffuse: { value: rawTarget.texture },
      uResolution: { value: new THREE.Vector2(size, size) },
      uGridSize: { value: 3 },
    },
    vertexShader: `
      out vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uGridSize;

      const mat4 THRESHOLDS = mat4(
        0.94118, 0.29412, 0.76471, 0.05882,
        0.47059, 0.70588, 0.23529, 0.52941,
        0.82353, 0.11765, 0.88235, 0.17647,
        0.35294, 0.58824, 0.41176, 0.64706
      );

      float thresholdAt(vec2 cellCoord) {
        ivec2 p = ivec2(mod(cellCoord, 4.0));
        return THRESHOLDS[p.x][p.y];
      }

      void main() {
        vec2 fragCoord = vUv * uResolution;
        vec2 pixelUv = (floor(fragCoord / uGridSize) + 0.5) * uGridSize / uResolution;
        vec4 tex = texture(tDiffuse, pixelUv);
        float level = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
        float bit = level < thresholdAt(fragCoord / uGridSize) ? 0.0 : 1.0;
        vec3 color = mix(vec3(0.08, 0.12, 0.19), vec3(0.58, 0.66, 0.80), bit);
        outColor = vec4(color, tex.a * 0.88);
      }
    `,
  });
  const quad = new THREE.Mesh(postGeometry, postMaterial);
  quad.frustumCulled = false;
  postScene.add(quad);

  return {
    texture: ditherTarget.texture,
    resize(dpr: number) {
      const targetSize = Math.round(size * Math.min(dpr, 1.5));
      rawTarget.setSize(targetSize, targetSize);
      ditherTarget.setSize(targetSize, targetSize);
      postMaterial.uniforms.uResolution.value.set(targetSize, targetSize);
    },
    render(elapsed: number) {
      object.rotation.x = 0.36 + elapsed * 0.08;
      object.rotation.y = 0.48 + elapsed * 0.12;
      renderer.setRenderTarget(rawTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(statusScene, statusCamera);
      renderer.setRenderTarget(ditherTarget);
      renderer.clear();
      renderer.render(postScene, postCamera);
    },
    dispose() {
      rawTarget.dispose();
      ditherTarget.dispose();
      postGeometry.dispose();
      postMaterial.dispose();
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    },
  };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
