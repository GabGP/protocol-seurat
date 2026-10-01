package seurat.core.works.catalog;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.core.shared.config.Units;
import seurat.core.shared.proto.ProtoCodes;

/** The last whole percent announced per work, so OBRA(ESTADO) goes out only when it changes. */
final class WorkProgress {
    private final Map<String, Integer> last = new ConcurrentHashMap<>();

    void reset(String id) {
        last.remove(id);
    }

    void start(String id) {
        last.put(id, 0);
    }

    int of(String id) {
        return last.getOrDefault(id, 0);
    }

    /** Records pct; true when it differs from the last one announced. */
    boolean advance(String id, int pct) {
        Integer previous = last.put(id, pct);
        return previous == null || previous != pct;
    }

    /** What CATALOGO reports: a LISTA work is whole, any other its last percent. */
    int shown(WorkRecord work) {
        return work.meta.state() == ProtoCodes.ST_LISTA ? Units.PERCENT : of(work.meta.id());
    }
}
