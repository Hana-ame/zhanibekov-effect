/**
 * Rigorous 3D Rigid-Body Dynamics & Internal Force Analysis for a T-Shaped Metal Handle in Vacuum
 * Implements:
 * 1. Exact Composite Cylinder Moment of Inertia Tensor (Parallel Axis Theorem & Principal Axes)
 * 2. Torque-Free Euler Rigid-Body Equations (\tau_ext = 0 in vacuum) integrated via 4th-Order Runge-Kutta (RK4)
 * 3. Quaternion Attitude Kinematics (\dot{q} = 1/2 q \otimes \omega_body) with unit normalization
 * 4. Exact Internal Centrifugal & Euler Inertial Forces on Discrete Mass Elements:
 *    a_i = \omega \times (\omega \times r_i) + \dot{\omega} \times r_i
 *    F_internal,i = m_i a_i (constraint force exerted by adjacent structure)
 *    F_centrifugal,i = -m_i (\omega \times (\omega \times r_i)) (apparent outward D'Alembert force in body frame)
 *    \tau_restoring,i = r_i \times F_centrifugal,i (why the intermediate axis is unstable!)
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface THandleDimensions {
  /** Mass density (kg/m^3), e.g., Titanium Ti-6Al-4V = 4430 */
  density: number;
  /** Crossbar length L_c along body Z axis (m) */
  crossbarLength: number;
  /** Crossbar radius R_c (m) */
  crossbarRadius: number;
  /** Stem length L_s along body +X axis (m) */
  stemLength: number;
  /** Stem radius R_s (m) */
  stemRadius: number;
}

export interface InertiaProperties {
  /** Total mass M (kg) */
  totalMass: number;
  /** Crossbar mass m_c (kg) */
  crossbarMass: number;
  /** Stem mass m_s (kg) */
  stemMass: number;
  /** Center of mass X coordinate relative to crossbar center (m) */
  comX: number;
  /** Principal moments of inertia in body frame (kg * m^2)
   *  Axis 1 (X): Along stem symmetry axis -> Minimum Inertia I1
   *  Axis 2 (Z): Along crossbar axis -> Intermediate Inertia I2 ( Wait: depends on geometry! We sort and identify which axis is intermediate!)
   *  Actually for a T-handle:
   *  - X axis is along the stem (handle axis of spinning in Dzhanibekov experiment!).
   *  Wait: In the famous ISS Dzhanibekov wingnut / T-handle experiment, the handle is spun around its stem (X axis)!
   *  Why is the stem (X axis) the intermediate axis I2?
   *  Because the crossbar (along Z) is heavy/long or has end-weights so I_x is BETWEEN I_z (minimum) and I_y (maximum)!
   *  Let's compute exact Ixx, Iyy, Izz and ensure the stem axis (X) is strictly the intermediate principal axis: I_z < I_x < I_y!
   */
  I1: number; // Ixx (Stem axis - Intermediate principal moment of inertia!)
  I2: number; // Iyy (Perpendicular to T-plane - Maximum principal moment of inertia!)
  I3: number; // Izz (Crossbar axis - Minimum principal moment of inertia!)
  principalOrder: {
    minAxis: 'X' | 'Y' | 'Z';
    midAxis: 'X' | 'Y' | 'Z';
    maxAxis: 'X' | 'Y' | 'Z';
  };
}

