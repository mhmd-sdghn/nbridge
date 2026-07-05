"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { BridgeIcon } from "./BridgeIcon";

interface Position {
  x: number;
  y: number;
}

interface DevToolsTriggerProps {
  isOpen: boolean;
  onToggle: () => void;
}

const STORAGE_KEY = "bridge-devtools-position";
const DEFAULT_POSITION: Position = { x: 20, y: 20 };

export function DevToolsTrigger({ isOpen, onToggle }: DevToolsTriggerProps) {
  const [position, setPosition] = useState<Position>(() => {
    if (typeof window === "undefined") return DEFAULT_POSITION;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_POSITION;
    } catch {
      return DEFAULT_POSITION;
    }
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX - position.x,
      mouseY: e.clientY - position.y,
    };

    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    if (!touch) return;

    setIsDragging(true);
    dragStartRef.current = {
      mouseX: touch.clientX - position.x,
      mouseY: touch.clientY - position.y,
    };
  };

  useEffect(() => {
    if (!isDragging || !dragStartRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const newX = Math.max(
        0,
        Math.min(
          window.innerWidth - 56,
          e.clientX - dragStartRef.current.mouseX,
        ),
      );
      const newY = Math.max(
        0,
        Math.min(
          window.innerHeight - 56,
          e.clientY - dragStartRef.current.mouseY,
        ),
      );

      setPosition({ x: newX, y: newY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragStartRef.current || e.touches.length !== 1) return;

      const touch = e.touches[0];
      if (!touch) return;
      const newX = Math.max(
        0,
        Math.min(
          window.innerWidth - 56,
          touch.clientX - dragStartRef.current.mouseX,
        ),
      );
      const newY = Math.max(
        0,
        Math.min(
          window.innerHeight - 56,
          touch.clientY - dragStartRef.current.mouseY,
        ),
      );

      setPosition({ x: newX, y: newY });
    };

    const handleEnd = () => {
      setIsDragging(false);
      dragStartRef.current = null;

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
      } catch {
        // Ignore localStorage errors
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleEnd, { passive: false });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, position]);

  const handleClick = () => {
    if (!isDragging) {
      onToggle();
    }
  };

  return (
    <button
      type="button"
      className={`
        fixed z-[9999] h-14 w-14 rounded-full
        bg-blue-600 text-white shadow-lg
        transition-all duration-200
        hover:bg-blue-700 hover:scale-105
        active:scale-95
        flex items-center justify-center
        ${isDragging ? "opacity-80 cursor-grabbing" : "cursor-grab"}
        ${isOpen ? "ring-4 ring-blue-400/50" : ""}
      `}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onClick={handleClick}
      aria-label="Open Bridge DevTools"
      title="Bridge DevTools (Ctrl+Shift+B)"
    >
      <BridgeIcon className="h-7 w-7" />
    </button>
  );
}
