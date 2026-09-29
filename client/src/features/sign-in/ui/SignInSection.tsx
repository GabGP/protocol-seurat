import { useState, type FormEvent } from 'react';
import type { Account } from '@/entities/session';
import { detailLabel, roleLabel } from '../lib/detail-label';
import { signIn, signOut, signedIn, type SignInResult } from '../model/sign-in';
import styles from './SignInSection.module.css';

const MESSAGES: Record<Exclude<SignInResult, 'ok'>, string> = {
  refused: 'That access key is not an account on this server.',
  offline: 'The server could not be reached. Try again.',
};

interface Props {
  /** Who the current session is (POST /sesion); null before the first session. */
  account: Account | null;
  /** The open work's ceiling for this viewer's role (ABIERTA), if a work is open. */
  ceiling: { stratum: number; bands: number } | null;
}

/** Account: sign in with an access key (seurat.conf `auth.accounts`) to raise the detail ceiling. */
export function SignInSection({ account, ceiling }: Props): JSX.Element {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const named = account ? account.name !== null : signedIn();

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await signIn(key);
    if (r !== 'ok') {
      setError(MESSAGES[r]);
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-label="Account">
      <span className={styles.sectionTitle}>Account</span>
      <span className={styles.status}>
        {account?.name ? <>Signed in as <strong>{account.name}</strong></> : named ? 'Signed in' : 'Not signed in'}
        {account && <span className={styles.role}>{roleLabel(account.role)}</span>}
      </span>
      {ceiling && <span className={styles.detail}>{detailLabel(ceiling.stratum, ceiling.bands)}</span>}
      {named ? (
        <button type="button" className={styles.button} onClick={() => signOut()}>
          Sign out
        </button>
      ) : (
        <form className={styles.form} onSubmit={(e) => void submit(e)}>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            placeholder="Access key"
            aria-label="Access key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className={styles.button} disabled={busy || !key.trim()}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      )}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </section>
  );
}