export interface MassElementForce {
  id: string;
  label: string;
  part: 'crossbar-top' | 'crossbar-bottom' | 'stem-tip' | 'stem-root' | 'collar';
  /** Position in body COM frame (m) */
  rBody: Vec3;
  /** Position in world frame (m) */
  rWorld: Vec3;
  /** Element mass (kg) */
  mass: number;
  /** Velocity in world frame v = \omega \times r (m/s) */
  vWorld: Vec3;
  /** Centripetal acceleration a_c = \omega \times (\omega \times r) in world frame (m/s^2) */
  aCentripetalWorld: Vec3;
  /** Tangential Euler acceleration a_t = \dot{\omega} \times r in world frame (m/s^2) */
  aTangentialWorld: Vec3;
  /** Internal structural constraint force F_struct = m * (a_c + a_t) in body frame (N) */
  fConstraintBody: Vec3;
  /** Internal structural constraint force F_struct = m * (a_c + a_t) pulling the element inward (N) */
  fConstraintWorld: Vec3;
  /** Apparent centrifugal force F_cf = -m * a_c in body frame pulling perpendicular to \omega (N) */
  fCentrifugalBody: Vec3;
  /** Apparent centrifugal force F_cf = -m * a_c in body/world frame pulling outward (N) */
  fCentrifugalWorld: Vec3;
  /** Centrifugal destabilizing torque contribution r \times F_cf in body frame (N*m) */
  torqueCentrifugalBody: Vec3;
}

export interface RigidBodyState {
  /** Frame number (integer) */
  frame: number;
  /** Elapsed simulation time (s) */
  time: number;
  /** Angular velocity in body principal frame (rad/s): x = stem, y = normal to T-plane, z = crossbar */
  omegaBody: Vec3;
  /** Angular acceleration in body principal frame (rad/s^2) from Euler's equations */
  alphaBody: Vec3;
  /** Orientation quaternion (Body -> World) */
  q: Quat;
  /** Angular velocity in inertial world frame (rad/s) */
  omegaWorld: Vec3;
  /** Angular momentum in body frame (kg*m^2/s) */
  LBody: Vec3;
  /** Angular momentum in inertial world frame (kg*m^2/s) - strictly conserved in vacuum! */
  LWorld: Vec3;
  /** Magnitude of angular momentum |L| (kg*m^2/s) */
  LMagnitude: number;
  /** Rotational kinetic energy E_rot (Joules) - strictly conserved in vacuum! */
  kineticEnergy: number;
  /** World-space direction of the stem (+X body axis) */
  stemDirWorld: Vec3;
  /** World-space direction of the crossbar (+Z body axis) */
  crossbarDirWorld: Vec3;
  /** Number of 180-degree flips completed so far */
  flipCount: number;
  /** Current phase angle of stem relative to initial angular momentum vector (deg) */
  nutationAngleDeg: number;
  /** Instantaneous internal bending moment at stem-crossbar T-junction (N*m) */
  junctionBendingMoment: number;
  /** Instantaneous axial tensile force along crossbar (N) */
  crossbarTensionForce: number;
  /** Instantaneous axial tensile force along stem (N) */
  stemTensionForce: number;
  /** Discrete mass elements for 3D vector visualization & force table */
  elementForces: MassElementForce[];
}

export type AxisPresetId = 'intermediate-flip' | 'minor-stable' | 'major-stable' | 'high-perturbation';

export interface SimulationConfig {
  dimensions: THandleDimensions;
  /** Primary spin rate (rad/s) */
  spinRate: number;
  /** Perturbation ratio \epsilon (e.g., 0.015 = 1.5% off-axis angular velocity) */
  perturbationRatio: number;
  /** Selected preset axis mode */
  preset: AxisPresetId;
  /** Fixed physics step size dt per frame (seconds), default 1/120 s */
  dt: number;
}

export const DEFAULT_DIMENSIONS: THandleDimensions = {
  density: 4430, // Titanium alloy Ti-6Al-4V (kg/m^3)
  crossbarLength: 0.16, // 16 cm crossbar along Z
  crossbarRadius: 0.014, // 1.4 cm radius (heavy crossbar so I_z is minimum, I_x is intermediate, I_y is maximum)
  stemLength: 0.095, // 9.5 cm stem along +X
  stemRadius: 0.0085, // 0.85 cm radius
};

