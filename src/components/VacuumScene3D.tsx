import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  InertiaProperties,
  RigidBodyState,
  THandleDimensions,
} from '../physics/dzhanibekov';

export type CameraMode = 'inertial-free' | 'align-momentum' | 'corotating-body';

export interface VectorVisibility {
  showCentrifugal: boolean;
  showConstraint: boolean;
  showAngularVectors: boolean;
  showTrajectory: boolean;
  showPoinsotEllipsoid: boolean;
}

interface VacuumScene3DProps {
  currentState: RigidBodyState;
  history: RigidBodyState[];
  dimensions: THandleDimensions;
  inertia: InertiaProperties;
  vectorVisibility: VectorVisibility;
  cameraMode: CameraMode;
  onCameraModeChange?: (mode: CameraMode) => void;
}

// Pre-allocated scratch math objects outside render loop (Zero GC)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _defaultDir = new THREE.Vector3(0, 1, 0);

/**
 * Creates a procedural brushed titanium bump/roughness CanvasTexture
 */
function createBrushedMetalTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y++) {
      const v = 110 + Math.floor(Math.sin(y * 0.7) * 18 + ((y * 73) % 29));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, 256, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 4);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Creates a procedural knurled grip CanvasTexture for the stem sleeve
 */
function createKnurledTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#707070';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#b0b0b0';
    ctx.lineWidth = 2;
    const step = 16;
    for (let i = -128; i < 256; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(i + 128, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Custom 3D Arrow Mesh Group (Cylinder shaft + Cone head) for crisp vector visualization
 */
interface VectorArrow3D {
  group: THREE.Group;
  shaft: THREE.Mesh;
  head: THREE.Mesh;
  setVector: (origin: THREE.Vector3, dirAndLength: THREE.Vector3, scale: number, minLen?: number, maxLen?: number) => void;
}

function createVectorArrow(colorHex: number, radius = 0.0022): VectorArrow3D {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.1,
  });

  const shaftGeo = new THREE.CylinderGeometry(radius, radius, 1, 12);
  shaftGeo.translate(0, 0.5, 0);
  const shaft = new THREE.Mesh(shaftGeo, mat);

  const headRadius = radius * 2.6;
  const headHeight = radius * 6.5;
  const headGeo = new THREE.ConeGeometry(headRadius, headHeight, 14);
  headGeo.translate(0, headHeight * 0.5, 0);
  const head = new THREE.Mesh(headGeo, mat);

  group.add(shaft);
  group.add(head);

  const setVector = (
    origin: THREE.Vector3,
    vec: THREE.Vector3,
    scale: number,
    minLen = 0.004,
    maxLen = 0.18
  ) => {
    const rawLen = vec.length() * scale;
    if (rawLen < minLen) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const len = Math.min(maxLen, rawLen);
    group.position.copy(origin);

    _v1.copy(vec).normalize();
    _q1.setFromUnitVectors(_defaultDir, _v1);
    group.quaternion.copy(_q1);

    const shaftLen = Math.max(0.001, len - headHeight);
    shaft.scale.set(1, shaftLen, 1);
    head.position.set(0, shaftLen, 0);
  };

  return { group, shaft, head, setVector };
}

