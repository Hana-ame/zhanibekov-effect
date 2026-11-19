import React from 'react';
import {
  AxisPresetId,
  RigidBodyState,
  SimulationConfig,
} from '../physics/dzhanibekov';
import { CameraMode, VectorVisibility } from './VacuumScene3D';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  FastForward,
  Rewind,
  Crosshair,
} from 'lucide-react';

interface BottomControlDockProps {
  isPlaying: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onTogglePlay: () => void;
  onStepFrames: (deltaFrames: number) => void;
  onJumpToNextFlipApex: () => void;
  onScrubFrame: (frameIndex: number) => void;
  onReset: () => void;
  currentState: RigidBodyState;
  totalHistoryFrames: number;
  config: SimulationConfig;
  onChangePreset: (preset: AxisPresetId) => void;
  onChangeSpinRate: (rate: number) => void;
  onChangePerturbation: (eps: number) => void;
  playbackSpeed: number;
  onChangePlaybackSpeed: (speed: number) => void;
  vectorVisibility: VectorVisibility;
  onToggleVector: (key: keyof VectorVisibility) => void;
  cameraMode: CameraMode;
  onChangeCameraMode: (mode: CameraMode) => void;
}

export const BottomControlDock: React.FC<BottomControlDockProps> = ({
  isPlaying,
  isCollapsed,
  onToggleCollapse,
  onTogglePlay,
  onStepFrames,
  onJumpToNextFlipApex,
  onScrubFrame,
  onReset,
  currentState,
  totalHistoryFrames,
  config,
  onChangePreset,
  onChangeSpinRate,
  onChangePerturbation,
  playbackSpeed,
  onChangePlaybackSpeed,
  vectorVisibility,
  onToggleVector,
  cameraMode,
  onChangeCameraMode,
}) => {
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(980px,96vw)] flex flex-col items-center pointer-events-none"
      aria-label="底部物理仿真与逐帧步进控制台"
    >
      {/* Collapse / Expand Toggle Handle */}
      <button
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1 text-xs font-medium text-slate-300 bg-[#090d16] border border-b-0 border-slate-800 rounded-t-lg hover:text-white hover:bg-slate-900 transition-colors"
      >
        {isCollapsed ? (
          <>
            <ChevronUp className="w-3.5 h-3.5" />
            <span>展开逐帧与受力控制台 (H)</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5" />
            <span>隐藏控制台 · 纯净视图 (H)</span>
          </>
        )}
      </button>

      {/* Main Dock Panel */}
      {!isCollapsed && (
        <div className="pointer-events-auto w-full bg-[#090d16] border border-slate-800 rounded-xl shadow-2xl p-3.5 space-y-3">
          {/* Row 1: Frame-by-Frame Stepping Bar & Timeline Scrubber */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            {/* Playback & Frame Step Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={onTogglePlay}
                aria-label={isPlaying ? '暂停并进入逐帧步进模式' : '播放连续物理动画'}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isPlaying
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>暂停 / 逐帧</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>播放动画</span>
                  </>
                )}
              </button>

              <button
                onClick={() => onStepFrames(-10)}
                disabled={currentState.frame === 0}
                title="后退 10 帧"
                className="px-2.5 py-2 text-xs font-mono font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                <Rewind className="w-3.5 h-3.5" />
                <span>-10帧</span>
              </button>

              <button
                onClick={() => onStepFrames(-1)}
                disabled={currentState.frame === 0}
                title="上一帧 (快捷键 ←)"
                className="px-2.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span>上一帧 (-1)</span>
              </button>

              <button
                onClick={() => onStepFrames(1)}
                title="下一帧 (快捷键 →)"
                className="px-3 py-2 text-xs font-semibold text-white bg-sky-600 border border-sky-500 rounded-lg hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                <span>下一帧 (+1)</span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => onStepFrames(10)}
                title="前进 10 帧"
                className="px-2.5 py-2 text-xs font-mono font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                <span>+10帧</span>
                <FastForward className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={onJumpToNextFlipApex}
                title="自动步进至下一次翻转90°临界受力峰值帧"
                className="px-2.5 py-2 text-xs font-medium text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg hover:bg-rose-900/60 hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>跳至翻转临界帧</span>
              </button>

              <button
                onClick={onReset}
                aria-label="重置仿真初始状态"
                title="重置仿真 (快捷键 R)"
                className="p-2 text-slate-400 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 hover:text-white transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Frame Counter & Timeline Scrubber */}
            <div className="flex items-center gap-3 flex-1 min-w-[220px]">
              <label
                htmlFor="frame-scrubber"
                className="text-xs font-mono tabular-nums text-slate-300 whitespace-nowrap shrink-0"
              >
                帧 #{currentState.frame} / {Math.max(currentState.frame, totalHistoryFrames - 1)}
                <span className="text-slate-500 mx-1.5">·</span>
                <span className="text-sky-400">{currentState.time.toFixed(3)}s</span>
              </label>
              <input
                id="frame-scrubber"
                type="range"
                min={0}
                max={Math.max(120, totalHistoryFrames - 1)}
                value={currentState.frame}
                onChange={(e) => onScrubFrame(Number(e.target.value))}
                aria-label="历史帧时间轴拖拽滑块"
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
              />
            </div>
          </div>

          {/* Row 2: Axis Stability Presets & Vector Overlay Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Principal Axis Rotation Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-medium text-slate-400 mr-1 whitespace-nowrap">
                旋转主轴实验:
              </span>
              {(
                [
                  { id: 'intermediate-flip', label: '中轴 I₁ (不稳定翻转)' },
                  { id: 'minor-stable', label: '最小轴 I₃ (横梁稳定)' },
                  { id: 'major-stable', label: '最大轴 I₂ (法向稳定)' },
                  { id: 'high-perturbation', label: '强扰动高频翻转' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onChangePreset(item.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    config.preset === item.id
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* 3D Force Vector & Trajectory Toggles */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-medium text-slate-400 mr-1 whitespace-nowrap">
                三维受力矢量:
              </span>
              <button
                onClick={() => onToggleVector('showCentrifugal')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  vectorVisibility.showCentrifugal
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                离心力 F_cf
              </button>
              <button
                onClick={() => onToggleVector('showConstraint')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  vectorVisibility.showConstraint
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                结构拉力 F_内
              </button>
              <button
                onClick={() => onToggleVector('showAngularVectors')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  vectorVisibility.showAngularVectors
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                动量矩 L 与 ω
              </button>
              <button
                onClick={() => onToggleVector('showTrajectory')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  vectorVisibility.showTrajectory
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                翻转空间轨迹
              </button>
              <button
                onClick={() => onToggleVector('showPoinsotEllipsoid')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  vectorVisibility.showPoinsotEllipsoid
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                潘索惯量椭球
              </button>
            </div>
          </div>

          {/* Row 3: Physical Sliders & Reference Frame Camera Mode */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800/70 items-center">
            {/* Initial Spin Rate Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <label htmlFor="spin-rate-slider" className="text-slate-400">
                  初始角速度 ω₀
                </label>
                <span className="font-mono tabular-nums text-slate-200">
                  {config.spinRate.toFixed(0)} rad/s
                </span>
              </div>
              <input
                id="spin-rate-slider"
                type="range"
                min={12}
                max={50}
                step={1}
                value={config.spinRate}
                onChange={(e) => onChangeSpinRate(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            {/* Initial Perturbation Ratio Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <label htmlFor="perturbation-slider" className="text-slate-400">
                  初始横向微扰 ε
                </label>
                <span className="font-mono tabular-nums text-slate-200">
                  {(config.perturbationRatio * 100).toFixed(1)}%
                </span>
              </div>
              <input
                id="perturbation-slider"
                type="range"
                min={0.002}
                max={0.08}
                step={0.002}
                value={config.perturbationRatio}
                onChange={(e) => onChangePerturbation(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Playback Time Dilation (Slow-Mo) */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]">
                <label htmlFor="speed-slider" className="text-slate-400">
                  动画时间倍率 (慢放)
                </label>
                <span className="font-mono tabular-nums text-slate-200">
                  {playbackSpeed.toFixed(2)}x
                </span>
              </div>
              <input
                id="speed-slider"
                type="range"
                min={0.1}
                max={2.0}
                step={0.05}
                value={playbackSpeed}
                onChange={(e) => onChangePlaybackSpeed(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
              />
            </div>

            {/* Reference Frame Camera Switcher */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">观察参考系视角</span>
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                {(
                  [
                    { id: 'inertial-free', label: '自由轨道' },
                    { id: 'align-momentum', label: '正视翻转' },
                    { id: 'corotating-body', label: '随体主轴系' },
                  ] as const
                ).map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => onChangeCameraMode(cam.id)}
                    className={`py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                      cameraMode === cam.id
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cam.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