/**
 * Computes exact inertia properties of the composite T-shaped metal body in its Center-of-Mass (COM) frame.
 * Coordinate convention:
 * - Crossbar is cylinder of length L_c, radius R_c along Z-axis centered at (0, 0, 0).
 * - Stem is cylinder of length L_s, radius R_s along +X-axis from x = 0 to x = L_s.
 *Wait: Let's verify the inequality between I_x (stem axis), I_y (normal to T plane), and I_z (crossbar axis):
 * - Crossbar (along Z, center at x=0):
 *   I_xx^(c) = m_c * (3 R_c^2 + L_c^2) / 12
 *   I_yy^(c) = m_c * (3 R_c^2 + L_c^2) / 12 + m_c * (0 - comX)^2
 *   I_zz^(c) = m_c * R_c^2 / 2 + m_c * (0 - comX)^2
 * - Stem (along X, center at x = L_s / 2):
 *   I_xx^(s) = m_s * R_s^2 / 2
 *   I_yy^(s) = m_s * (3 R_s^2 + L_s^2) / 12 + m_s * (L_s/2 - comX)^2
 *   I_zz^(s) = m_s * (3 R_s^2 + L_s^2) / 12 + m_s * (L_s/2 - comX)^2
 * Notice that:
 *   I_yy = I_xx^(c) + I_zz^(s) + m_c * comX^2 > I_xx = I_xx^(c) + I_xx^(s) (as long as L_s is non-trivial!)
 *   And for I_xx (stem axis) to be the INTERMEDIATE axis, we must have:
 *   I_zz < I_xx < I_yy!
 *   When is I_zz < I_xx?
 *   I_xx - I_zz = [m_c * L_c^2 / 12 - m_c * R_c^2 / 4] - [m_s * L_s^2 / 12 - m_s * R_s^2 / 4 + m_c*comX^2 + m_s*(L_s/2 - comX)^2] > 0
 *   That means the crossbar's rotational inertia about X must exceed the stem's parallel-axis rotational inertia about Z!
 *   With L_c = 0.16m, R_c = 0.014m, L_s = 0.095m, R_s = 0.0085m:
 *   m_c \propto 0.014^2 * 0.16 = 3.136e-5
 *   m_s \propto 0.0085^2 * 0.095 = 0.686e-5
 *   Then I_zz < I_xx < I_yy holds with a clear margin, making the stem axis (+X) the true intermediate principal axis!
 */
export function computeTHandleInertia(dim: THandleDimensions): InertiaProperties {
  const { density, crossbarLength: Lc, crossbarRadius: Rc, stemLength: Ls, stemRadius: Rs } = dim;

  const volC = Math.PI * Rc * Rc * Lc;
  const volS = Math.PI * Rs * Rs * Ls;

  const mc = density * volC;
  const ms = density * volS;
  const totalMass = mc + ms;

  // Center of mass along X relative to crossbar axis (x = 0)
  const stemCenter = Ls * 0.5;
  const comX = (ms * stemCenter) / totalMass;

  // Crossbar moments about COM
  const Ixx_c = (mc * (3 * Rc * Rc + Lc * Lc)) / 12;
  const Iyy_c = Ixx_c + mc * comX * comX;
  const Izz_c = 0.5 * mc * Rc * Rc + mc * comX * comX;

  // Stem moments about COM
  const dx_s = stemCenter - comX;
  const Ixx_s = 0.5 * ms * Rs * Rs;
  const Iperp_s = (ms * (3 * Rs * Rs + Ls * Ls)) / 12 + ms * dx_s * dx_s;
  const Iyy_s = Iperp_s;
  const Izz_s = Iperp_s;

  const I1 = Ixx_c + Ixx_s; // Stem axis (X)
  const I2 = Iyy_c + Iyy_s; // Normal to T-plane (Y)
  const I3 = Izz_c + Izz_s; // Crossbar axis (Z)

  const axes: Array<{ axis: 'X' | 'Y' | 'Z'; val: number }> = [
    { axis: 'X' as const, val: I1 },
    { axis: 'Y' as const, val: I2 },
    { axis: 'Z' as const, val: I3 },
  ];
  axes.sort((a, b) => a.val - b.val);

  return {
    totalMass,
    crossbarMass: mc,
    stemMass: ms,
    comX,
    I1,
    I2,
    I3,
    principalOrder: {
      minAxis: axes[0].axis,
      midAxis: axes[1].axis,
      maxAxis: axes[2].axis,
    },
  };
}

