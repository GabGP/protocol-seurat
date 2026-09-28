package seurat.session;

import seurat.config.Units;

/**
 * Per-session byte rate (spec 6.1, e.g. 25 MB/s): a token bucket one second deep that
 * may go into debt by one delivery; nothing new opens while it is in debt.
 */
public final class SessionRate {
    private final double bytesPerS;
    private double balance;
    private long updatedNs = System.nanoTime();

    public SessionRate(long bytesPerS) {
        this.bytesPerS = bytesPerS;
        this.balance = bytesPerS;
    }

    private void refill() {
        long now = System.nanoTime();
        balance = Math.min(bytesPerS, balance + (now - updatedNs) / (double) Units.NANOS_PER_S * bytesPerS);
        updatedNs = now;
    }

    public synchronized boolean ready() {
        if (bytesPerS <= 0) {
            return true;
        }
        refill();
        return balance > 0;
    }

    public synchronized void spend(long bytes) {
        if (bytesPerS > 0) {
            refill();
            balance -= bytes;
        }
    }
}
