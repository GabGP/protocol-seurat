package seurat.catalog;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.store.BrushStore;
import seurat.store.WorkMeta;

/** One work: meta + ceilings per role + live store handle. */
public final class WorkRecord {
    public static final String ANONYMOUS = "anonimo";
    public static final String AUTHENTICATED = "autenticado";
    public static final String PRIVILEGED = "privilegiado";
    /** Weakest first: each role's ceiling must cover the one before it (spec 9.1, nested masks). */
    public static final List<String> ROLES = List.of(ANONYMOUS, AUTHENTICATED, PRIVILEGED);

    public volatile WorkMeta meta;
    public final Map<String, long[]> ceilings = new ConcurrentHashMap<>();
    public volatile BrushStore store;

    public WorkRecord(WorkMeta meta) {
        this.meta = meta;
        // Spec 2.3 defaults (nested masks): anonymous stratum 1 with 2 bands, authenticated
        // stratum 0 with 2, privileged stratum 0 with all 4. PUT .../politica changes them.
        ceilings.put(ANONYMOUS, new long[]{1, 2});
        ceilings.put(AUTHENTICATED, new long[]{0, 2});
        ceilings.put(PRIVILEGED, new long[]{0, 4});
    }

    public long[] ceiling(String role) {
        return ceilings.getOrDefault(role, ceilings.get(ANONYMOUS));
    }
}