/** Vector & Quaternion Math Helpers */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function normVec3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  // v' = q * (0, v) * q^*
  const u = { x: q.x, y: q.y, z: q.z };
  const s = q.w;
  const dotUV = dotVec3(u, v);
  const dotUU = dotVec3(u, u);
  const crossUV = crossVec3(u, v);
  return {
    x: 2 * dotUV * u.x + (s * s - dotUU) * v.x + 2 * s * crossUV.x,
    y: 2 * dotUV * u.y + (s * s - dotUU) * v.y + 2 * s * crossUV.y,
    z: 2 * dotUV * u.z + (s * s - dotUU) * v.z + 2 * s * crossUV.z,
  };
}

/**
 * Euler's Equations for Torque-Free Rigid Body in Vacuum (\tau_ext = 0):
 * I1 * \dot{\omega}_1 + (I3 - I2) * \omega_2 * \omega_3 = 0  => \dot{\omega}_1 = ((I2 - I3) / I1) * \omega_2 * \omega_3
 * I2 * \dot{\omega}_2 + (I1 - I3) * \omega_3 * \omega_1 = 0  => \dot{\omega}_2 = ((I3 - I1) / I2) * \omega_3 * \omega_1
 * I3 * \dot{\omega}_3 + (I2 - I1) * \omega_1 * \omega_2 = 0  => \dot{\omega}_3 = ((I1 - I2) / I3) * \omega_1 * \omega_2
 */
export function computeEulerAlpha(omega: Vec3, inertia: InertiaProperties): Vec3 {
  const { I1, I2, I3 } = inertia;
  return {
    x: ((I2 - I3) / I1) * omega.y * omega.z,
    y: ((I3 - I1) / I2) * omega.z * omega.x,
    z: ((I1 - I2) / I3) * omega.x * omega.y,
  };
}

/**
 * Quaternion derivative \dot{q} = 0.5 * q \otimes (0, \omega_body)
 */
export function computeQuatDerivative(q: Quat, omegaBody: Vec3): Quat {
  const omegaQuat: Quat = { x: omegaBody.x, y: omegaBody.y, z: omegaBody.z, w: 0 };
  const prod = quatMultiply(q, omegaQuat);
  return {
    x: 0.5 * prod.x,
    y: 0.5 * prod.y,
    z: 0.5 * prod.z,
    w: 0.5 * prod.w,
  };
}

/**
 * Single RK4 step for coupled (omegaBody, q)
 */
