import { useState, FormEvent } from "react";
import { requestCode, submitCode, WrongCodeError, Session } from "../auth";

export function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeSession, setChallengeSession] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await requestCode(email.trim());
      setChallengeSession(session);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await submitCode(email.trim(), code.trim(), challengeSession);
      onLogin(session);
    } catch (err) {
      if (err instanceof WrongCodeError) {
        setChallengeSession(err.nextChallengeSession);
        setError("That code didn't match — try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card">
      <h1>Swordthain</h1>
      {step === "email" ? (
        <form onSubmit={handleRequestCode}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmitCode}>
          <p>Enter the 6-digit code sent to {email}.</p>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button type="button" className="link" onClick={() => setStep("email")}>
            Use a different email
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
