import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { Button, Field, Banner } from '../components/ui';
import Icon from '../components/Icon';
import { titleCase } from '../lib/format';

interface DemoUser { employee_id: string; name: string; role: string; designation: string | null; department: string | null }

export default function Login() {
  const { signIn, requestOtp, signInWithOtp } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState<{ target?: string; channel: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ password: string; data: DemoUser[] } | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    api.get<{ password: string; data: DemoUser[] }>('/auth/demo-users')
      .then(setDemo)
      .catch(() => setDemo(null));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'password') {
        await signIn(identifier.trim(), password);
      } else if (!otpSent) {
        const response = await requestOtp(identifier.trim());
        setOtpSent({ target: response.target, channel: response.channel });
        if (response.dev_otp) {
          setCode(response.dev_otp);
          toast.push(`Development OTP: ${response.dev_otp}`);
        }
      } else {
        await signInWithOtp(identifier.trim(), code.trim());
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__mark"><Icon name="train" size={26} /></div>
        <h1 style={{ fontSize: '1.2rem' }}>Inspection &amp; Compliance</h1>
        <p className="small muted" style={{ marginBottom: 18 }}>
          Passenger Amenities &middot; Commercial Inspection &middot; Safe Running - Commercial
        </p>

        {error && <div style={{ marginBottom: 12 }}><Banner tone="danger">{error}</Banner></div>}

        <Field label="Employee ID, email or mobile" htmlFor="identifier" required>
          <input
            id="identifier"
            className="input"
            autoComplete="username"
            autoCapitalize="characters"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. CMI01"
            required
          />
        </Field>

        {mode === 'password' ? (
          <Field label="Password" htmlFor="password" required>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        ) : otpSent ? (
          <Field
            label="One-time password"
            htmlFor="otp"
            hint={`Sent by ${otpSent.channel.toUpperCase()}${otpSent.target ? ` to ${otpSent.target}` : ''}`}
            required
          >
            <input
              id="otp"
              className="input mono-num"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              required
            />
          </Field>
        ) : (
          <p className="small muted" style={{ marginBottom: 14 }}>
            A one-time password will be sent to the mobile number registered against this employee ID.
          </p>
        )}

        <Button type="submit" block size="lg" loading={busy}>
          {mode === 'password' ? 'Sign in' : otpSent ? 'Verify OTP' : 'Send OTP'}
        </Button>

        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button
            type="button"
            className="chart__toggle"
            onClick={() => {
              setMode(mode === 'password' ? 'otp' : 'password');
              setOtpSent(null);
              setError(null);
            }}
          >
            {mode === 'password' ? 'Sign in with OTP instead' : 'Sign in with password instead'}
          </button>
        </div>

        {demo && demo.data.length > 0 && (
          <div className="login__demo">
            <button type="button" className="chart__toggle" style={{ marginLeft: 0 }} onClick={() => setShowDemo((v) => !v)}>
              {showDemo ? 'Hide' : 'Show'} demonstration accounts
            </button>
            {showDemo && (
              <div style={{ marginTop: 10 }}>
                <p className="xsmall muted" style={{ marginBottom: 8 }}>
                  Every account uses the password <code>{demo.password}</code>. Tap one to fill the form.
                </p>
                {demo.data.slice(0, 8).map((u) => (
                  <button
                    key={u.employee_id}
                    type="button"
                    className="login__demo-row"
                    onClick={() => {
                      setMode('password');
                      setIdentifier(u.employee_id);
                      setPassword(demo.password);
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="small strong truncate" style={{ display: 'block' }}>{u.name}</span>
                      <span className="xsmall muted truncate" style={{ display: 'block' }}>
                        {u.employee_id} &middot; {u.designation ?? titleCase(u.role)}
                      </span>
                    </span>
                    <span className="badge badge--outline">{titleCase(u.role)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
