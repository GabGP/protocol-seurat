package seurat.catalog;

import java.util.HashMap;
import java.util.Map;
import seurat.config.SeuratConstants;

/**
 * PUT .../politica (spec 3.1, 2.3): the ceilings a change would leave, if valid. A ceiling
 * is {stratum, bands} with stratum in [0, seed] and bands in [1, 4]; each role must cover
 * the weaker ones, so the union of what several roles obtain never exceeds the highest (9.1).
 */
public final class RolePolicy {
    private static final int MAX_BANDS = 4;

    private RolePolicy() {}

    /** The merged ceilings, or null when a value is out of range or the roles stop nesting. */
    public static Map<String, long[]> merge(Map<String, long[]> current, Map<String, long[]> changes) {
        Map<String, long[]> next = new HashMap<>(current);
        for (var c : changes.entrySet()) {
            long[] v = c.getValue();
            if (!WorkRecord.ROLES.contains(c.getKey()) || v.length != 2 || v[0] < 0
                    || v[0] > SeuratConstants.SEED_STRATUM || v[1] < 1 || v[1] > MAX_BANDS) {
                return null;
            }
            next.put(c.getKey(), v.clone());
        }
        for (int i = 1; i < WorkRecord.ROLES.size(); i++) {
            if (!covers(next.get(WorkRecord.ROLES.get(i)), next.get(WorkRecord.ROLES.get(i - 1)))) {
                return null;
            }
        }
        return next;
    }

    /** A finer stratum covers any bands of a coarser one; the same stratum needs as many bands. */
    static boolean covers(long[] strong, long[] weak) {
        return strong[0] < weak[0] || (strong[0] == weak[0] && strong[1] >= weak[1]);
    }
}
