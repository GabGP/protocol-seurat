package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ADR-07 rules 3 and 4: the capacity (room, bytes per second) is handed out by sharpness, coarsest
 * tier first. A tier that fits is granted to everyone. In the first tier that does not fit, whole
 * demands are admitted in rank order while they fit (first fit), the others are cut at that tier,
 * and the filling stops: nobody gets finer points while another still waits for coarser ones.
 * A partial share is never granted: a cut plan drops the whole tier, so it would go unused.
 */
public final class Allotment {
    /** Tier t is plan pass t + 1 (core, core refinement, rings). */
    public static final int TIERS = 3;

    private Allotment() {}

    /**
     * An allotment grant for a session.
     *
     * @param tier how many tiers were granted whole (3 all, 2 tiers 1-2, 1 tier 1, 0 tier 1 only partly),
     *             which is also the rung
     * @param bytes what was allotted, bytes per second, or {@link CapacityMeter#UNBOUNDED}
     */
    public record Grant(int tier, long bytes) {}

    /** Admission order inside the tier that does not fit: the lowest rank goes first. */
    public interface Rank<K> {
        double of(K key, int tier, long wanted);
    }

    /** Grants per key; demand and room are bytes per second, room may be UNBOUNDED. */
    public static <K> Map<K, Grant> fill(Map<K, long[]> demand, long room, Rank<K> rank) {
        if (room == CapacityMeter.UNBOUNDED) {
            Map<K, Grant> out = new HashMap<>();
            for (K k : demand.keySet()) {
                out.put(k, new Grant(TIERS, CapacityMeter.UNBOUNDED));
            }
            return out;
        }
        long left = room;
        Map<K, Long> given = new HashMap<>();
        for (K k : demand.keySet()) {
            given.put(k, 0L);
        }
        for (int t = 0; t < TIERS; t++) {
            long sum = 0;
            for (long[] d : demand.values()) {
                sum += d[t];
            }
            if (sum <= left) {
                for (Map.Entry<K, long[]> entry : demand.entrySet()) {
                    given.put(entry.getKey(), given.get(entry.getKey()) + entry.getValue()[t]);
                }
                left -= sum;
                continue;
            }
            List<K> active = new ArrayList<>();
            for (Map.Entry<K, long[]> entry : demand.entrySet()) {
                if (entry.getValue()[t] > 0) {
                    active.add(entry.getKey());
                }
            }
            final int tier = t;
            active.sort(Comparator.comparingDouble(k -> rank.of(k, tier, demand.get(k)[tier])));
            Map<K, Grant> out = new HashMap<>();
            for (K k : active) {
                long wanted = demand.get(k)[t];
                boolean fits = wanted <= left;
                if (fits) {
                    left -= wanted;
                    given.merge(k, wanted, Long::sum);
                }
                out.put(k, new Grant(fits ? t + 1 : t, given.get(k)));
            }
            for (Map.Entry<K, long[]> entry : demand.entrySet()) {
                if (entry.getValue()[t] == 0) {
                    out.put(entry.getKey(), new Grant(t + 1, given.get(entry.getKey())));
                }
            }
            return out;
        }
        Map<K, Grant> out = new HashMap<>();
        for (Map.Entry<K, Long> entry : given.entrySet()) {
            out.put(entry.getKey(), new Grant(TIERS, entry.getValue()));
        }
        return out;
    }
}
