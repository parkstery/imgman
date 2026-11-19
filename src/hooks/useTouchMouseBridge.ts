import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface TouchPinchGesture {
  /** Incremental scale since the previous pinch move (currentDistance / previousDistance). */
  scale: number;
  /** Incremental movement of the two-finger midpoint since the previous move. */
  dx: number;
  dy: number;
  /** Current two-finger midpoint in client coordinates. */
  centerX: number;
  centerY: number;
}

export interface UseTouchMouseBridgeOptions {
  onPinch?: (gesture: TouchPinchGesture) => void;
  onPinchStart?: () => void;
}

/** A touch that moves less than this (screen px) still counts as a tap. */
const TAP_MAX_MOVE_PX = 10;
/** Maximum delay between two taps that should produce a dblclick. */
const DOUBLE_TAP_MAX_MS = 350;
/** Maximum distance between two tap points that should produce a dblclick. */
const DOUBLE_TAP_MAX_DISTANCE_PX = 30;

/** Controls that keep their own native touch handling (keyboard, click, selection). */
const NATIVE_TOUCH_SELECTOR =
  'button, a, input, select, textarea, label, [contenteditable="true"], [data-touch-native]';

type BridgeMode = 'idle' | 'single' | 'pinch' | 'wait' | 'blocked';

interface TouchPoint {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

interface GestureState {
  mode: BridgeMode;
  /** Element the single-finger gesture started on. */
  target: EventTarget | null;
  /** Identifier of the finger driving the single-finger gesture. */
  touchId: number | null;
  startClientX: number;
  startClientY: number;
  lastPoint: TouchPoint | null;
  /** Largest distance from the touchstart point, used for tap slop. */
  maxDistance: number;
  /** True when this tap started within the double-tap window of the previous tap. */
  doubleTapCandidate: boolean;
  /** Previous two-finger distance/midpoint, used for incremental pinch values. */
  pinchDistance: number;
  pinchMidX: number;
  pinchMidY: number;
}

interface TapRecord {
  time: number;
  clientX: number;
  clientY: number;
}

interface PinchGeometry {
  distance: number;
  midX: number;
  midY: number;
}

function sampleTouch(touch: Touch): TouchPoint {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    screenX: touch.screenX,
    screenY: touch.screenY,
  };
}

function findTouch(touches: TouchList, identifier: number | null): Touch | null {
  if (identifier == null) return null;
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i];
    if (touch && touch.identifier === identifier) return touch;
  }
  return null;
}

function pinchGeometry(touches: TouchList): PinchGeometry | null {
  if (touches.length < 2) return null;
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return null;
  return {
    distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    midX: (a.clientX + b.clientX) / 2,
    midY: (a.clientY + b.clientY) / 2,
  };
}

function isNativeTouchTarget(target: EventTarget | null, container: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(NATIVE_TOUCH_SELECTOR);
  return !!control && container.contains(control);
}

/** The touch target can disappear during a React re-render; fall back to the container. */
function resolveDispatchTarget(target: EventTarget | null, container: HTMLElement): EventTarget {
  return target instanceof Node && target.isConnected ? target : container;
}

function dispatchMouseEvent(
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'click' | 'dblclick',
  target: EventTarget,
  point: TouchPoint,
  buttons: number,
  detail = 0
): void {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point.clientX,
      clientY: point.clientY,
      screenX: point.screenX,
      screenY: point.screenY,
      button: 0,
      buttons,
      detail,
    })
  );
}

/**
 * Bridges touch gestures on a canvas container to the mouse events its
 * hand-written interaction code already understands.
 *
 * A single finger emits mousedown/mousemove/mouseup (plus click/dblclick for
 * taps) on the original touchstart target, so child handlers and window-level
 * listeners keep working. Two fingers emit incremental pinch data instead.
 */