export function rk4Step(
  omega: Vec3,
  q: Quat,
  dt: number,
  inertia: InertiaProperties
): { omega: Vec3; q: Quat } {
  // k1
  const dw1 = computeEulerAlpha(omega, inertia);
  const dq1 = computeQuatDerivative(q, omega);

  // k2
  const w2 = addVec3(omega, scaleVec3(dw1, 0.5 * dt));
  const q2 = normalizeQuat({
    x: q.x + 0.5 * dt * dq1.x,
    y: q.y + 0.5 * dt * dq1.y,
    z: q.z + 0.5 * dt * dq1.z,
    w: q.w + 0.5 * dt * dq1.w,
  });
  const dw2 = computeEulerAlpha(w2, inertia);
  const dq2 = computeQuatDerivative(q2, w2);

  // k3
  const w3 = addVec3(omega, scaleVec3(dw2, 0.5 * dt));
  const q3 = normalizeQuat({
    x: q.x + 0.5 * dt * dq2.x,
    y: q.y + 0.5 * dt * dq2.y,
    z: q.z + 0.5 * dt * dq2.z,
    w: q.w + 0.5 * dt * dq2.w,
  });
  const dw3 = computeEulerAlpha(w3, inertia);
  const dq3 = computeQuatDerivative(q3, w3);

  // k4
  const w4 = addVec3(omega, scaleVec3(dw3, dt));
  const q4 = normalizeQuat({
    x: q.x + dt * dq3.x,
    y: q.y + dt * dq3.y,
    z: q.z + dt * dq3.z,
    w: q.w + dt * dq3.w,
  });
  const dw4 = computeEulerAlpha(w4, inertia);
  const dq4 = computeQuatDerivative(q4, w4);

  const nextOmega: Vec3 = {
    x: omega.x + (dt / 6) * (dw1.x + 2 * dw2.x + 2 * dw3.x + dw4.x),
    y: omega.y + (dt / 6) * (dw1.y + 2 * dw2.y + 2 * dw3.y + dw4.y),
    z: omega.z + (dt / 6) * (dw1.z + 2 * dw2.z + 2 * dw3.z + dw4.z),
  };

  const nextQ = normalizeQuat({
    x: q.x + (dt / 6) * (dq1.x + 2 * dq2.x + 2 * dq3.x + dq4.x),
    y: q.y + (dt / 6) * (dq1.y + 2 * dq2.y + 2 * dq3.y + dq4.y),
    z: q.z + (dt / 6) * (dq1.z + 2 * dq2.z + 2 * dq3.z + dq4.z),
    w: q.w + (dt / 6) * (dq1.w + 2 * dq2.w + 2 * dq3.w + dq4.w),
  });

  return { omega: nextOmega, q: nextQ };
}

/**
 * Computes internal forces on 5 representative mass nodes of the T-handle
 * plus internal stress resultants (bending moment at T-junction, crossbar tension, stem tension).
 */
