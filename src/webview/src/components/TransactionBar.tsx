import { useState, useEffect, useRef } from 'react';
import { useVscodeApi } from '../hooks/useVscodeApi';
import { toast } from './Toast';

interface TransactionBarProps {
  connectionId: string;
  onTransactionEnd?: () => void;
}

export function TransactionBar({ connectionId, onTransactionEnd }: TransactionBarProps) {
  const vscode = useVscodeApi();
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed time timer
  useEffect(() => {
    if (isActive && startTime) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, startTime]);

  const formatElapsed = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const beginTransaction = async () => {
    setLoading(true);
    try {
      const response = await vscode.postMessage({
        type: 'BEGIN_TRANSACTION',
        id: crypto.randomUUID(),
        payload: { connectionId }
      });
      if (response.success) {
        setIsActive(true);
        setStartTime(Date.now());
        setElapsed(0);
        toast.info('Transaction', 'Transaction started');
      } else {
        toast.error('Transaction Error', response.error || 'Failed to begin transaction');
      }
    } catch (err) {
      toast.error('Transaction Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const commitTransaction = async () => {
    setLoading(true);
    try {
      const response = await vscode.postMessage({
        type: 'COMMIT_TRANSACTION',
        id: crypto.randomUUID(),
        payload: { connectionId }
      });
      if (response.success) {
        setIsActive(false);
        setStartTime(null);
        if (timerRef.current) clearInterval(timerRef.current);
        toast.success('Transaction', `Transaction committed (${formatElapsed(elapsed)})`);
        onTransactionEnd?.();
      } else {
        toast.error('Commit Error', response.error || 'Failed to commit');
      }
    } catch (err) {
      toast.error('Commit Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const rollbackTransaction = async () => {
    setLoading(true);
    try {
      const response = await vscode.postMessage({
        type: 'ROLLBACK_TRANSACTION',
        id: crypto.randomUUID(),
        payload: { connectionId }
      });
      if (response.success) {
        setIsActive(false);
        setStartTime(null);
        if (timerRef.current) clearInterval(timerRef.current);
        toast.warning('Transaction', 'Transaction rolled back');
        onTransactionEnd?.();
      } else {
        toast.error('Rollback Error', response.error || 'Failed to rollback');
      }
    } catch (err) {
      toast.error('Rollback Error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isActive) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        onClick={beginTransaction}
        disabled={loading}
        title="Start a database transaction"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M12 6v6l4 2" />
        </svg>
        Begin Transaction
      </button>
    );
  }

  return (
    <div className="transaction-bar">
      <div className="transaction-indicator">
        <span className="transaction-dot" />
        <span>Transaction Active</span>
        <span style={{ color: elapsed >= 60 ? 'var(--error-text)' : 'var(--text-tertiary)', fontWeight: 500, fontSize: 11 }}>
          {formatElapsed(elapsed)}
        </span>
        {elapsed >= 60 && (
          <span className="badge badge-warning" style={{ fontSize: 9 }}>Long running</span>
        )}
      </div>
      <button
        className="btn btn-sm"
        onClick={commitTransaction}
        disabled={loading}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Commit
      </button>
      <button
        className="btn btn-danger btn-sm"
        onClick={rollbackTransaction}
        disabled={loading}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
        Rollback
      </button>
    </div>
  );
}
