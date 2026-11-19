import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AxisPresetId,
  DEFAULT_DIMENSIONS,
  RigidBodyState,
  SimulationConfig,
  computeTHandleInertia,
  createInitialState,
  stepSimulationFrame,
} from './physics/dzhanibekov';
import {
  CameraMode,
  VacuumScene3D,
  VectorVisibility,
} from './components/VacuumScene3D';
import { ForceAnalysisPanel } from './components/ForceAnalysisPanel';
import { BottomControlDock } from './components/BottomControlDock';

const INITIAL_PRECOMPUTED_FRAMES = 360; // 3.0 seconds pre-buffered at 120Hz for instant scrubbing

export default function App() {
  const [config, setConfig] = useState<SimulationConfig>({
    dimensions: DEFAULT_DIMENSIONS,
    spinRate: 28,
    perturbationRatio: 0.018,
    preset: 'intermediate-flip',
    dt: 1 / 120,
  });

  const inertia = useMemo(
    () => computeTHandleInertia(config.dimensions),
    [config.dimensions]
  );

  // Pre-build deterministic history buffer so user can scrub or step immediately
  const buildInitialHistory = useCallback(
    (cfg: SimulationConfig) => {
      const iner = computeTHandleInertia(cfg.dimensions);
      const frames: RigidBodyState[] = [createInitialState(cfg)];
      for (let i = 0; i < INITIAL_PRECOMPUTED_FRAMES; i++) {
        frames.push(stepSimulationFrame(frames[frames.length - 1], cfg, iner));
      }
      return frames;
    },
    []
  );

  const [history, setHistory] = useState<RigidBodyState[]>(() =>
    buildInitialHistory({
      dimensions: DEFAULT_DIMENSIONS,
      spinRate: 28,
      perturbationRatio: 0.018,
      preset: 'intermediate-flip',
      dt: 1 / 120,
    })
  );
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(0.65);
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState<boolean>(true);
  const [analysisTab, setAnalysisTab] = useState<'guide' | 'diagram' | 'phase' | 'table'>('guide');
  const [cameraMode, setCameraMode] = useState<CameraMode>('inertial-free');

  const [vectorVisibility, setVectorVisibility] = useState<VectorVisibility>({
    showCentrifugal: true,
    showConstraint: true,
    showAngularVectors: true,
    showTrajectory: true,
    showPoinsotEllipsoid: false,
  });

  const currentState = history[Math.min(currentFrameIndex, history.length - 1)] || history[0];

  // Expose testable state on document.body for automated verification
  useEffect(() => {
    document.body.setAttribute('data-state', isPlaying ? 'playing' : 'paused-stepping');
    document.body.setAttribute('data-frame', String(currentState.frame));
    document.body.setAttribute('data-flips', String(currentState.flipCount));
  }, [isPlaying, currentState.frame, currentState.flipCount]);

  // Ensure history always extends at least 120 frames ahead of currentFrameIndex
  const ensureHistoryUpTo = useCallback(
    (targetFrame: number) => {
      setHistory((prev) => {
        if (targetFrame < prev.length) return prev;
        const nextHistory = [...prev];
        const needed = Math.min(targetFrame + 120, prev.length + 1200);
        while (nextHistory.length <= needed) {
          const last = nextHistory[nextHistory.length - 1];
          nextHistory.push(stepSimulationFrame(last, config, inertia));
        }
        return nextHistory;
      });
    },
    [config, inertia]
  );

  // Step forward or backward by N frames (automatically enters frame-by-frame pause mode)
  const handleStepFrames = useCallback(
    (deltaFrames: number) => {
      setIsPlaying(false);
      setCurrentFrameIndex((prevIdx) => {
        const target = Math.max(0, prevIdx + deltaFrames);
        ensureHistoryUpTo(target + 60);
        return target;
      });
    },
    [ensureHistoryUpTo]
  );

  // Smart Jump: Step forward to the exact mid-flip critical frame where |\omega_1| is minimal (maximum centrifugal torque)
  const handleJumpToNextFlipApex = useCallback(() => {
    setIsPlaying(false);
    setHistory((prev) => {
      const nextHistory = [...prev];
      const searchLimit = currentFrameIndex + 360;
      while (nextHistory.length <= searchLimit) {
        const last = nextHistory[nextHistory.length - 1];
        nextHistory.push(stepSimulationFrame(last, config, inertia));
      }

      const startSign = nextHistory[currentFrameIndex].omegaBody.x >= 0 ? 1 : -1;
      let targetIdx = currentFrameIndex + 15;
      for (let i = currentFrameIndex + 2; i < searchLimit; i++) {
        const w1 = nextHistory[i].omegaBody.x;
        const sign = w1 >= 0 ? 1 : -1;
        if (sign !== startSign || Math.abs(w1) < 1.2) {
          targetIdx = i;
          break;
        }
      }
      setCurrentFrameIndex(targetIdx);
      return nextHistory;
    });
  }, [currentFrameIndex, config, inertia]);

  const handleScrubFrame = useCallback(
    (frameIdx: number) => {
      setIsPlaying(false);
      ensureHistoryUpTo(frameIdx + 60);
      setCurrentFrameIndex(frameIdx);
    },
    [ensureHistoryUpTo]
  );

  const resetWithConfig = useCallback(
    (newConfig: SimulationConfig) => {
      setConfig(newConfig);
      const freshHistory = buildInitialHistory(newConfig);
      setHistory(freshHistory);
      setCurrentFrameIndex(0);
    },
    [buildInitialHistory]
  );

  const handleReset = useCallback(() => {
    resetWithConfig(config);
  }, [config, resetWithConfig]);

  // Continuous playback loop throttled to ~20Hz React state updates while advancing exact physics frames
  const accumTimeRef = useRef<number>(0);
  useEffect(() => {
    if (!isPlaying) return;
    let lastTime = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const elapsedSec = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      accumTimeRef.current += elapsedSec * playbackSpeed;
      const framesToAdvance = Math.floor(accumTimeRef.current / config.dt);
      if (framesToAdvance >= 1) {
        accumTimeRef.current -= framesToAdvance * config.dt;
        setCurrentFrameIndex((prevIdx) => {
          const nextIdx = prevIdx + framesToAdvance;
          ensureHistoryUpTo(nextIdx + 120);
          return nextIdx;
        });
      }
    }, 45);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, config.dt, ensureHistoryUpTo]);

  // Global keyboard shortcuts for frame-by-frame stepping & Zen mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.code === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        handleStepFrames(e.shiftKey ? 10 : 1);
      } else if (e.code === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        handleStepFrames(e.shiftKey ? -10 : -1);
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setIsDockCollapsed((c) => !c);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleReset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStepFrames, handleReset]);

  const handleToggleVector = useCallback((key: keyof VectorVisibility) => {
    setVectorVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#060911] text-slate-100 select-none">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#060911]/95 border-b border-slate-800/90">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            handleReset();
          }}
          className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          贾尼别科夫效应 · 真空刚体力学实验室
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="实验分析模式导航"
          className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300"
        >
          <button
            onClick={() => {
              setIsAnalysisOpen(true);
              setAnalysisTab('diagram');
            }}
            className={`hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isAnalysisOpen && analysisTab === 'diagram' ? 'text-white underline' : ''
            }`}
          >
            离心力偶机理
          </button>
          <button
            onClick={() => {
              setIsAnalysisOpen(true);
              setAnalysisTab('phase');
            }}
            className={`hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isAnalysisOpen && analysisTab === 'phase' ? 'text-white underline' : ''
            }`}
          >
            角速度相空间
          </button>
          <button
            onClick={() => {
              setIsAnalysisOpen(true);
              setAnalysisTab('table');
            }}
            className={`hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isAnalysisOpen && analysisTab === 'table' ? 'text-white underline' : ''
            }`}
          >
            微元内力分布
          </button>
          <button
            onClick={() => setIsAnalysisOpen((o) => !o)}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            {isAnalysisOpen ? '收起分析抽屉' : '展开分析抽屉'}
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
          >
            {isPlaying ? '切换逐帧步进模式' : '恢复连续旋转动画'}
          </button>
        </div>
      </header>

      {/* Top-Left Compact Live Telemetry Readout (Unobstructed 3D Center) */}
      <div
        aria-label="实时动力学遥测摘要"
        className="fixed top-16 left-4 z-20 bg-[#090d16]/90 border border-slate-800 rounded-xl px-4 py-3 space-y-2 pointer-events-auto max-w-xs"
      >
        <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>真空无外力矩状态</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono tabular-nums text-emerald-400">
            翻转次数: {currentState.flipCount} 次
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 font-mono tabular-nums">
          <div>
            <div className="text-[10px] text-slate-400">手柄轴 ω₁</div>
            <div className="text-sm font-semibold text-emerald-400">
              {currentState.omegaBody.x >= 0
                ? `+${currentState.omegaBody.x.toFixed(1)}`
                : currentState.omegaBody.x.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">法向轴 ω₂</div>
            <div className="text-sm font-semibold text-sky-400">
              {currentState.omegaBody.y >= 0
                ? `+${currentState.omegaBody.y.toFixed(1)}`
                : currentState.omegaBody.y.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">横梁轴 ω₃</div>
            <div className="text-sm font-semibold text-orange-400">
              {currentState.omegaBody.z >= 0
                ? `+${currentState.omegaBody.z.toFixed(1)}`
                : currentState.omegaBody.z.toFixed(1)}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80 font-mono tabular-nums">
          <span>章动倾角 θ = {currentState.nutationAngleDeg.toFixed(1)}°</span>
          <span>·</span>
          <span className="text-amber-400">
            M_内 = {currentState.junctionBendingMoment.toFixed(3)} N·m
          </span>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
          <span className="text-rose-400">→ 离心力 F_cf</span>
          <span>·</span>
          <span className="text-amber-400">→ 结构拉力 F_内</span>
          <span>·</span>
          <span className="text-emerald-400">→ 动量矩 L</span>
        </div>
      </div>

      {/* Main 3D Vacuum Viewport (100% Full Screen) */}
      <main className="w-full h-full">
        <VacuumScene3D
          currentState={currentState}
          history={history}
          dimensions={config.dimensions}
          inertia={inertia}
          vectorVisibility={vectorVisibility}
          cameraMode={cameraMode}
          onCameraModeChange={setCameraMode}
        />
      </main>

      {/* Right-Side Collapsible Force Analysis & Phase Space Drawer */}
      <ForceAnalysisPanel
        isOpen={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        currentState={currentState}
        history={history}
        inertia={inertia}
        dimensions={config.dimensions}
        activeTab={analysisTab}
        onTabChange={setAnalysisTab}
        onSelectFrame={handleScrubFrame}
      />

      {/* Unified Collapsible Bottom Control Dock */}
      <BottomControlDock
        isPlaying={isPlaying}
        isCollapsed={isDockCollapsed}
        onToggleCollapse={() => setIsDockCollapsed((c) => !c)}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onStepFrames={handleStepFrames}
        onJumpToNextFlipApex={handleJumpToNextFlipApex}
        onScrubFrame={handleScrubFrame}
        onReset={handleReset}
        currentState={currentState}
        totalHistoryFrames={history.length}
        config={config}
        onChangePreset={(preset: AxisPresetId) =>
          resetWithConfig({ ...config, preset })
        }
        onChangeSpinRate={(spinRate: number) =>
          resetWithConfig({ ...config, spinRate })
        }
        onChangePerturbation={(perturbationRatio: number) =>
          resetWithConfig({ ...config, perturbationRatio })
        }
        playbackSpeed={playbackSpeed}
        onChangePlaybackSpeed={setPlaybackSpeed}
        vectorVisibility={vectorVisibility}
        onToggleVector={handleToggleVector}
        cameraMode={cameraMode}
        onChangeCameraMode={setCameraMode}
      />
    </div>
  );
}