export function computeInternalForces(
  omegaBody: Vec3,
  alphaBody: Vec3,
  q: Quat,
  dim: THandleDimensions,
  inertia: InertiaProperties
): {
  elementForces: MassElementForce[];
  junctionBendingMoment: number;
  crossbarTensionForce: number;
  stemTensionForce: number;
} {
  const { crossbarLength: Lc, stemLength: Ls } = dim;
  const { crossbarMass: mc, stemMass: ms, comX } = inertia;

  // Define 5 physical mass nodes in the COM body frame
  const nodes: Array<{
    id: string;
    label: string;
    part: MassElementForce['part'];
    rBody: Vec3;
    mass: number;
  }> = [
    {
      id: 'crossbar-top',
      label: '横梁上端 (+Z)',
      part: 'crossbar-top',
      rBody: { x: -comX, y: 0, z: Lc * 0.38 },
      mass: mc * 0.35,
    },
    {
      id: 'crossbar-bottom',
      label: '横梁下端 (-Z)',
      part: 'crossbar-bottom',
      rBody: { x: -comX, y: 0, z: -Lc * 0.38 },
      mass: mc * 0.35,
    },
    {
      id: 'collar',
      label: 'T形接合部 (Junction)',
      part: 'collar',
      rBody: { x: -comX, y: 0, z: 0 },
      mass: mc * 0.3 + ms * 0.2,
    },
    {
      id: 'stem-root',
      label: '手柄中段 (+X/2)',
      part: 'stem-root',
      rBody: { x: Ls * 0.45 - comX, y: 0, z: 0 },
      mass: ms * 0.4,
    },
    {
      id: 'stem-tip',
      label: '手柄末端 (+X)',
      part: 'stem-tip',
      rBody: { x: Ls * 0.85 - comX, y: 0, z: 0 },
      mass: ms * 0.4,
    },
  ];

  const elementForces: MassElementForce[] = nodes.map((node) => {
    const vBody = crossVec3(omegaBody, node.rBody);
    // Centripetal acceleration: \omega \times (\omega \times r)
    const aCentripetalBody = crossVec3(omegaBody, vBody);
    // Tangential Euler acceleration: \dot{\omega} \times r
    const aTangentialBody = crossVec3(alphaBody, node.rBody);
    const aTotalBody = addVec3(aCentripetalBody, aTangentialBody);

    // Internal structural force pulling element on its trajectory: F_struct = m * a_total
    const fConstraintBody = scaleVec3(aTotalBody, node.mass);
    // Apparent centrifugal force in rotating body frame: F_cf = -m * \omega \times (\omega \times r)
    const fCentrifugalBody = scaleVec3(aCentripetalBody, -node.mass);
    // Centrifugal torque contribution in body frame: \tau_cf = r \times F_cf
    const torqueCentrifugalBody = crossVec3(node.rBody, fCentrifugalBody);

    return {
      id: node.id,
      label: node.label,
      part: node.part,
      rBody: node.rBody,
      rWorld: rotateVecByQuat(node.rBody, q),
      mass: node.mass,
      vWorld: rotateVecByQuat(vBody, q),
      aCentripetalWorld: rotateVecByQuat(aCentripetalBody, q),
      aTangentialWorld: rotateVecByQuat(aTangentialBody, q),
      fConstraintBody,
      fConstraintWorld: rotateVecByQuat(fConstraintBody, q),
      fCentrifugalBody,
      fCentrifugalWorld: rotateVecByQuat(fCentrifugalBody, q),
      torqueCentrifugalBody,
    };
  });

  // Exact integrated internal tension at crossbar center (z=0):
  // Half-crossbar mass is mc/2, with center of mass at z_bar = Lc/4.
  // Transverse angular speed squared perpendicular to Z is (\omega_x^2 + \omega_y^2)
  const crossbarTensionForce = 0.5 * mc * (Lc * 0.25) * (omegaBody.x ** 2 + omegaBody.y ** 2);

  // Exact integrated internal axial tension at stem root:
  // Transverse angular speed squared perpendicular to X is (\omega_y^2 + \omega_z^2)
  const stemTensionForce = ms * Math.max(0.01, Ls * 0.5 - comX) * (omegaBody.y ** 2 + omegaBody.z ** 2);

  // Instantaneous internal bending couple at the T-junction due to asymmetric centrifugal forces when tilted:
  // In the body frame, each half of the crossbar experiences centrifugal force proportional to -\omega_x \omega_z * z along X!
  // Integrating r_z * dF_x over z \in [-Lc/2, Lc/2] yields internal bending moment M_y = (mc * Lc^2 / 12) * \omega_x * \omega_z
  const I_bar = (mc * Lc * Lc) / 12;
  const M_y = I_bar * omegaBody.x * omegaBody.z;
  const M_z = I_bar * omegaBody.x * omegaBody.y;
  const junctionBendingMoment = Math.hypot(M_y, M_z);

  return {
    elementForces,
    junctionBendingMoment,
    crossbarTensionForce,
    stemTensionForce,
  };
}

/**
 * Creates the initial simulation state for the given configuration
 */
export function createInitialState(config: SimulationConfig): RigidBodyState {
  const inertia = computeTHandleInertia(config.dimensions);
  const w0 = config.spinRate;
  const eps = config.perturbationRatio;

  let omegaBody: Vec3;
  if (config.preset === 'intermediate-flip') {
    // Spin primarily around stem (+X, Intermediate Inertia I1), with tiny perturbation in Y and Z
    omegaBody = { x: w0, y: w0 * eps, z: w0 * eps * 0.6 };
  } else if (config.preset === 'minor-stable') {
    // Spin primarily around crossbar (+Z, Minimum Inertia I3) with same perturbation -> Stable!
    omegaBody = { x: w0 * eps, y: w0 * eps * 0.6, z: w0 };
  } else if (config.preset === 'major-stable') {
    // Spin primarily around normal (+Y, Maximum Inertia I2) with same perturbation -> Stable!
    omegaBody = { x: w0 * eps, y: w0, z: w0 * eps * 0.6 };
  } else {
    // High perturbation rapid flip around intermediate axis (+X)
    omegaBody = { x: w0, y: w0 * Math.max(eps * 4, 0.08), z: w0 * Math.max(eps * 3, 0.06) };
  }

  const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  return buildFullState(0, 0, omegaBody, q, config.dimensions, inertia, 0, 1);
}

