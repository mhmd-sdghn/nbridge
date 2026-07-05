import type { SVGProps } from "react";

export function BridgeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Bridge DevTools Icon"
      {...props}
    >
      <title>Bridge DevTools</title>
      <defs>
        <linearGradient id="bridgeGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>

      {/* Bridge base */}
      <path d="M2 16 L22 16" stroke="url(#bridgeGold)" strokeWidth="2.5" />

      {/* Left tower */}
      <path
        d="M5 16 L5 8 M5 8 L7 8 L7 16"
        stroke="url(#bridgeGold)"
        strokeWidth="2"
      />

      {/* Right tower */}
      <path
        d="M17 16 L17 8 M17 8 L19 8 L19 16"
        stroke="url(#bridgeGold)"
        strokeWidth="2"
      />

      {/* Suspension cables */}
      <path
        d="M5 8 Q 12 4 19 8"
        stroke="url(#bridgeGold)"
        strokeWidth="1.5"
        fill="none"
      />

      {/* Vertical cables */}
      <path d="M8 16 L9 10" stroke="url(#bridgeGold)" strokeWidth="1" />
      <path d="M11 16 L12 6" stroke="url(#bridgeGold)" strokeWidth="1" />
      <path d="M14 16 L13 10" stroke="url(#bridgeGold)" strokeWidth="1" />

      {/* Connection data flow (animated dots) */}
      <circle cx="6" cy="12" r="1" fill="#fbbf24">
        <animate
          attributeName="cx"
          from="6"
          to="18"
          dur="2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
