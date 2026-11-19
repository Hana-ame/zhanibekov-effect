import React, { useEffect, useRef } from 'react';
import {
  InertiaProperties,
  RigidBodyState,
  THandleDimensions,
  normVec3,
} from '../physics/dzhanibekov';
import { X, ChevronRight } from 'lucide-react';

interface ForceAnalysisPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentState: RigidBodyState;
  history: RigidBodyState[];
  inertia: InertiaProperties;
  dimensions: THandleDimensions;
  activeTab: 'guide' | 'diagram' | 'phase' | 'table';
  onTabChange: (tab: 'guide' | 'diagram' | 'phase' | 'table') => void;
  onSelectFrame?: (frameIndex: number) => void;
}

export const ForceAnalysisPanel: React.FC<ForceAnalysisPanelProps> = ({
  isOpen,
  onClose,
  currentState,
  history,
  inertia,
  activeTab,
  onTabChange,
  onSelectFrame,
}) => {
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const [framePerspective, setFramePerspective] = React.useState<'corotating' | 'inertial'>('corotating');

  // Draw live time-series chart of \omega_1(t), \omega_2(t), \omega_3(t) & junction bending moment
  useEffect(() => {
    if (!isOpen || activeTab !== 'phase') return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const midY = h / 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.moveTo(0, h * 0.2);
    ctx.lineTo(w, h * 0.2);
    ctx.moveTo(0, h * 0.8);
    ctx.lineTo(w, h * 0.8);
    ctx.stroke();

    if (history.length < 2) return;

    const maxOmega = Math.max(
      35,
      ...history.map((s) =>
        Math.max(Math.abs(s.omegaBody.x), Math.abs(s.omegaBody.y), Math.abs(s.omegaBody.z))
      )
    );

    const totalFrames = Math.max(120, history.length - 1);
    const mapX = (frameIdx: number) => (frameIdx / totalFrames) * (w - 24) + 12;
    const mapY = (val: number) => midY - (val / maxOmega) * (h * 0.42);

    const drawCurve = (getter: (s: RigidBodyState) => number, color: string, lineWidth = 2) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = mapX(i);
        const y = mapY(getter(history[i]));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // Plot \omega_1 (Stem X - Intermediate Axis, Emerald)
    drawCurve((s) => s.omegaBody.x, '#10b981', 2.2);
    // Plot \omega_2 (Normal Y - Major Axis, Cyan)
    drawCurve((s) => s.omegaBody.y, '#38bdf8', 1.7);
    // Plot \omega_3 (Crossbar Z - Minor Axis, Orange)
    drawCurve((s) => s.omegaBody.z, '#f97316', 1.7);

    // Vertical playhead for current frame
    const curX = mapX(Math.min(currentState.frame, history.length - 1));
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(curX, 6);
    ctx.lineTo(curX, h - 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [isOpen, activeTab, currentState, history]);

  if (!isOpen) return null;

  // Compute instantaneous Tilt / Centrifugal feedback values for the 2D Free-Body SVG diagram
  const w1 = currentState.omegaBody.x;
  const w2 = currentState.omegaBody.y;
  const w3 = currentState.omegaBody.z;
  const alpha1 = currentState.alphaBody.x;
  const alpha2 = currentState.alphaBody.y;
  const alpha3 = currentState.alphaBody.z;

  // Angle between stem (+X) and instantaneous angular velocity \omega in X-Z plane
  const rawTiltDeg = (Math.atan2(w3, Math.abs(w1) + 0.5) * 180) / Math.PI;
  const signTilt = rawTiltDeg >= 0 ? 1 : -1;
  // Ensure at least 16 deg visual tilt in schematic so the moment arm d = Lc*sin(\theta) is always legible
  const visualTiltDeg = signTilt * Math.max(16, Math.min(30, Math.abs(rawTiltDeg) * 1.4 + 14));
  const tiltRad = (visualTiltDeg * Math.PI) / 180;

  // Exact SVG coordinates of the crossbar ends (+Z and -Z) relative to COM (cx=155, cy=68)
  const cx = 155;
  const cy = 68;
  const barHalfPx = 36;
  const topX = cx + barHalfPx * Math.sin(tiltRad);
  const topY = cy - barHalfPx * Math.cos(tiltRad);
  const botX = cx - barHalfPx * Math.sin(tiltRad);
  const botY = cy + barHalfPx * Math.cos(tiltRad);

  return (
    <aside
      aria-label="受力分析与欧拉动力学面板"
      className="fixed top-16 right-4 z-20 w-[420px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-12rem)] bg-[#090d16] border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            真空刚体受力来源与中间轴翻转机理
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            外力 ∑F_外 = 0 · 惯性系真实内力 vs 随体系离心力偶
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="关闭受力分析面板"
          className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Segmented Tabs */}
      <div className="px-3.5 pt-2.5 pb-2 border-b border-slate-800/80">
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
          <button
            onClick={() => onTabChange('guide')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'guide'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            四步通俗原理
          </button>
          <button
            onClick={() => onTabChange('diagram')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'diagram'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            力从哪来·图解
          </button>
          <button
            onClick={() => onTabChange('phase')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'phase'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            角速度时序
          </button>
          <button
            onClick={() => onTabChange('table')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'table'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            微元内力表
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-3.5 overflow-y-auto space-y-2.5 text-xs">
        {activeTab === 'guide' && (
          <div className="space-y-2.5">
            <div className="p-2.5 bg-sky-950/30 border border-sky-800/50 rounded-lg text-[11px] text-slate-300 leading-relaxed">
              <strong className="text-sky-300">核心一句话：</strong>
              把T形架想象成<strong>「两颗沉重的铁球（横梁两端）」</strong>绑在<strong>「一根轻木棍（手柄）」</strong>上。点击下方 4 个阶段按钮，3D 画面将自动定格到对应瞬间：
            </div>

            {[
              {
                step: '01. 初始旋转：两颗重球绕手柄画圈',
                frame: 5,
                badge: '帧 #5 · 倾角 1.4°',
                desc: '横梁两端的金属配重最沉。刚开始绕手柄旋转时，上下两端像链球一样高速画圈，想往外飞，靠金属横梁向内死死拉住（金色箭头 F_内）。',
              },
              {
                step: '02. 微小歪斜被放大：不共线拉力把横梁掰歪',
                frame: 145,
                badge: '帧 #145 · 倾角 34°',
                desc: '只要横梁歪了一丁点，上端偏前、下端偏后，两端向外甩的离心趋势（红箭头 F_cf）就不再对齐一条直线，像两只手往相反方向狠狠掰横梁，让它越歪越快！',
              },
              {
                step: '03. 90° 临界点：角动量守恒逼迫手柄掉头',
                frame: 169,
                badge: '帧 #169 · 倾角 90.8°',
                desc: '太空中没有外力，总旋转方向（绿箭头动量矩 L）绝对锁死不变！当横梁被掰得侧翻过来时，为了凑齐不变的总角动量，轻巧的手柄被迫向侧面甩过 90° 掉头！',
              },
              {
                step: '04. 完成 180° 翻转：冲上对面山顶暂时稳定',
                frame: 215,
                badge: '帧 #215 · 倾角 178°',
                desc: '就像倒下的单摆冲上对面的最高点，手柄刚好翻转 180° 时摆动动能耗尽，横梁重新回到垂直于转轴的姿态，于是反向稳定转几圈，再蓄力下一次翻转。',
              },
            ].map((item) => (
              <button
                key={item.frame}
                onClick={() => onSelectFrame?.(item.frame)}
                className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                  Math.abs(currentState.frame - item.frame) <= 12
                    ? 'bg-slate-800/90 border-sky-500/60'
                    : 'bg-[#060911] border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-slate-100">{item.step}</span>
                  <span className="font-mono text-[10px] text-sky-400 shrink-0">
                    点击定格 {item.badge} →
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">{item.desc}</p>
              </button>
            ))}
          </div>
        )}
        {activeTab === 'diagram' && (
          <>
            {/* Interactive 2D Free-Body Diagram with Reference Frame Switch */}
            <div className="bg-[#060911] border border-slate-800/90 rounded-lg p-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="grid grid-cols-2 gap-1 bg-slate-900 p-0.5 rounded-md border border-slate-800 flex-1">
                  <button
                    onClick={() => setFramePerspective('corotating')}
                    className={`py-1 px-2 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      framePerspective === 'corotating'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    随体系：离心力偶
                  </button>
                  <button
                    onClick={() => setFramePerspective('inertial')}
                    className={`py-1 px-2 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      framePerspective === 'inertial'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    惯性系：金属内力
                  </button>
                </div>
                <span className="font-mono tabular-nums text-[11px] text-amber-400 shrink-0">
                  M_内={currentState.junctionBendingMoment.toFixed(3)}N·m
                </span>
              </div>

              <svg
                viewBox="0 0 340 136"
                className="w-full h-30 select-none"
                role="img"
                aria-label="T形刚体垂直于转轴的离心力偶与金属向心拉力正反馈受力图"
              >
                {/* Horizontal Instantaneous Rotation Axis \omega & L */}
                <line
                  x1="14"
                  y1={cy}
                  x2="326"
                  y2={cy}
                  stroke="#06b6d4"
                  strokeWidth="1.3"
                  strokeDasharray="5 3"
                />
                <text x="246" y={cy - 7} fill="#06b6d4" fontSize="9.5" fontFamily="monospace">
                  瞬时转轴 ω (动量矩 L)
                </text>

                {/* Perpendicular radius drop-lines from crossbar tips to spin axis \omega */}
                <line
                  x1={topX}
                  y1={cy}
                  x2={topX}
                  y2={topY}
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <line
                  x1={botX}
                  y1={cy}
                  x2={botX}
                  y2={botY}
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />

                {/* Highlight non-collinear Moment Arm d = L_c * sin(\theta) along spin axis */}
                <line
                  x1={botX}
                  y1={cy}
                  x2={topX}
                  y2={cy}
                  stroke="#facc15"
                  strokeWidth="3"
                />
                <text
                  x="14"
                  y="128"
                  fill="#fde047"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  ━ 黄线段：两端力作用线错开力臂 d = L·sinθ
                </text>

                {/* Tilted T-Handle Geometry */}
                <g transform={`translate(${cx}, ${cy}) rotate(${visualTiltDeg})`}>
                  {/* Crossbar (along Z) */}
                  <rect
                    x="-8"
                    y="-38"
                    width="16"
                    height="76"
                    rx="3"
                    fill="#334155"
                    stroke="#94a3b8"
                    strokeWidth="1.3"
                  />
                  {/* +Z Orange marker */}
                  <rect x="-8" y="-38" width="16" height="12" rx="2" fill="#f97316" />
                  {/* -Z Cyan marker */}
                  <rect x="-8" y="26" width="16" height="12" rx="2" fill="#38bdf8" />
                  {/* Stem (along +X) */}
                  <rect
                    x="8"
                    y="-5.5"
                    width="58"
                    height="11"
                    rx="2.5"
                    fill="#475569"
                    stroke="#cbd5e1"
                    strokeWidth="1.3"
                  />
                  {/* COM dot */}
                  <circle cx="4" cy="0" r="3" fill="#facc15" />
                </g>

                {/* Force Arrows drawn in unrotated frame: STRICTLY VERTICAL (Perpendicular to horizontal spin axis \omega!) */}
                {framePerspective === 'corotating' ? (
                  <g>
                    {/* Upper crossbar Centrifugal Force: Strictly Vertical UP (away from \omega axis) */}
                    <line
                      x1={topX}
                      y1={topY}
                      x2={topX}
                      y2={topY - 24}
                      stroke="#f43f5e"
                      strokeWidth="2.4"
                    />
                    <polygon
                      points={`${topX},${topY - 29} ${topX - 4},${topY - 21} ${topX + 4},${topY - 21}`}
                      fill="#f43f5e"
                    />
                    <text
                      x="14"
                      y="18"
                      fill="#fda4af"
                      fontSize="9.5"
                      fontFamily="monospace"
                    >
                      ↑ F_cf(+Z) 垂直转轴向外
                    </text>

                    {/* Lower crossbar Centrifugal Force: Strictly Vertical DOWN (away from \omega axis) */}
                    <line
                      x1={botX}
                      y1={botY}
                      x2={botX}
                      y2={botY + 24}
                      stroke="#f43f5e"
                      strokeWidth="2.4"
                    />
                    <polygon
                      points={`${botX},${botY + 29} ${botX - 4},${botY + 21} ${botX + 4},${botY + 21}`}
                      fill="#f43f5e"
                    />
                    <text
                      x="195"
                      y="116"
                      fill="#fda4af"
                      fontSize="9.5"
                      fontFamily="monospace"
                    >
                      ↓ F_cf(-Z) 垂直转轴向外
                    </text>
                  </g>
                ) : (
                  <g>
                    {/* Inertial Frame: Real Internal Centripetal Tension pulling STRICTLY INWARD toward spin axis \omega */}
                    <line
                      x1={topX}
                      y1={topY}
                      x2={topX}
                      y2={cy - 5}
                      stroke="#f59e0b"
                      strokeWidth="2.4"
                    />
                    <polygon
                      points={`${topX},${cy - 1} ${topX - 4},${cy - 8} ${topX + 4},${cy - 8}`}
                      fill="#f59e0b"
                    />
                    <text
                      x="14"
                      y="18"
                      fill="#fcd34d"
                      fontSize="9.5"
                      fontFamily="monospace"
                    >
                      ↓ 金属向心拉力 F_内(+Z)
                    </text>

                    <line
                      x1={botX}
                      y1={botY}
                      x2={botX}
                      y2={cy + 5}
                      stroke="#f59e0b"
                      strokeWidth="2.4"
                    />
                    <polygon
                      points={`${botX},${cy + 1} ${botX - 4},${cy + 8} ${botX + 4},${cy + 8}`}
                      fill="#f59e0b"
                    />
                    <text
                      x="195"
                      y="116"
                      fill="#fcd34d"
                      fontSize="9.5"
                      fontFamily="monospace"
                    >
                      ↑ 金属向心拉力 F_内(-Z)
                    </text>
                  </g>
                )}
              </svg>

              <p className="text-[11px] text-slate-300 leading-snug pt-1.5 border-t border-slate-800/70">
                {framePerspective === 'corotating' ? (
                  <>
                    <strong className="text-rose-400">随体系视角：</strong>离心惯性力{' '}
                    <code className="text-slate-200">F_cf = m·ω²·r_⊥</code>{' '}
                    <strong>严格垂直于转轴 ω 向外</strong>。当横梁有微小倾角 θ 时，上下两个垂直向外的离心力错开了水平力臂{' '}
                    <code className="text-amber-300">d = L·sinθ</code>，形成不共线力偶把横梁越掰越歪！
                  </>
                ) : (
                  <>
                    <strong className="text-amber-400">惯性系真相（力从哪来？）：</strong>真空中<strong>没有任何外力</strong>！横梁两端质量块因<strong>牛顿第一定律（惯性）</strong>想沿切线飞出，金属横梁必须向转轴内侧提供<strong>真实弹性向心拉力 F_内</strong>。倾角 θ 使两端圆周轨道平面错开，两端对T形根部的反作用拉力产生内部弯矩 M_内 驱动翻转。
                  </>
                )}
              </p>
            </div>

            {/* Real-Time Euler Rigid-Body Equations Breakdown */}
            <div className="bg-[#060911] border border-slate-800/90 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  欧拉动力学方程 (无外力矩 τ_外 = 0)
                </span>
                <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                  I₃ &lt; I₁ (中轴) &lt; I₂
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px] tabular-nums">
                <div className="flex items-center justify-between py-1 px-2 bg-slate-900/90 rounded">
                  <span className="text-emerald-400">
                    dω₁/dt = [(I₂-I₃)/I₁]·ω₂ω₃
                  </span>
                  <span className="text-slate-100 font-semibold">
                    {alpha1 >= 0 ? `+${alpha1.toFixed(2)}` : alpha1.toFixed(2)} rad/s²
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 px-2 bg-slate-900/90 rounded">
                  <span className="text-sky-400">
                    dω₂/dt = [(I₃-I₁)/I₂]·ω₃ω₁
                  </span>
                  <span className="text-slate-100 font-semibold">
                    {alpha2 >= 0 ? `+${alpha2.toFixed(2)}` : alpha2.toFixed(2)} rad/s²
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 px-2 bg-slate-900/90 rounded">
                  <span className="text-orange-400">
                    dω₃/dt = [(I₁-I₂)/I₃]·ω₁ω₂
                  </span>
                  <span className="text-slate-100 font-semibold">
                    {alpha3 >= 0 ? `+${alpha3.toFixed(2)}` : alpha3.toFixed(2)} rad/s²
                  </span>
                </div>
              </div>
            </div>

            {/* Internal Structural Stress & Conservation Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#060911] border border-slate-800/90 rounded-lg p-2">
                <div className="text-[11px] text-slate-400">横梁根部轴向拉力</div>
                <div className="text-sm font-mono font-semibold text-rose-400 tabular-nums mt-0.5">
                  {currentState.crossbarTensionForce.toFixed(2)} N
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  金属内部真实向心内聚力
                </div>
              </div>
              <div className="bg-[#060911] border border-slate-800/90 rounded-lg p-2">
                <div className="text-[11px] text-slate-400">手柄杆部轴向拉力</div>
                <div className="text-sm font-mono font-semibold text-amber-400 tabular-nums mt-0.5">
                  {currentState.stemTensionForce.toFixed(2)} N
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  翻转瞬间达到峰值载荷
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'phase' && (
          <div className="space-y-3">
            <div className="bg-[#060911] border border-slate-800/90 rounded-lg p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span>随体角速度分量演化 ω(t) [rad/s]</span>
                <span className="font-mono tabular-nums text-slate-300">
                  帧 #{currentState.frame} · t = {currentState.time.toFixed(3)}s
                </span>
              </div>

              <canvas
                ref={chartCanvasRef}
                width={350}
                height={175}
                className="w-full h-44 rounded border border-slate-800/80"
              />

              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums pt-2.5">
                <span className="text-emerald-400">
                  ● ω₁(中轴): {w1.toFixed(2)}
                </span>
                <span className="text-sky-400">
                  ● ω₂(大轴): {w2.toFixed(2)}
                </span>
                <span className="text-orange-400">
                  ● ω₃(小轴): {w3.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Strict Physical Conservation Invariants Proof */}
            <div className="bg-[#060911] border border-slate-800/90 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                真空守恒量监测 (RK4 辛级精度验证)
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                <div className="p-2 bg-slate-900 rounded">
                  <div className="text-slate-400 text-[10px]">总动量矩 |L| (恒定)</div>
                  <div className="text-emerald-400 font-semibold mt-0.5">
                    {currentState.LMagnitude.toFixed(6)} N·m·s
                  </div>
                </div>
                <div className="p-2 bg-slate-900 rounded">
                  <div className="text-slate-400 text-[10px]">转动动能 E_rot (恒定)</div>
                  <div className="text-sky-400 font-semibold mt-0.5">
                    {currentState.kineticEnergy.toFixed(6)} J
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                <span>主惯量 I₁ = {(inertia.I1 * 1e4).toFixed(3)} kg·cm²</span>
                <span>·</span>
                <span>I₂ = {(inertia.I2 * 1e4).toFixed(3)}</span>
                <span>·</span>
                <span>I₃ = {(inertia.I3 * 1e4).toFixed(3)}</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'table' && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              以下为当前帧（第 <strong className="text-white font-mono">{currentState.frame}</strong> 帧）T形金属各质量微元的真实向心加速度、切向欧拉加速度及离心惯性力：
            </p>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left border-collapse font-mono text-[11px] tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400">
                    <th className="py-2 px-2.5">部位节点</th>
                    <th className="py-2 px-2 text-right">|v| m/s</th>
                    <th className="py-2 px-2 text-right">|F_离心| N</th>
                    <th className="py-2 px-2.5 text-right">|τ_力矩| N·m</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 bg-[#060911]">
                  {currentState.elementForces.map((ef) => {
                    const vMag = normVec3(ef.vWorld);
                    const fCfMag = normVec3(ef.fCentrifugalWorld);
                    const tauMag = normVec3(ef.torqueCentrifugalBody);
                    return (
                      <tr key={ef.id} className="hover:bg-slate-900/50">
                        <td className="py-2 px-2.5 font-sans text-slate-200">
                          {ef.label}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-300">
                          {vMag.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right text-rose-400 font-semibold">
                          {fCfMag.toFixed(2)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-amber-400">
                          {tauMag.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
              <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                三维视口中：<strong className="text-rose-400">红色箭头</strong>为微元所受表观离心惯性力{' '}
                <code className="text-slate-300">F_cf = -m·ω×(ω×r)</code>，
                <strong className="text-amber-400">金色箭头</strong>为金属内部提供的结构约束内力{' '}
                <code className="text-slate-300">F_struct = m·a</code>。
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
