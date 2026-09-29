package seurat.session;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.LongConsumer;
import seurat.proto.Ranges;

/**
 * Lease side of a LoanBook (spec 8): vence_srv per acknowledged delivery and the
 * RECIBO-settled set. Not thread-safe: only LoanBook calls it, under its own lock.
 */
final class LoanLeases {
    private final Map<Long, Long> deadlineNs = new HashMap<>();
    private final Set<Long> settled = new HashSet<>();

    /** vence_srv = t_acuse + L + delta. */
    void acknowledge(Ranges r, Set<Long> held, long nowNs, long leaseNs, long deltaNs) {
        r.forEach(n -> {
            if (held.contains(n)) {
                deadlineNs.put(n, nowNs + leaseNs + deltaNs);
            }
        });
    }

    /** Only numbers the book holds are recorded: a stale or invented number would never be forgotten. */
    void settle(Ranges r, Set<Long> held) {
        r.forEach(n -> {
            if (held.contains(n)) {
                settled.add(n);
            }
        });
    }

    boolean isSettled(long n) {
        return settled.contains(n);
    }

    /** Disconnect: what was granted without an ack expires at t_desconexion + L + delta. */
    void expireUnacked(Iterable<Long> numbers, long deadline) {
        for (long n : numbers) {
            deadlineNs.putIfAbsent(n, deadline);
        }
    }

    /** Disconnect with a RENOVAR unacknowledged: the client may hold these until the deadline too. */
    void extend(Ranges r, Set<Long> held, long deadline) {
        r.forEach(n -> {
            if (held.contains(n)) {
                deadlineNs.merge(n, deadline, Math::max);
            }
        });
    }

    void expired(long nowNs, LongConsumer out) {
        for (var e : Map.copyOf(deadlineNs).entrySet()) {
            if (e.getValue() < nowNs) {
                out.accept(e.getKey());
            }
        }
    }

    void forget(long n) {
        deadlineNs.remove(n);
        settled.remove(n);
    }
}