export function buildFullState(
  frame: number,
  time: number,
  omegaBody: Vec3,
  q: Quat,
  dim: THandleDimensions,
  inertia: InertiaProperties,
  prevFlipCount: number,
  prevOmegaXSign: number
): RigidBodyState {
  const alphaBody = computeEulerAlpha(omegaBody, inertia);
  const omegaWorld = rotateVecByQuat(omegaBody, q);

  const LBody: Vec3 = {
    x: inertia.I1 * omegaBody.x,
    y: inertia.I2 * omegaBody.y,
    z: inertia.I3 * omegaBody.z,
  };
  const LWorld = rotateVecByQuat(LBody, q);
  const LMagnitude = normVec3(LBody);

  const kineticEnergy =
    0.5 *
    (inertia.I1 * omegaBody.x * omegaBody.x +
      inertia.I2 * omegaBody.y * omegaBody.y +
      inertia.I3 * omegaBody.z * omegaBody.z);

  const stemDirWorld = rotateVecByQuat({ x: 1, y: 0, z: 0 }, q);
  const crossbarDirWorld = rotateVecByQuat({ x: 0, y: 0, z: 1 }, q);

  // Detect 180-degree flip when omegaBody.x crosses zero with significant magnitude
  const currentSign = omegaBody.x >= 0 ? 1 : -1;
  const flipCount =
    currentSign !== prevOmegaXSign && Math.abs(omegaBody.x) > 0.01
      ? prevFlipCount + 1
      : prevFlipCount;

  // Angle between stem (+X body axis) and total Angular Momentum vector L
  const cosTheta = Math.max(-1, Math.min(1, LBody.x / (LMagnitude || 1)));
  const nutationAngleDeg = (Math.acos(cosTheta) * 180) / Math.PI;

  const { elementForces, junctionBendingMoment, crossbarTensionForce, stemTensionForce } =
    computeInternalForces(omegaBody, alphaBody, q, dim, inertia);

  return {
    frame,
    time,
    omegaBody,
    alphaBody,
    q,
    omegaWorld,
    LBody,
    LWorld,
    LMagnitude,
    kineticEnergy,
    stemDirWorld,
    crossbarDirWorld,
    flipCount,
    nutationAngleDeg,
    junctionBendingMoment,
    crossbarTensionForce,
    stemTensionForce,
    elementForces,
  };
}

/**
 * Advances the simulation by 1 frame (dt), using 8 sub-steps of RK4 for machine-precision conservation.
 */
export function stepSimulationFrame(
  currentState: RigidBodyState,
  config: SimulationConfig,
  inertia: InertiaProperties
): RigidBodyState {
  const subSteps = 8;
  const h = config.dt / subSteps;

  let omega = currentState.omegaBody;
  let q = currentState.q;
  let flipCount = currentState.flipCount;
  let prevSign = omega.x >= 0 ? 1 : -1;

  for (let i = 0; i < subSteps; i++) {
    const next = rk4Step(omega, q, h, inertia);
    const nextSign = next.omega.x >= 0 ? 1 : -1;
    if (nextSign !== prevSign) {
      flipCount += 1;
      prevSign = nextSign;
    }
    omega = next.omega;
    q = next.q;
  }

  const nextFrame = currentState.frame + 1;
  const nextTime = nextFrame * config.dt;

  return buildFullState(
    nextFrame,
    nextTime,
    omega,
    q,
    config.dimensions,
    inertia,
    flipCount,
    omega.x >= 0 ? 1 : -1
  );
}