export const VacuumScene3D: React.FC<VacuumScene3DProps> = ({
  currentState,
  history,
  dimensions,
  inertia,
  vectorVisibility,
  cameraMode,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // Store latest props in refs so WebGL scene never re-initializes on frame step
  const stateRef = useRef(currentState);
  stateRef.current = currentState;

  const historyRef = useRef(history);
  historyRef.current = history;

  const dimRef = useRef(dimensions);
  dimRef.current = dimensions;

  const inertiaRef = useRef(inertia);
  inertiaRef.current = inertia;

  const visRef = useRef(vectorVisibility);
  visRef.current = vectorVisibility;

  const camModeRef = useRef(cameraMode);
  camModeRef.current = cameraMode;

  const requestRenderRef = useRef<(() => void) | null>(null);
  const rebuildGeometryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software-WebGL detection per Three.js skill directive
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgHex = 0x060911;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 1.4);

    // 2. Studio Environment Map (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 3. Camera & OrbitControls
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 20);
    camera.position.set(0.24, 0.16, 0.28);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.12;
    controls.maxDistance = 1.5;
    controls.target.set(0, 0, 0);

    // 4. Three-Point Warm/Cool Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x090d16, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e4, 2.4);
    keyLight.position.set(0.5, 0.8, 0.6);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      const d = 0.22;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.camera.near = 0.1;
      keyLight.shadow.camera.far = 2.5;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    rimLight.position.set(-0.6, -0.4, -0.5);
    scene.add(rimLight);

    // 5. Vacuum Chamber Spatial Reference Grid & Invariant Angular Momentum Plane
    const referenceGroup = new THREE.Group();
    scene.add(referenceGroup);

    // Subtle spherical coordinate rings around COM (0,0,0)
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x1e293b,
      transparent: true,
      opacity: 0.55,
    });
    const ringRadius = 0.145;
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * ringRadius, 0, Math.sin(a) * ringRadius));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ringXZ = new THREE.Line(ringGeo, ringMat);
    const ringXY = new THREE.Line(ringGeo, ringMat);
    ringXY.rotation.x = Math.PI / 2;
    const ringYZ = new THREE.Line(ringGeo, ringMat);
    ringYZ.rotation.z = Math.PI / 2;
    referenceGroup.add(ringXZ, ringXY, ringYZ);

    // Contact / reference plane below vacuum trap (y = -0.16)
    const floorGrid = new THREE.GridHelper(0.8, 16, 0x1e293b, 0x0f172a);
    floorGrid.position.y = -0.165;
    referenceGroup.add(floorGrid);

    const shadowDiscGeo = new THREE.CircleGeometry(0.085, 32);
    shadowDiscGeo.rotateX(-Math.PI / 2);
    const shadowDiscMat = new THREE.MeshBasicMaterial({
      color: 0x020408,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadowDisc = new THREE.Mesh(shadowDiscGeo, shadowDiscMat);
    shadowDisc.position.y = -0.163;
    referenceGroup.add(shadowDisc);

    // Subtle deep-space vacuum starfield
    const starCount = 240;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = (i * 2.39996) % (Math.PI * 2);
      const phi = Math.acos(1 - (2 * (i + 0.5)) / starCount);
      const r = 1.8 + (i % 7) * 0.35;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x64748b,
      size: 0.012,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(starGeo, starMat));

    // 6. Composite 9-Part Procedural T-Handle Metal Group
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const brushedTex = createBrushedMetalTexture(maxAniso);
    const knurledTex = createKnurledTexture(maxAniso);

    const titaniumMat = new THREE.MeshStandardMaterial({
      color: 0xd8dee9,
      metalness: 0.88,
      roughness: 0.24,
      bumpMap: brushedTex,
      bumpScale: 0.0015,
    });

    const tungstenCapMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.92,
      roughness: 0.18,
    });

    const collarMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.65,
      roughness: 0.52,
    });

    const knurledGripMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.72,
      roughness: 0.62,
      bumpMap: knurledTex,
      bumpScale: 0.003,
    });

    // Polarity identification bands so +Z vs -Z and +X flips are hyper-legible
    const posZBandMat = new THREE.MeshStandardMaterial({
      color: 0xf97316, // Aerospace International Orange (+Z upper arm)
      emissive: 0xf97316,
      emissiveIntensity: 0.2,
      roughness: 0.35,
      metalness: 0.3,
    });

    const negZBandMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Cerulean Cyan (-Z lower arm)
      emissive: 0x38bdf8,
      emissiveIntensity: 0.2,
      roughness: 0.35,
      metalness: 0.3,
    });

    const stemRingMat = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Emerald (+X stem tip marker)
      emissive: 0x10b981,
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.4,
    });

    const tHandleGroup = new THREE.Group();
    scene.add(tHandleGroup);

    // Poinsot Inertia Ellipsoid Wireframe attached to body frame
    const ellipsoidGeo = new THREE.SphereGeometry(1, 24, 16);
    const ellipsoidWire = new THREE.WireframeGeometry(ellipsoidGeo);
    const ellipsoidMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
    });
    const poinsotEllipsoidMesh = new THREE.LineSegments(ellipsoidWire, ellipsoidMat);
    tHandleGroup.add(poinsotEllipsoidMesh);

    const buildTHandleParts = () => {
      // Clear previous part meshes except poinsotEllipsoidMesh
      for (let i = tHandleGroup.children.length - 1; i >= 0; i--) {
        const child = tHandleGroup.children[i];
        if (child !== poinsotEllipsoidMesh) {
          tHandleGroup.remove(child);
        }
      }

      const dim = dimRef.current;
      const iner = inertiaRef.current;
      const { crossbarLength: Lc, crossbarRadius: Rc, stemLength: Ls, stemRadius: Rs } = dim;
      const comX = iner.comX;

      // Part 1: Main Crossbar Cylinder along Z (centered at x = -comX, y = 0, z = 0)
      const crossbarGeo = new THREE.CylinderGeometry(Rc, Rc, Lc * 0.82, 32);
      crossbarGeo.rotateX(Math.PI / 2);
      const crossbarMesh = new THREE.Mesh(crossbarGeo, titaniumMat);
      crossbarMesh.position.set(-comX, 0, 0);
      crossbarMesh.castShadow = !isSoftwareGl;
      crossbarMesh.receiveShadow = !isSoftwareGl;
      tHandleGroup.add(crossbarMesh);

      // Part 2 & 3: Upper (+Z) & Lower (-Z) High-Density Beveled Tungsten Counterweight Caps
      const capLen = Lc * 0.11;
      const capGeo = new THREE.CylinderGeometry(Rc * 1.12, Rc * 1.18, capLen, 32);
      capGeo.rotateX(Math.PI / 2);

      const topCap = new THREE.Mesh(capGeo, tungstenCapMat);
      topCap.position.set(-comX, 0, Lc * 0.45);
      topCap.castShadow = !isSoftwareGl;
      tHandleGroup.add(topCap);

      const botCap = new THREE.Mesh(capGeo, tungstenCapMat);
      botCap.position.set(-comX, 0, -Lc * 0.45);
      botCap.castShadow = !isSoftwareGl;
      tHandleGroup.add(botCap);

      // Part 4 & 5: Polarity Identification Bands (+Z Orange, -Z Cyan)
      const bandGeo = new THREE.CylinderGeometry(Rc * 1.04, Rc * 1.04, Lc * 0.08, 32);
      bandGeo.rotateX(Math.PI / 2);
      const posZBand = new THREE.Mesh(bandGeo, posZBandMat);
      posZBand.position.set(-comX, 0, Lc * 0.31);
      tHandleGroup.add(posZBand);

      const negZBand = new THREE.Mesh(bandGeo, negZBandMat);
      negZBand.position.set(-comX, 0, -Lc * 0.31);
      tHandleGroup.add(negZBand);

      // Part 6: Central Machined T-Junction Collar Block
      const collarGeo = new THREE.CylinderGeometry(Rc * 1.24, Rc * 1.24, Rs * 2.5, 32);
      collarGeo.rotateX(Math.PI / 2);
      const collarMesh = new THREE.Mesh(collarGeo, collarMat);
      collarMesh.position.set(-comX, 0, 0);
      tHandleGroup.add(collarMesh);

      // Part 7: Stem Shaft along +X (from x = -comX to x = Ls - comX)
      const stemGeo = new THREE.CylinderGeometry(Rs, Rs, Ls, 28);
      stemGeo.rotateZ(-Math.PI / 2);
      const stemMesh = new THREE.Mesh(stemGeo, titaniumMat);
      stemMesh.position.set(Ls * 0.5 - comX, 0, 0);
      stemMesh.castShadow = !isSoftwareGl;
      tHandleGroup.add(stemMesh);

      // Part 8: Knurled Grip Sleeve on Stem Mid-Section
      const sleeveGeo = new THREE.CylinderGeometry(Rs * 1.12, Rs * 1.12, Ls * 0.42, 28);
      sleeveGeo.rotateZ(-Math.PI / 2);
      const sleeveMesh = new THREE.Mesh(sleeveGeo, knurledGripMat);
      sleeveMesh.position.set(Ls * 0.48 - comX, 0, 0);
      tHandleGroup.add(sleeveMesh);

      // Part 9: Hexagonal Wing-Nut Flange & Emerald Tip Marker at Stem End (+X)
      const hexNutGeo = new THREE.CylinderGeometry(Rs * 1.45, Rs * 1.45, Ls * 0.12, 6);
      hexNutGeo.rotateZ(-Math.PI / 2);
      const hexNutMesh = new THREE.Mesh(hexNutGeo, tungstenCapMat);
      hexNutMesh.position.set(Ls * 0.84 - comX, 0, 0);
      tHandleGroup.add(hexNutMesh);

      const tipMarkerGeo = new THREE.CylinderGeometry(Rs * 1.06, Rs * 0.7, Ls * 0.08, 24);
      tipMarkerGeo.rotateZ(-Math.PI / 2);
      const tipMarkerMesh = new THREE.Mesh(tipMarkerGeo, stemRingMat);
      tipMarkerMesh.position.set(Ls * 0.96 - comX, 0, 0);
      tHandleGroup.add(tipMarkerMesh);

      // Center of Mass (COM) Golden Core Sphere
      const comGeo = new THREE.SphereGeometry(0.0055, 16, 16);
      const comMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
      const comSphere = new THREE.Mesh(comGeo, comMat);
      comSphere.position.set(0, 0, 0);
      tHandleGroup.add(comSphere);

      // Scale Poinsot inertia ellipsoid axes proportional to 1 / sqrt(I_i)
      const iMean = (iner.I1 + iner.I2 + iner.I3) / 3;
      const baseScale = 0.072;
      poinsotEllipsoidMesh.scale.set(
        baseScale * Math.sqrt(iMean / iner.I1),
        baseScale * Math.sqrt(iMean / iner.I2),
        baseScale * Math.sqrt(iMean / iner.I3)
      );
    };

    buildTHandleParts();
    rebuildGeometryRef.current = buildTHandleParts;

    // 7. 3D Vector Arrows for Force & Kinematics Analysis
    const vectorOverlayGroup = new THREE.Group();
    scene.add(vectorOverlayGroup);

    // Global vectors at COM (0,0,0): Angular Momentum L (Emerald) & Angular Velocity \omega (Cyan)
    const arrowL = createVectorArrow(0x10b981, 0.0028);
    const arrowOmega = createVectorArrow(0x06b6d4, 0.0024);
    vectorOverlayGroup.add(arrowL.group, arrowOmega.group);

    // 5 Node Centrifugal Arrows (Coral Red) & 5 Node Structural Constraint Arrows (Amber Gold)
    const centrifugalArrows: VectorArrow3D[] = [];
    const constraintArrows: VectorArrow3D[] = [];
    const nodeMarkers: THREE.Mesh[] = [];
    const nodeMarkerGeo = new THREE.SphereGeometry(0.0042, 12, 12);
    const nodeMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    for (let i = 0; i < 5; i++) {
      const cfArrow = createVectorArrow(0xf43f5e, 0.002);
      const stArrow = createVectorArrow(0xf59e0b, 0.0018);
      const marker = new THREE.Mesh(nodeMarkerGeo, nodeMarkerMat);
      vectorOverlayGroup.add(cfArrow.group, stArrow.group, marker);
      centrifugalArrows.push(cfArrow);
      constraintArrows.push(stArrow);
      nodeMarkers.push(marker);
    }

    // 8. 3D Trajectory Trails for Stem Tip (+X) and Upper Crossbar (+Z)
    const maxTrailPoints = 360;
    const stemTrailPositions = new Float32Array(maxTrailPoints * 3);
    const stemTrailGeo = new THREE.BufferGeometry();
    stemTrailGeo.setAttribute('position', new THREE.BufferAttribute(stemTrailPositions, 3));
    const stemTrailMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.78,
    });
    const stemTrailLine = new THREE.Line(stemTrailGeo, stemTrailMat);
    scene.add(stemTrailLine);

    const barTrailPositions = new Float32Array(maxTrailPoints * 3);
    const barTrailGeo = new THREE.BufferGeometry();
    barTrailGeo.setAttribute('position', new THREE.BufferAttribute(barTrailPositions, 3));
    const barTrailMat = new THREE.LineBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.55,
    });
    const barTrailLine = new THREE.Line(barTrailGeo, barTrailMat);
    scene.add(barTrailLine);

    // 9. Instantaneous Rotation Axis Line (\omega) through COM + Perpendicular Radius Drop-Lines from Crossbar Ends
    const omegaAxisPts = [new THREE.Vector3(-0.16, 0, 0), new THREE.Vector3(0.16, 0, 0)];
    const omegaAxisGeo = new THREE.BufferGeometry().setFromPoints(omegaAxisPts);
    const omegaAxisMat = new THREE.LineDashedMaterial({
      color: 0x06b6d4,
      dashSize: 0.008,
      gapSize: 0.005,
      transparent: true,
      opacity: 0.85,
    });
    const omegaAxisLine = new THREE.Line(omegaAxisGeo, omegaAxisMat);
    omegaAxisLine.computeLineDistances();
    scene.add(omegaAxisLine);

    // Drop lines from crossbar top (+Z) and bottom (-Z) perpendicular to instantaneous spin axis \omega
    const dropLinesPos = new Float32Array(12); // 2 segments * 2 vertices * 3 floats
    const dropLinesGeo = new THREE.BufferGeometry();
    dropLinesGeo.setAttribute('position', new THREE.BufferAttribute(dropLinesPos, 3));
    const dropLinesMat = new THREE.LineBasicMaterial({
      color: 0xfda4af,
      transparent: true,
      opacity: 0.65,
    });
    const dropLinesSegments = new THREE.LineSegments(dropLinesGeo, dropLinesMat);
    scene.add(dropLinesSegments);

    const starPointsMesh = scene.children.find((c) => c instanceof THREE.Points) as THREE.Points | undefined;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let lastCamMode: CameraMode = camModeRef.current;

    // Scene synchronization before render
    const syncSceneToState = () => {
      const st = stateRef.current;
      const vis = visRef.current;
      const hist = historyRef.current;
      const dim = dimRef.current;
      const iner = inertiaRef.current;
      const cMode = camModeRef.current;
      const isBodyFrame = cMode === 'corotating-body';

      // In Body-Fixed Frame ('corotating-body'), keep the T-handle stationary at identity orientation
      // so the user can clearly see the rotation axis \omega tilt inside the body and create the centrifugal couple!
      if (isBodyFrame) {
        tHandleGroup.quaternion.identity();
        referenceGroup.visible = false;
        if (starPointsMesh) starPointsMesh.visible = false;
      } else {
        _q2.set(st.q.x, st.q.y, st.q.z, st.q.w);
        tHandleGroup.quaternion.copy(_q2);
        referenceGroup.visible = true;
        if (starPointsMesh) starPointsMesh.visible = true;
      }

      poinsotEllipsoidMesh.visible = vis.showPoinsotEllipsoid || isBodyFrame;

      // Choose vectors in Body frame vs Inertial World frame
      const LVec = isBodyFrame ? st.LBody : st.LWorld;
      const omegaVec = isBodyFrame ? st.omegaBody : st.omegaWorld;

      // Update L and \omega vectors + instantaneous rotation axis line
      if (vis.showAngularVectors || isBodyFrame) {
        _v1.set(0, 0, 0);
        _v2.set(LVec.x, LVec.y, LVec.z);
        const lNorm = _v2.length() || 1;
        arrowL.setVector(_v1, _v2, 0.13 / lNorm, 0.01, 0.16);

        _v3.set(omegaVec.x, omegaVec.y, omegaVec.z);
        const wNorm = _v3.length() || 1;
        arrowOmega.setVector(_v1, _v3, 0.115 / wNorm, 0.01, 0.15);

        // Align the dashed instantaneous rotation axis line with \omega
        omegaAxisLine.visible = true;
        _v3.normalize();
        const posAttr = omegaAxisGeo.attributes.position as THREE.BufferAttribute;
        posAttr.setXYZ(0, -_v3.x * 0.155, -_v3.y * 0.155, -_v3.z * 0.155);
        posAttr.setXYZ(1, _v3.x * 0.155, _v3.y * 0.155, _v3.z * 0.155);
        posAttr.needsUpdate = true;
        omegaAxisLine.computeLineDistances();
      } else {
        arrowL.group.visible = false;
        arrowOmega.group.visible = false;
        omegaAxisLine.visible = false;
      }

      // Normalize force scale so vectors are clearly readable across any spin speed
      const maxForceMag = Math.max(
        1,
        ...st.elementForces.map((ef) =>
          Math.hypot(ef.fCentrifugalBody.x, ef.fCentrifugalBody.y, ef.fCentrifugalBody.z)
        )
      );
      const forceVisualScale = 0.085 / maxForceMag;

      for (let i = 0; i < 5; i++) {
        const ef = st.elementForces[i];
        if (!ef) continue;
        const rPos = isBodyFrame ? ef.rBody : ef.rWorld;
        const fCf = isBodyFrame ? ef.fCentrifugalBody : ef.fCentrifugalWorld;
        const fSt = isBodyFrame ? ef.fConstraintBody : ef.fConstraintWorld;

        _v1.set(rPos.x, rPos.y, rPos.z);
        nodeMarkers[i].position.copy(_v1);
        nodeMarkers[i].visible = vis.showCentrifugal || vis.showConstraint;

        if (vis.showCentrifugal) {
          _v2.set(fCf.x, fCf.y, fCf.z);
          centrifugalArrows[i].setVector(_v1, _v2, forceVisualScale, 0.005, 0.11);
        } else {
          centrifugalArrows[i].group.visible = false;
        }

        if (vis.showConstraint) {
          _v3.set(fSt.x, fSt.y, fSt.z);
          constraintArrows[i].setVector(_v1, _v3, forceVisualScale, 0.005, 0.11);
        } else {
          constraintArrows[i].group.visible = false;
        }
      }

      // Update perpendicular drop lines from crossbar ends (nodes 0 & 1) to the instantaneous spin axis \omega
      if (vis.showCentrifugal && st.elementForces.length >= 2) {
        dropLinesSegments.visible = true;
        _v3.set(omegaVec.x, omegaVec.y, omegaVec.z).normalize();
        const dropAttr = dropLinesGeo.attributes.position as THREE.BufferAttribute;
        for (let idx = 0; idx < 2; idx++) {
          const ef = st.elementForces[idx];
          const rPos = isBodyFrame ? ef.rBody : ef.rWorld;
          _v1.set(rPos.x, rPos.y, rPos.z);
          // Projection onto \omega axis: (\v1 \cdot \v3) * \v3
          const projScalar = _v1.dot(_v3);
          _v2.copy(_v3).multiplyScalar(projScalar);
          dropAttr.setXYZ(idx * 2, _v2.x, _v2.y, _v2.z);
          dropAttr.setXYZ(idx * 2 + 1, _v1.x, _v1.y, _v1.z);
        }
        dropAttr.needsUpdate = true;
      } else {
        dropLinesSegments.visible = false;
      }

      // Update 3D trajectory trails up to current frame index
      if (vis.showTrajectory && hist.length > 1) {
        stemTrailLine.visible = true;
        barTrailLine.visible = true;
        const currentIdx = Math.min(st.frame, hist.length - 1);
        const startIdx = Math.max(0, currentIdx - maxTrailPoints + 1);
        const count = currentIdx - startIdx + 1;

        if (isBodyFrame) {
          // In Body Frame: plot the Polhode trajectory of \omega_body (normalized to radius 0.115)
          // and L_body trajectory (normalized to radius 0.13) relative to the T-handle!
          for (let i = 0; i < count; i++) {
            const hState = hist[startIdx + i];
            const wMag = Math.hypot(hState.omegaBody.x, hState.omegaBody.y, hState.omegaBody.z) || 1;
            stemTrailPositions[i * 3] = (hState.omegaBody.x / wMag) * 0.115;
            stemTrailPositions[i * 3 + 1] = (hState.omegaBody.y / wMag) * 0.115;
            stemTrailPositions[i * 3 + 2] = (hState.omegaBody.z / wMag) * 0.115;

            const lMag = hState.LMagnitude || 1;
            barTrailPositions[i * 3] = (hState.LBody.x / lMag) * 0.13;
            barTrailPositions[i * 3 + 1] = (hState.LBody.y / lMag) * 0.13;
            barTrailPositions[i * 3 + 2] = (hState.LBody.z / lMag) * 0.13;
          }
        } else {
          // In Inertial Frame: plot spatial flip trajectory of Stem Tip (+X) and Upper Crossbar (+Z)
          const stemTipOffset = dim.stemLength - iner.comX;
          const barTopOffset = dim.crossbarLength * 0.48;

          for (let i = 0; i < count; i++) {
            const hState = hist[startIdx + i];
            stemTrailPositions[i * 3] = hState.stemDirWorld.x * stemTipOffset;
            stemTrailPositions[i * 3 + 1] = hState.stemDirWorld.y * stemTipOffset;
            stemTrailPositions[i * 3 + 2] = hState.stemDirWorld.z * stemTipOffset;

            barTrailPositions[i * 3] =
              -hState.stemDirWorld.x * iner.comX + hState.crossbarDirWorld.x * barTopOffset;
            barTrailPositions[i * 3 + 1] =
              -hState.stemDirWorld.y * iner.comX + hState.crossbarDirWorld.y * barTopOffset;
            barTrailPositions[i * 3 + 2] =
              -hState.stemDirWorld.z * iner.comX + hState.crossbarDirWorld.z * barTopOffset;
          }
        }
        stemTrailGeo.setDrawRange(0, count);
        stemTrailGeo.attributes.position.needsUpdate = true;

        barTrailGeo.setDrawRange(0, count);
        barTrailGeo.attributes.position.needsUpdate = true;
      } else {
        stemTrailLine.visible = false;
        barTrailLine.visible = false;
      }

      // Camera Choreography Modes
      if (cMode !== lastCamMode) {
        if (cMode === 'corotating-body') {
          // Frame the X-Z plane of the T-handle from a clear elevated front angle
          camera.position.set(0.06, 0.28, 0.22);
          camera.up.set(0, 1, 0);
          controls.target.set(0, 0, 0);
          controls.update();
        } else if (cMode === 'align-momentum') {
          camera.position.set(0, 0.18, 0.31);
          camera.up.set(0, 1, 0);
          controls.target.set(0, 0, 0);
          controls.update();
        } else {
          camera.position.set(0.24, 0.16, 0.28);
          camera.up.set(0, 1, 0);
          controls.target.set(0, 0, 0);
          controls.update();
        }
        lastCamMode = cMode;
      } else if (cMode === 'align-momentum') {
        _v2.set(0, 0.45, 1).normalize().multiplyScalar(0.34);
        camera.position.lerp(_v2, 0.08);
        camera.up.lerp(_up, 0.08);
        controls.target.set(0, 0, 0);
      }
    };

    // 9. On-Demand & Software-WebGL Paced Render Dispatcher
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        syncSceneToState();
        controls.update();
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;
    controls.addEventListener('change', requestRender);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', handleResize);

    // Initial render
    requestRender();

    return () => {
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('change', requestRender);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Re-render whenever physics state, visibility, or camera mode changes
  useEffect(() => {
    requestRenderRef.current?.();
  }, [currentState, vectorVisibility, cameraMode]);

  // Rebuild T-handle procedural mesh if user adjusts physical dimensions
  useEffect(() => {
    rebuildGeometryRef.current?.();
    requestRenderRef.current?.();
  }, [dimensions, inertia]);

  return (
    <div
      ref={mountRef}
      data-testid="vacuum-3d-canvas"
      className="w-full h-full relative overflow-hidden"
      aria-label="真空T形刚体三维物理仿真视口"
    />
  );
};
