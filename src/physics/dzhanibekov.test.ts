import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DIMENSIONS,
  computeTHandleInertia,
  createInitialState,
  stepSimulationFrame,
  SimulationConfig,
} from './dzhanibekov';

test('T-handle principal moments of inertia satisfy I3 < I1 < I2 (stem +X is intermediate axis)', () => {
  const inertia = computeTHandleInertia(DEFAULT_DIMENSIONS);
  assert.ok(inertia.I3 < inertia.I1, `Expected crossbar axis I3 (${inertia.I3}) < stem axis I1 (${inertia.I1})`);
  assert.ok(inertia.I1 < inertia.I2, `Expected stem axis I1 (${inertia.I1}) < normal axis I2 (${inertia.I2})`);
  assert.equal(inertia.principalOrder.minAxis, 'Z');
  assert.equal(inertia.principalOrder.midAxis, 'X');
  assert.equal(inertia.principalOrder.maxAxis, 'Y');
});

test('Torque-free vacuum rotation strictly conserves rotational kinetic energy E and angular momentum LWorld', () => {
  const config: SimulationConfig = {
    dimensions: DEFAULT_DIMENSIONS,
    spinRate: 28,
    perturbationRatio: 0.015,
    preset: 'intermediate-flip',
    dt: 1 / 120,
  };
  const inertia = computeTHandleInertia(config.dimensions);
  let state = createInitialState(config);
  const initialE = state.kineticEnergy;
  const initialL = state.LWorld;

  for (let i = 0; i < 360; i++) {
    state = stepSimulationFrame(state, config, inertia);
  }

  // Relative energy drift over 360 frames (3 seconds) must be < 1e-7
  const relEnergyError = Math.abs(state.kineticEnergy - initialE) / initialE;
  assert.ok(relEnergyError < 1e-7, `Kinetic energy drifted by ${relEnergyError}`);

  // Inertial angular momentum components LWorld.x, LWorld.y, LWorld.z must remain invariant
  assert.ok(Math.abs(state.LWorld.x - initialL.x) < 1e-6);
  assert.ok(Math.abs(state.LWorld.y - initialL.y) < 1e-6);
  assert.ok(Math.abs(state.LWorld.z - initialL.z) < 1e-6);
});

test('Dzhanibekov intermediate axis flip occurs periodically while minor/major axes remain stable', () => {
  const flipConfig: SimulationConfig = {
    dimensions: DEFAULT_DIMENSIONS,
    spinRate: 30,
    perturbationRatio: 0.02,
    preset: 'intermediate-flip',
    dt: 1 / 120,
  };
  const inertia = computeTHandleInertia(flipConfig.dimensions);
  let state = createInitialState(flipConfig);

  let minOmegaX = state.omegaBody.x;
  for (let i = 0; i < 300; i++) {
    state = stepSimulationFrame(state, flipConfig, inertia);
    if (state.omegaBody.x < minOmegaX) {
      minOmegaX = state.omegaBody.x;
    }
  }

  // Omega_x must reverse sign from +30 rad/s to nearly -30 rad/s during a flip!
  assert.ok(minOmegaX < -25, `Expected stem angular velocity to flip negative (< -25), got ${minOmegaX}`);
  assert.ok(state.flipCount >= 1, `Expected at least 1 flip, got ${state.flipCount}`);

  // Compare with minor axis (crossbar Z) preset: omega_z must stay near +30 rad/s without flipping
  const stableConfig: SimulationConfig = {
    ...flipConfig,
    preset: 'minor-stable',
  };
  let stableState = createInitialState(stableConfig);
  for (let i = 0; i < 300; i++) {
    stableState = stepSimulationFrame(stableState, stableConfig, inertia);
    assert.ok(stableState.omegaBody.z > 29, `Expected minor axis spin to remain stable > 29, got ${stableState.omegaBody.z}`);
  }
});

test('Internal centrifugal force and T-junction bending moment scale with angular velocity components', () => {
  const config: SimulationConfig = {
    dimensions: DEFAULT_DIMENSIONS,
    spinRate: 25,
    perturbationRatio: 0.02,
    preset: 'intermediate-flip',
    dt: 1 / 120,
  };
  const inertia = computeTHandleInertia(config.dimensions);
  const state = createInitialState(config);

  assert.equal(state.elementForces.length, 5);
  assert.ok(state.crossbarTensionForce > 0, 'Crossbar tension force must be positive during spin');
  assert.ok(state.junctionBendingMoment > 0, 'T-junction internal bending couple must be non-zero when perturbed');

  // Verify physical law: Centrifugal force F_cf = -m * \omega \times (\omega \times r)
  // MUST be strictly perpendicular to instantaneous rotation axis \omega (\omega \cdot F_cf === 0)
  for (const ef of state.elementForces) {
    const dotOmegaFcf =
      state.omegaBody.x * ef.fCentrifugalBody.x +
      state.omegaBody.y * ef.fCentrifugalBody.y +
      state.omegaBody.z * ef.fCentrifugalBody.z;
    assert.ok(
      Math.abs(dotOmegaFcf) < 1e-10,
      `Expected F_cf to be perpendicular to omega, got dot product ${dotOmegaFcf}`
    );
  }
});
