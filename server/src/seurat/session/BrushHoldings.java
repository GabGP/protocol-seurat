package seurat.session;

import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;
import seurat.codec.BrushId;
import seurat.codec.Geometry;
import seurat.config.SeuratConstants;

/** Which deliveries hold which brush, per edition, keyed by their first band: the "bands held" view of a LoanBook. */
final class BrushHoldings {
    private record Key(BrushId brush, long edition) {}

    private final Map<Key, TreeMap<Integer, Delivery>> byBrush = new HashMap<>();

    /** Adds e, or replaces the one that starts at the same band. */
    void put(Delivery e) {
        byBrush.computeIfAbsent(new Key(e.brush(), e.edition()), k -> new TreeMap<>()).put(e.from(), e);
    }

    void remove(Delivery e) {
        Key key = new Key(e.brush(), e.edition());
        TreeMap<Integer, Delivery> group = byBrush.get(key);
        if (group != null) {
            group.remove(e.from(), e); // a resend from the same band may have replaced it
            if (group.isEmpty()) {
                byBrush.remove(key);
            }
        }
    }

    /** Bands held contiguously from 0 in `edition`; seed: all or none. */
    int bands(BrushId p, long edition) {
        TreeMap<Integer, Delivery> group = byBrush.get(new Key(p, edition));
        if (group == null || p.stratum() == SeuratConstants.SEED_STRATUM) {
            return group == null ? 0 : Geometry.BANDS;
        }
        int have = 0;
        for (var e = group.firstEntry(); e != null && e.getKey() <= have; e = group.higherEntry(e.getKey())) {
            have = Math.max(have, e.getValue().through());
        }
        return have;
    }
}
