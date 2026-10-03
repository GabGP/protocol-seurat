package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ADR-07 rules 3 and 4: the room of the next horizon is handed out by sharpness,
 * coarsest tier first, max-min inside a tier. The filling stops at the first tier
 * that does not fit.
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
     * @param bytes what was allotted over the horizon, or {@link CapacityMeter#UNBOUNDED}
     */
    public record Grant(int tier, long bytes) {}

    /**
     * Allots the room of the next horizon across sharpness tiers.
     *
     * @param demand mapping of keys to wanted bytes per tier
     * @param room total bytes available over the horizon
     * @param <K> session key type
     * @return map of grants per session
     */
    public static <K> Map<K, Grant> fill(Map<K, long[]> demand, long room) {
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
            final int tierIndex = t;
            active.sort(Comparator.comparingLong(k -> demand.get(k)[tierIndex]));
            Map<K, Grant> out = new HashMap<>();
            int n = active.size();
            for (int i = 0; i < n; i++) {
                K k = active.get(i);
                long wanted = demand.get(k)[t];
                long fair = left / (n - i);
                long give = Math.min(wanted, fair);
                long totalGiven = given.get(k) + give;
                given.put(k, totalGiven);
                left -= give;
                int tier = give >= wanted ? t + 1 : t;
                out.put(k, new Grant(tier, totalGiven));
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
