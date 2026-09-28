package seurat.session;

import java.util.TreeMap;
import java.util.function.Predicate;
import seurat.codec.BrushId;
import seurat.proto.Ranges;

/**
 * Authoritative loan model for one canvas. Touched by its Easel and the Painter
 * under the canvas lock. Survives L+delta past disconnect (resume). Bands are
 * counted per edition: after the ed1 -> ed2 swap the sketch is owed again.
 */
public final class LoanBook {
    private final TreeMap<Long, Delivery> deliveries = new TreeMap<>();
    private final BrushHoldings holdings = new BrushHoldings();
    private final LoanLeases leases = new LoanLeases();
    private long last;
    private long edition;

    public synchronized long lastNumber() { return last; }

    public synchronized int size() { return deliveries.size(); }

    /** Edition new deliveries are stamped with and bands() counts. */
    public synchronized void edition(long value) { edition = value; }

    /** Bands held contiguously from 0 in the current edition; seed: all or none. */
    public synchronized int bands(BrushId p) {
        return holdings.bands(p, edition);
    }

    /** Numbers BEFORE opening the flow. */
    public synchronized Delivery log(BrushId p, int from, int through, int bytes, long epoch) {
        Delivery e = new Delivery(++last, p, from, through, bytes, epoch, edition);
        deliveries.put(e.number(), e);
        holdings.put(e);
        return e;
    }

    /** Corrupt band on disk (spec 8): the delivery shrinks to its valid prefix before its header goes out. */
    public synchronized Delivery shrink(long n, int through, int bytes) {
        Delivery e = deliveries.get(n);
        if (e == null) {
            return null;
        }
        Delivery s = new Delivery(n, e.brush(), e.from(), through, bytes, e.epoch(), e.edition());
        deliveries.put(n, s);
        holdings.put(s);
        return s;
    }

    public synchronized Delivery get(long n) { return deliveries.get(n); }

    public synchronized boolean contains(long n) { return deliveries.containsKey(n); }

    public synchronized boolean holds(long ed) { return deliveries.values().stream().anyMatch(d -> d.edition() == ed); }

    public synchronized void acknowledge(Ranges r, long nowNs, long leaseNs, long deltaNs) { leases.acknowledge(r, nowNs, leaseNs, deltaNs); }

    /** Client confirmed synthesis via RECIBO: safe to audit through it. */
    public synchronized void settle(Ranges r) { leases.settle(r); }

    /** Highest N such that every book entry <= N is RECIBO-confirmed: audits never count unsettled numbers. */
    public synchronized long settledThrough() {
        for (long n : deliveries.keySet()) {
            if (!leases.isSettled(n)) {
                return n - 1;
            }
        }
        return last;
    }

    /** Deliveries RECIBO has not confirmed yet (in flight or unsynthesized): receiver-window load. */
    public synchronized int unsettled() {
        return (int) deliveries.keySet().stream().filter(n -> !leases.isSettled(n)).count();
    }

    /** Session died: unacked grants expire at deadline (spec 8, t_desconexion + L + delta). */
    public synchronized void expireUnacked(long deadlineNs) { leases.expireUnacked(deliveries.keySet(), deadlineNs); }

    /** Session died with these renewed but unacknowledged: vence = t_desconexion + L + delta (spec 8). */
    public synchronized void expireRenewed(Ranges r, long deadlineNs) {
        leases.extend(r, deliveries.keySet(), deadlineNs);
    }

    public synchronized Ranges pruneExpired(long nowNs) {
        Ranges.Builder expired = new Ranges.Builder();
        leases.expired(nowNs, expired::add);
        Ranges out = expired.build();
        out.forEach(this::remove);
        return out;
    }

    public synchronized void release(Ranges r) { r.forEach(this::remove); }

    public synchronized void cancel(long n) { remove(n); }

    /** Numbers of the entries matching keep (renewals: only what is still permitted). */
    public synchronized Ranges select(Predicate<Delivery> keep) {
        Ranges.Builder c = new Ranges.Builder();
        deliveries.values().stream().filter(keep).forEach(e -> c.add(e.number()));
        return c.build();
    }

    /** Book ∩ [1,through] minus the scraped ones minus cancelled: what the client must keep. */
    public synchronized Ranges expected(long through, Predicate<Delivery> scrape, Ranges cancelled) {
        return select(e -> e.number() <= through && !scrape.test(e) && !cancelled.contains(e.number()));
    }

    public synchronized Ranges numbersThrough(long through) { return select(e -> e.number() <= through); }

    public synchronized void retainOnly(long through, Ranges keep) {
        numbersThrough(through).forEach(n -> {
            if (!keep.contains(n)) {
                remove(n);
            }
        });
    }

    private void remove(long n) {
        Delivery e = deliveries.remove(n);
        if (e == null) {
            return;
        }
        leases.forget(n);
        holdings.remove(e);
    }
}