export function useTouchMouseBridge(
  ref: RefObject<HTMLElement | null>,
  opts: UseTouchMouseBridgeOptions
): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const gestureRef = useRef<GestureState>({
    mode: 'idle',
    target: null,
    touchId: null,
    startClientX: 0,
    startClientY: 0,
    lastPoint: null,
    maxDistance: 0,
    doubleTapCandidate: false,
    pinchDistance: 0,
    pinchMidX: 0,
    pinchMidY: 0,
  });
  const lastTapRef = useRef<TapRecord | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const state = gestureRef.current;

    const resetGesture = () => {
      state.mode = 'idle';
      state.target = null;
      state.touchId = null;
      state.lastPoint = null;
      state.maxDistance = 0;
      state.doubleTapCandidate = false;
      state.pinchDistance = 0;
      state.pinchMidX = 0;
      state.pinchMidY = 0;
    };

    const refreshPinchReference = (touches: TouchList) => {
      const geometry = pinchGeometry(touches);
      if (!geometry) return;
      state.pinchDistance = geometry.distance;
      state.pinchMidX = geometry.midX;
      state.pinchMidY = geometry.midY;
    };

    const finishSingle = (cancelled: boolean) => {
      const point = state.lastPoint;
      const target = resolveDispatchTarget(state.target, node);
      const detail = state.doubleTapCandidate ? 2 : 1;

      if (point) {
        dispatchMouseEvent('mouseup', target, point, 0, detail);
      }

      if (!cancelled && point && state.maxDistance < TAP_MAX_MOVE_PX) {
        dispatchMouseEvent('click', resolveDispatchTarget(state.target, node), point, 0, detail);

        if (state.doubleTapCandidate) {
          dispatchMouseEvent('dblclick', resolveDispatchTarget(state.target, node), point, 0, 2);
          lastTapRef.current = null;
        } else {
          lastTapRef.current = {
            time: Date.now(),
            clientX: point.clientX,
            clientY: point.clientY,
          };
        }
      } else if (cancelled || state.maxDistance >= TAP_MAX_MOVE_PX) {
        lastTapRef.current = null;
      }

      resetGesture();
    };

    const startPinch = (event: TouchEvent) => {
      // A second finger must not leave the single-finger handlers mid-drag.
      if (state.mode === 'single') finishSingle(true);

      state.mode = 'pinch';
      state.target = null;
      state.touchId = null;
      state.lastPoint = null;
      state.maxDistance = 0;
      state.doubleTapCandidate = false;
      refreshPinchReference(event.touches);
      optsRef.current.onPinchStart?.();
    };

    const onTouchStart = (event: TouchEvent) => {
      if (state.mode === 'blocked') return;

      // Buttons, inputs, the inline text editor, etc. keep native behavior.
      if (isNativeTouchTarget(event.target, node)) {
        if (state.mode === 'single') finishSingle(true);
        resetGesture();
        lastTapRef.current = null;
        state.mode = 'blocked';
        return;
      }

      // A multi-touch sequence stays multi-touch until every finger lifts.
      if (state.mode === 'pinch' || state.mode === 'wait') return;

      if (state.mode === 'single') {
        if (event.touches.length >= 2) startPinch(event);
        return;
      }

      if (event.touches.length >= 2) {
        startPinch(event);
        return;
      }
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];
      if (!touch) return;
      const point = sampleTouch(touch);
      const previousTap = lastTapRef.current;
      state.mode = 'single';
      state.target = event.target;
      state.touchId = touch.identifier;
      state.startClientX = touch.clientX;
      state.startClientY = touch.clientY;
      state.lastPoint = point;
      state.maxDistance = 0;
      state.doubleTapCandidate =
        !!previousTap &&
        Date.now() - previousTap.time <= DOUBLE_TAP_MAX_MS &&
        Math.hypot(
          point.clientX - previousTap.clientX,
          point.clientY - previousTap.clientY
        ) <= DOUBLE_TAP_MAX_DISTANCE_PX;
      dispatchMouseEvent(
        'mousedown',
        resolveDispatchTarget(state.target, node),
        point,
        1,
        state.doubleTapCandidate ? 2 : 1
      );
    };

    const onTouchMove = (event: TouchEvent) => {
      if (state.mode === 'idle' || state.mode === 'blocked') return;

      if (state.mode === 'pinch') {
        if (event.cancelable) event.preventDefault();

        const geometry = pinchGeometry(event.touches);
        if (!geometry) return;

        const scale =
          state.pinchDistance > 0 ? geometry.distance / state.pinchDistance : 1;
        const dx = geometry.midX - state.pinchMidX;
        const dy = geometry.midY - state.pinchMidY;

        state.pinchDistance = geometry.distance;
        state.pinchMidX = geometry.midX;
        state.pinchMidY = geometry.midY;

        optsRef.current.onPinch?.({
          scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
          dx,
          dy,
          centerX: geometry.midX,
          centerY: geometry.midY,
        });
        return;
      }

      // One finger left from a pinch: keep the page still, but do not draw.
      if (state.mode === 'wait') {
        if (event.cancelable) event.preventDefault();
        return;
      }

      if (event.cancelable) event.preventDefault();

      const touch = findTouch(event.touches, state.touchId);
      if (!touch) return;

      const point = sampleTouch(touch);
      state.lastPoint = point;
      const distance = Math.hypot(
        point.clientX - state.startClientX,
        point.clientY - state.startClientY
      );
      if (distance > state.maxDistance) state.maxDistance = distance;

      dispatchMouseEvent(
        'mousemove',
        resolveDispatchTarget(state.target, node),
        point,
        1
      );
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (state.mode === 'blocked') {
        if (event.touches.length === 0) resetGesture();
        return;
      }
      if (state.mode === 'idle') return;

      if (state.mode === 'pinch') {
        if (event.cancelable) event.preventDefault();

        if (event.touches.length >= 2) {
          refreshPinchReference(event.touches);
        } else if (event.touches.length === 1) {
          // Do not turn the remaining finger into a new drawing gesture.
          state.mode = 'wait';
          state.target = null;
          state.touchId = null;
          state.lastPoint = null;
        } else {
          resetGesture();
        }
        return;
      }

      if (state.mode === 'wait') {
        if (event.cancelable) event.preventDefault();
        if (event.touches.length === 0) resetGesture();
        return;
      }

      // Single-finger gesture.
      if (event.cancelable) event.preventDefault();

      // Another finger ended while ours is still down: keep the gesture alive.
      if (findTouch(event.touches, state.touchId)) return;

      finishSingle(false);

      if (event.touches.length > 0) {
        // All fingers must lift before a new single-finger bridge can start.
        state.mode = 'wait';
        state.target = null;
        state.touchId = null;
        state.lastPoint = null;
      }
    };

    const onTouchCancel = (event: TouchEvent) => {
      if (state.mode === 'single') {
        if (!findTouch(event.touches, state.touchId)) finishSingle(true);
        return;
      }

      if (event.touches.length === 0) {
        resetGesture();
        return;
      }

      if (state.mode === 'pinch') {
        state.mode = 'wait';
        state.target = null;
        state.touchId = null;
        state.lastPoint = null;
      }
    };

    node.addEventListener('touchstart', onTouchStart, { passive: false });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: false });
    node.addEventListener('touchcancel', onTouchCancel, { passive: false });

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [ref]);
}
