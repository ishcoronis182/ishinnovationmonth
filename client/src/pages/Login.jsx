// The passcode gate.

import React, { useState } from 'react';
import { api, ApiError } from '../api.js';
import { Wordmark, Button, Field, Callout } from '../components/ui.jsx';

export default function LoginPage({ onSignedIn }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event?.preventDefault?.();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(passcode);
      if (result.authEnabled === false) {
        onSignedIn?.();
        return;
      }
      setPasscode('');
      onSignedIn?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <Wordmark ink to="/login" />
        <p className="muted small" style={{ margin: 0 }}>
          One deal record from referral to comms. Sign in to open the register.
        </p>
        <Field label="Passcode" id="login-passcode">
          <input
            id="login-passcode"
            type="password"
            value={passcode}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPasscode(e.target.value)}
          />
        </Field>
        {error ? <Callout tone="red"><span>{error}</span></Callout> : null}
        <Button variant="primary" block onClick={submit} disabled={busy || !passcode}>
          {busy ? 'Checking...' : 'Sign in'}
        </Button>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Sign in</button>
      </form>
    </div>
  );
}
