import { useEffect, useState, type ReactNode } from 'react';

export function GitIdentityOnboarding({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/dashboard/api/git-identity')
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'Could not check your Git identity. Please refresh to retry.',
          );
        const identity = await response.json();
        if (!active) return;
        setReady(identity.configured === true);
        if (identity.configured) {
          setName(identity.name);
          setEmail(identity.email);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (ready) return <>{children}</>;
  return (
    <div className="dark fixed inset-0 flex items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <img
          src="/alohak-logo.png"
          alt="Alohak"
          className="mx-auto mb-5 h-36 w-36 rounded-xl object-contain"
        />
        <h1 className="text-2xl font-semibold">Welcome to Alohak</h1>
        {loading ? (
          <p className="mt-4">Checking your Git identity…</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-neutral-400">
              Set your name and email before getting started. Alohak uses this
              identity for Git commits in this instance.
            </p>
            <button
              disabled={busy}
              className="mt-4 rounded border border-neutral-600 px-4 py-2 disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const response = await fetch(
                    '/dashboard/api/git-identity/github',
                  );
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  setName(result.name);
                  setEmail(result.email);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not load GitHub identity.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use connected GitHub profile
            </button>
            <form
              className="mt-5 space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const response = await fetch('/dashboard/api/git-identity', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email }),
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  setReady(result.configured === true);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not save Git identity.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block">
                Git name
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 block w-full rounded border border-neutral-600 bg-neutral-950 p-2"
                />
              </label>
              <label className="block">
                Git email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 block w-full rounded border border-neutral-600 bg-neutral-950 p-2"
                />
              </label>
              <button
                disabled={busy || !name.trim() || !email.trim()}
                className="w-full rounded bg-primary-500 px-4 py-2 font-semibold disabled:opacity-50"
              >
                Save identity and continue
              </button>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
