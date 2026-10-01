package seurat.core.viewing.budget;

import seurat.core.shared.config.Units;

/** Token bucket: capacity bands, refill per second. */
final class TokenBucket {
    private final long capacity;
    private final double rate;
    private double balance;
    private long updatedNs;

    TokenBucket(long capacity, double rate) {
        this.capacity = capacity;
        this.rate = rate;
        this.balance = capacity;
        this.updatedNs = System.nanoTime();
    }

    private void refill() {
        long now = System.nanoTime();
        balance = Math.min(capacity, balance + (now - updatedNs) / (double) Units.NANOS_PER_S * rate);
        updatedNs = now;
    }

    synchronized double balance() {
        refill();
        return balance;
    }

    synchronized boolean take(long n) {
        refill();
        if (balance < n) {
            return false;
        }
        balance -= n;
        return true;
    }
}
