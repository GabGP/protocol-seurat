package seurat.adapters.out.disk;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.config.SeuratConstants;

/**
 * Bands whose CRC-32C failed twice: (stratum, slot) -> first bad band. Bounded (the oldest is forgotten),
 * so a damaged store cannot grow it and a brush is alerted once, not on every read.
 */
final class BadBands {
    private record Slot(int stratum, long slot) {}

    private final Map<Slot, Integer> firstBad = Collections.synchronizedMap(new LinkedHashMap<>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Slot, Integer> eldest) {
            return size() > SeuratConstants.BAD_BANDS_KEEP;
        }
    });

    /** Bands 0..n-1 of the brush are worth reading; unbounded (MAX_VALUE) while none is known bad. */
    int valid(BrushId p, long slot) {
        return firstBad.getOrDefault(new Slot(p.stratum(), slot), Integer.MAX_VALUE);
    }

    /** Remembers `band` as bad; true when it is news (the caller alerts then, never again). */
    boolean remember(BrushId p, long slot, int band) {
        Slot key = new Slot(p.stratum(), slot);
        synchronized (firstBad) {
            Integer known = firstBad.get(key);
            if (known != null && known <= band) {
                return false;
            }
            firstBad.put(key, band);
            return true;
        }
    }
}
