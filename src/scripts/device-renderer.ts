/**
 * Desktop-only muted portfolio hardware renderer.
 *
 * The display treatment adapts the VHS shader and Bayer dither technique from
 * Canvas UI by David Haz (MIT + Commons Clause, 2026). The semantic DOM screens
 * remain authoritative; these shaders only add optional glass/noise and a small
 * dithered status object. See docs/licenses/canvas-ui.md.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function startDevice(stage: HTMLElement, canvas: HTMLCanvasElement): () => void {
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
    return () => undefined;
  }

  if (renderer.getContext().isContextLost()) {
    document.documentElement.dataset.webgl = 'unavailable';
    renderer.dispose();
    return () => undefined;
  }

  document.documentElement.dataset.webgl = 'available';
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 15.15, 1.15);
  camera.lookAt(0, 0, 0.12);

  const world = new THREE.Group();
  scene.add(world);
  const homeDevice = surface === 'home'
    ? document.querySelector<HTMLElement>('.home-device')
    : null;
  const routeScreen = surface === 'route'
    ? document.querySelector<HTMLElement>('.device-route-screen')
    : null;
  type OverlayRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type DeviceSurface = {
    x: number;
    z: number;
    width: number;
    depth: number;
    y: number;
  };
  const dpadLayout = {
    x: -3.15,
    z: 2.1,
    span: 1.16,
    thickness: 0.5,
    hitOffset: 0.33,
    hitSize: 0.56,
  } as const;
  const actionControlLayout = {
    x: 3.15,
    width: 0.84,
    depth: 0.78,
    openZ: 1.48,
    backZ: 2.72,
  } as const;
  const routeAspect = Math.min(window.innerWidth / Math.max(window.innerHeight, 1), 1.75);
  const routeLayout = {
    frameWidth: Math.max(10.6, 9.68 * routeAspect),
    frameDepth: 9.3,
    screenY: 0.665,
  } as const;
  const routeSurface = {
    x: 0,
    z: 0,
    width: routeLayout.frameWidth - 0.78,
    depth: routeLayout.frameDepth - 0.78,
    y: routeLayout.screenY,
  } satisfies DeviceSurface;
  const homeSurfaces = {
    hero: { x: 0, z: -2.18, width: 6.82, depth: 2.65, y: 0.715 },
    menu: { x: 0, z: 2.1, width: 4.36, depth: 2.72, y: 0.745 },
    up: {
      x: dpadLayout.x,
      z: dpadLayout.z - dpadLayout.hitOffset,
      width: dpadLayout.hitSize,
      depth: dpadLayout.hitSize,
      y: 0.79,
    },
    right: {
      x: dpadLayout.x + dpadLayout.hitOffset,
      z: dpadLayout.z,
      width: dpadLayout.hitSize,
      depth: dpadLayout.hitSize,
      y: 0.79,
    },
    down: {
      x: dpadLayout.x,
      z: dpadLayout.z + dpadLayout.hitOffset,
      width: dpadLayout.hitSize,
      depth: dpadLayout.hitSize,
      y: 0.79,
    },
    left: {
      x: dpadLayout.x - dpadLayout.hitOffset,
      z: dpadLayout.z,
      width: dpadLayout.hitSize,
      depth: dpadLayout.hitSize,
      y: 0.79,
    },
    open: {
      x: actionControlLayout.x,
      z: actionControlLayout.openZ,
      width: actionControlLayout.width,
      depth: actionControlLayout.depth,
      y: 0.69,
    },
    back: {
      x: actionControlLayout.x,
      z: actionControlLayout.backZ,
      width: actionControlLayout.width,
      depth: actionControlLayout.depth,
      y: 0.69,
    },
  } satisfies Record<string, DeviceSurface>;
  const overlayBindings = [
    ['.home-screen--hero', homeSurfaces.hero],
    ['.home-screen--menu', homeSurfaces.menu],
    ['.hardware-link--up', homeSurfaces.up],
    ['.hardware-link--right', homeSurfaces.right],
    ['.hardware-link--down', homeSurfaces.down],
    ['.hardware-link--left', homeSurfaces.left],
    ['.hardware-link--open', homeSurfaces.open],
    ['.hardware-link--back', homeSurfaces.back],
  ] as const;

  const moldedTexture = createMoldTexture();
  const graphite = new THREE.MeshPhysicalMaterial({
    color: 0x243249,
    roughness: 0.48,
    metalness: 0.04,
    clearcoat: 0.22,
    clearcoatRoughness: 0.72,
    bumpMap: moldedTexture,
    bumpScale: 0.025,
  });
  const graphiteEdge = new THREE.MeshPhysicalMaterial({
    color: 0x36465f,
    roughness: 0.38,
    metalness: 0.08,
    clearcoat: 0.32,
    clearcoatRoughness: 0.5,
    bumpMap: moldedTexture,
    bumpScale: 0.018,
  });
  const seam = new THREE.MeshStandardMaterial({
    color: 0x070e18,
    roughness: 0.72,
    metalness: 0.04,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x071424,
    roughness: 0.12,
    metalness: 0.02,
    transmission: 0.16,
    transparent: true,
    opacity: 0.82,
    clearcoat: 0.82,
    clearcoatRoughness: 0.16,
  });
  const controlMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x172236,
    roughness: 0.42,
    metalness: 0.08,
    clearcoat: 0.34,
    clearcoatRoughness: 0.48,
    bumpMap: moldedTexture,
    bumpScale: 0.018,
  });

  const ambient = new THREE.HemisphereLight(0xdde4f4, 0x171e2b, 1.22);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xf3f0ed, 2.55);
  key.position.set(-6.5, 12, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.bias = -0.00018;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = 5;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x99abc9, 1.45);
  fill.position.set(7, 8, 6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x738fbd, 1.7);
  rim.position.set(2, 6, -9);
  scene.add(rim);
  const face = new THREE.RectAreaLight(0xd8dbe6, 1.25, 7, 5);
  face.position.set(0, 7, 5);
  face.lookAt(0, 0, 0);
  scene.add(face);

  const deskMaterial = new THREE.MeshStandardMaterial({
    color: surface === 'route' ? 0x8e88d1 : 0x737788,
    roughness: 0.92,
  });
  const desk = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 28),
    deskMaterial,
  );
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.5;
  desk.receiveShadow = true;
  scene.add(desk);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(surface === 'home' ? 8.7 : 12.4, surface === 'home' ? 9 : 8.7),
    new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.485;
  contact.position.z = 0.18;
  scene.add(contact);

  const statusPass = createDitheredStatus(renderer);
  const guideDialog = document.querySelector<HTMLElement>('[data-dm-dialog]');
  const guideAvailable = Boolean(guideDialog);
  const semanticStatus = document.querySelector<HTMLElement>('[data-device-status]');
  const syncGuideState = () => {
    const guideOpen = guideDialog ? !guideDialog.hidden : false;
    if (surface === 'route') deskMaterial.color.set(guideOpen ? 0x7d7f8d : 0x8e88d1);
    statusPass.setState(guideOpen ? 'guide-open' : 'ready');
    if (semanticStatus) {
      semanticStatus.textContent = guideOpen
        ? 'Device status: contextual guide open.'
        : guideAvailable
          ? 'Device status: portfolio ready; contextual guide available.'
          : 'Device status: portfolio ready.';
    }
  };
  const guideObserver = guideDialog
    ? new MutationObserver(syncGuideState)
    : undefined;
  guideObserver?.observe(guideDialog!, { attributes: true, attributeFilter: ['hidden'] });
  syncGuideState();
  if (surface === 'home') buildHome();
  else buildRoute();

  const startedAt = performance.now();
  let visible = !document.hidden;
  let inView = true;
  let disposed = false;

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
    camera.aspect = width / height;
    camera.fov = surface === 'home' ? 34 : 37;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (surface === 'home') syncHomeOverlay(width, height);
    else syncRouteOverlay(width, height);
    statusPass.resize(dpr);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  renderer.setAnimationLoop(() => {
    if (!visible || !inView || disposed) return;
    const elapsed = reducedMotion.matches ? 0 : (performance.now() - startedAt) / 1000;
    // DOM screen content and the WebGL chassis share one fixed projection so
    // screen edges never drift outside their physical openings.
    world.rotation.set(0, 0, 0);
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
    guideObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    clearHomeOverlay();
    clearRouteOverlay();
    statusPass.dispose();
    disposeObject(scene);
    renderer.dispose();
  };
  window.addEventListener('pagehide', destroy, { once: true });

  function buildHome() {
    const top = roundedHousing(8.05, 3.72, 0.62);
    top.position.set(0, 0, -2.14);
    world.add(top);
    const bottom = roundedHousing(8.05, 4.28, 0.68);
    bottom.position.set(0, 0, 2.08);
    world.add(bottom);

    const topScreen = screen(6.82, 2.65);
    topScreen.position.set(0, 0.49, -2.18);
    world.add(topScreen);
    const lowerScreen = screen(4.36, 2.72);
    lowerScreen.position.set(0, 0.52, 2.1);
    world.add(lowerScreen);

    const hingeSegments = [
      [-3.45, 0.52],
      [-2.2, 1.92],
      [0, 3.92],
      [2.2, 1.92],
      [3.45, 0.52],
    ] as const;
    for (const [x, length] of hingeSegments) {
      const hinge = new THREE.Mesh(
        new THREE.CylinderGeometry(x === 0 ? 0.21 : 0.23, x === 0 ? 0.21 : 0.23, length, 32),
        graphiteEdge,
      );
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(x, 0.34, -0.04);
      hinge.castShadow = true;
      world.add(hinge);
    }

    const dpad = new THREE.Group();
    const padVertical = controlBox(dpadLayout.thickness, dpadLayout.span, 0.22);
    const padHorizontal = controlBox(dpadLayout.span, dpadLayout.thickness, 0.22);
    dpad.add(padVertical, padHorizontal);
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 32), seam);
    center.position.y = 0.25;
    dpad.add(center);
    dpad.position.set(dpadLayout.x, 0.55, dpadLayout.z);
    world.add(dpad);

    const open = controlBox(actionControlLayout.width, actionControlLayout.depth, 0.24);
    open.position.set(actionControlLayout.x, 0.55, actionControlLayout.openZ);
    world.add(open);
    const back = controlBox(actionControlLayout.width, actionControlLayout.depth, 0.24);
    back.position.set(actionControlLayout.x, 0.55, actionControlLayout.backZ);
    world.add(back);
    for (const x of [-2.9, 2.9]) {
      const slot = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.07, 0.12, 2, 0.04), seam);
      slot.position.set(x, 0.5, -3.62);
      world.add(slot);
    }

    const statusPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.72, 1.72),
      new THREE.MeshBasicMaterial({
        map: statusPass.texture,
        transparent: true,
        opacity: 0.86,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    statusPlane.rotation.x = -Math.PI / 2;
    statusPlane.position.set(2.15, 0.74, -2.18);
    statusPlane.renderOrder = 8;
    world.add(statusPlane);

    const notebook = new THREE.Mesh(
      new RoundedBoxGeometry(3.1, 0.1, 4.1, 3, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x666b7b, roughness: 0.86 }),
    );
    notebook.position.set(6.5, -0.34, -4.15);
    notebook.rotation.y = -0.13;
    notebook.castShadow = true;
    world.add(notebook);
  }

  function projectSurface(surfaceRect: DeviceSurface, stageWidth: number, stageHeight: number): OverlayRect {
    const halfWidth = surfaceRect.width / 2;
    const halfDepth = surfaceRect.depth / 2;
    const corners = [
      new THREE.Vector3(surfaceRect.x - halfWidth, surfaceRect.y, surfaceRect.z - halfDepth),
      new THREE.Vector3(surfaceRect.x + halfWidth, surfaceRect.y, surfaceRect.z - halfDepth),
      new THREE.Vector3(surfaceRect.x - halfWidth, surfaceRect.y, surfaceRect.z + halfDepth),
      new THREE.Vector3(surfaceRect.x + halfWidth, surfaceRect.y, surfaceRect.z + halfDepth),
    ].map((point) => point.project(camera));
    const xs = corners.map((point) => (point.x + 1) * stageWidth / 2);
    const ys = corners.map((point) => (1 - point.y) * stageHeight / 2);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { left, top, width: right - left, height: bottom - top };
  }

  function homeReferenceRect(stageWidth: number, stageHeight: number): OverlayRect {
    const hero = projectSurface(homeSurfaces.hero, stageWidth, stageHeight);
    const width = hero.width / 0.856;
    const height = hero.height / 0.3255;
    return {
      left: hero.left - width * 0.072,
      top: hero.top - height * 0.0735,
      width,
      height,
    };
  }

  function syncHomeOverlay(stageWidth: number, stageHeight: number): void {
    if (!homeDevice) return;

    const initialReference = homeReferenceRect(stageWidth, stageHeight);
    const fitWidth = Math.min(800, stageWidth * 0.92);
    const fitHeight = stageHeight * 0.96;
    camera.zoom = Math.min(
      fitWidth / Math.max(initialReference.width, 1),
      fitHeight / Math.max(initialReference.height, 1),
    );
    camera.updateProjectionMatrix();

    const reference = homeReferenceRect(stageWidth, stageHeight);
    homeDevice.dataset.deviceOverlayBound = '';
    homeDevice.style.setProperty('--home-device-left', `${reference.left}px`);
    homeDevice.style.setProperty('--home-device-top', `${reference.top}px`);
    homeDevice.style.setProperty('--home-device-width', `${reference.width}px`);
    homeDevice.style.setProperty('--home-device-height', `${reference.height}px`);

    for (const [selector, surfaceRect] of overlayBindings) {
      const element = homeDevice.querySelector<HTMLElement>(selector);
      if (!element) continue;
      const rect = projectSurface(surfaceRect, stageWidth, stageHeight);
      element.style.setProperty('--device-overlay-left', `${rect.left - reference.left}px`);
      element.style.setProperty('--device-overlay-top', `${rect.top - reference.top}px`);
      element.style.setProperty('--device-overlay-width', `${rect.width}px`);
      element.style.setProperty('--device-overlay-height', `${rect.height}px`);
    }
  }

  function clearHomeOverlay(): void {
    if (!homeDevice) return;
    delete homeDevice.dataset.deviceOverlayBound;
    for (const property of [
      '--home-device-left',
      '--home-device-top',
      '--home-device-width',
      '--home-device-height',
    ]) {
      homeDevice.style.removeProperty(property);
    }
    for (const [selector] of overlayBindings) {
      const element = homeDevice.querySelector<HTMLElement>(selector);
      element?.style.removeProperty('--device-overlay-left');
      element?.style.removeProperty('--device-overlay-top');
      element?.style.removeProperty('--device-overlay-width');
      element?.style.removeProperty('--device-overlay-height');
    }
  }

  function syncRouteOverlay(stageWidth: number, stageHeight: number): void {
    if (!routeScreen) return;
    const initialRect = projectSurface(routeSurface, stageWidth, stageHeight);
    const fitWidth = stageWidth * 0.92;
    const fitHeight = stageHeight * 0.92;
    camera.zoom = Math.min(
      fitWidth / Math.max(initialRect.width, 1),
      fitHeight / Math.max(initialRect.height, 1),
    );
    camera.updateProjectionMatrix();
    const rect = projectSurface(routeSurface, stageWidth, stageHeight);
    routeScreen.dataset.deviceRouteOverlayBound = '';
    routeScreen.style.setProperty('--device-route-left', `${rect.left}px`);
    routeScreen.style.setProperty('--device-route-top', `${rect.top}px`);
    routeScreen.style.setProperty('--device-route-width', `${rect.width}px`);
    routeScreen.style.setProperty('--device-route-height', `${rect.height}px`);
  }

  function clearRouteOverlay(): void {
    if (!routeScreen) return;
    delete routeScreen.dataset.deviceRouteOverlayBound;
    for (const property of [
      '--device-route-left',
      '--device-route-top',
      '--device-route-width',
      '--device-route-height',
    ]) {
      routeScreen.style.removeProperty(property);
    }
  }

  function buildRoute() {
    const frame = roundedHousing(routeLayout.frameWidth, routeLayout.frameDepth, 0.52);
    frame.position.set(0, 0, 0);
    world.add(frame);
    const routeGlass = screen(routeLayout.frameWidth - 0.72, routeLayout.frameDepth - 0.72);
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
    statusPlane.position.set(routeLayout.frameWidth / 2 - 0.74, 0.49, -3.42);
    world.add(statusPlane);
  }

  function roundedHousing(width: number, depth: number, height = 0.52): THREE.Group {
    const group = new THREE.Group();
    const underside = new THREE.Mesh(
      new RoundedBoxGeometry(width + 0.04, height * 0.52, depth + 0.04, 5, 0.22),
      seam,
    );
    underside.position.y = -height * 0.24;
    underside.castShadow = true;
    underside.receiveShadow = true;
    group.add(underside);
    const shell = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 7, 0.24), graphite);
    shell.castShadow = true;
    shell.receiveShadow = true;
    group.add(shell);
    const edgeBand = new THREE.Mesh(
      new RoundedBoxGeometry(width - 0.12, 0.1, depth - 0.12, 6, 0.2),
      graphiteEdge,
    );
    edgeBand.position.y = height / 2 - 0.015;
    group.add(edgeBand);
    const inset = new THREE.Mesh(
      new RoundedBoxGeometry(width - 0.28, 0.08, depth - 0.28, 5, 0.17),
      graphite,
    );
    inset.position.y = height / 2 + 0.045;
    group.add(inset);
    return group;
  }

  function screen(width: number, depth: number): THREE.Group {
    const group = new THREE.Group();
    const outerLip = new THREE.Mesh(
      new RoundedBoxGeometry(width + 0.46, 0.2, depth + 0.46, 5, 0.17),
      graphiteEdge,
    );
    outerLip.position.y = 0.01;
    group.add(outerLip);
    const recess = new THREE.Mesh(new RoundedBoxGeometry(width + 0.27, 0.19, depth + 0.27, 5, 0.14), seam);
    recess.position.y = 0.08;
    group.add(recess);
    const pane = new THREE.Mesh(new RoundedBoxGeometry(width, 0.09, depth, 4, 0.1), glass);
    pane.position.y = 0.17;
    pane.renderOrder = 2;
    group.add(pane);
    const vhs = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.985, depth * 0.98), createVhsGlassMaterial());
    vhs.rotation.x = -Math.PI / 2;
    vhs.position.y = 0.225;
    vhs.renderOrder = 3;
    vhs.userData.vhs = true;
    group.add(vhs);
    return group;
  }

  function controlBox(width: number, depth: number, height: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 4, 0.1), controlMaterial);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    return mesh;
  }

  return destroy;
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
  let state: 'ready' | 'guide-open' = 'ready';
  const rawTarget = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  const ditherTarget = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  rawTarget.texture.colorSpace = THREE.SRGBColorSpace;
  ditherTarget.texture.colorSpace = THREE.SRGBColorSpace;

  const statusScene = new THREE.Scene();
  const statusCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
  statusCamera.position.set(0, 0, 4.4);
  const objectMaterial = new THREE.MeshBasicMaterial({ color: 0xaab9d7, wireframe: true });
  const object = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.05, 1),
    objectMaterial,
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
    setState(nextState: 'ready' | 'guide-open') {
      state = nextState;
      objectMaterial.color.set(nextState === 'guide-open' ? 0xd7c8f0 : 0xaab9d7);
    },
    resize(dpr: number) {
      const targetSize = Math.round(size * Math.min(dpr, 1.5));
      rawTarget.setSize(targetSize, targetSize);
      ditherTarget.setSize(targetSize, targetSize);
      postMaterial.uniforms.uResolution.value.set(targetSize, targetSize);
    },
    render(elapsed: number) {
      object.rotation.x = 0.36 + elapsed * (state === 'guide-open' ? 0.16 : 0.08);
      object.rotation.y = 0.48 + elapsed * (state === 'guide-open' ? 0.22 : 0.12);
      object.scale.setScalar(state === 'guide-open' ? 1.12 : 1);
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
      objectMaterial.dispose();
    },
  };
}

function createMoldTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size);
  let seed = 307;
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[index] = 112 + ((seed >>> 24) % 32);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.needsUpdate = true;
  return texture;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 20, 128, 128, 126);
    gradient.addColorStop(0, 'rgba(4, 8, 15, .72)');
    gradient.addColorStop(0.48, 'rgba(5, 9, 16, .4)');
    gradient.addColorStop(1, 'rgba(5, 9, 16, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
