import { useEffect, useRef, useState } from "react";

const IDLE_TIMEOUT_MINUTES = 30;
const WARNING_BEFORE_MINUTES = 2;
const WARNING_AT_MS = (IDLE_TIMEOUT_MINUTES - WARNING_BEFORE_MINUTES) * 60_000;
const SIGN_OUT_AFTER_WARNING_MS = WARNING_BEFORE_MINUTES * 60_000;

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

/**
 * Signs out after IDLE_TIMEOUT_MINUTES of no activity, showing a warning
 * WARNING_BEFORE_MINUTES beforehand. Once the warning is showing, only the
 * explicit `stayActive` call (the "Stay signed in" button) dismisses it —
 * ambient mouse movement while reading it shouldn't silently reset the clock.
 */
export function useIdleTimeout(active: boolean, onTimeout: () => void) {
  const [showWarning, setShowWarning] = useState(false);
  const showWarningRef = useRef(false);
  const warningTimer = useRef<ReturnType<typeof setTimeout>>();
  const signOutTimer = useRef<ReturnType<typeof setTimeout>>();

  function setWarning(value: boolean) {
    showWarningRef.current = value;
    setShowWarning(value);
  }

  function startCycle() {
    setWarning(false);
    clearTimeout(warningTimer.current);
    clearTimeout(signOutTimer.current);
    warningTimer.current = setTimeout(() => {
      setWarning(true);
      signOutTimer.current = setTimeout(onTimeout, SIGN_OUT_AFTER_WARNING_MS);
    }, WARNING_AT_MS);
  }

  useEffect(() => {
    if (!active) return;

    function handleActivity() {
      if (showWarningRef.current) return;
      startCycle();
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handleActivity));
    startCycle();

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handleActivity));
      clearTimeout(warningTimer.current);
      clearTimeout(signOutTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { showWarning, stayActive: startCycle };
}
