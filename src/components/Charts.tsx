function path(data: number[], w: number, h: number, pad = 2) {
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const step = (w - pad * 2) / (data.length - 1);
  return data.map((d, i) => {
    const x = pad + i * step;
    const y = h - pad - ((d - min) / rng) * (h - pad * 2);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function Sparkline({ data, color = "#ef4444", w = 90, h = 32 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const id = "sg" + color.replace("#", "");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="b4y-chart overflow-visible">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.35" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={`${path(data, w, h)} L${w - 2},${h} L2,${h} Z`} fill={`url(#${id})`} />
      <path d={path(data, w, h)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AreaChart({ data, color = "#ef4444", h = 120 }: { data: number[]; color?: string; h?: number }) {
  const w = 520;
  const id = "ag" + color.replace("#", "");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="b4y-chart overflow-visible">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.4" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={`${path(data, w, h, 6)} L${w - 6},${h} L6,${h} Z`} fill={`url(#${id})`} />
      <path d={path(data, w, h, 6)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Ring({ value, size = 52, stroke = 5, color = "#ef4444" }: { value: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  return (
    <svg width={size} height={size} className="b4y-chart -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200 dark:text-white/10" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 1s cubic-bezier(.21,1,.21,1)" }} />
    </svg>
  );
}
