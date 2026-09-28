package seurat.budget;

import java.util.BitSet;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.codec.BrushId;
import seurat.config.Units;

/**
 * Global cap per (work, role, stratum) across principals (spec 9.2, collusion of
 * same-role accounts): brushes newly covered inside the current window.
 */
final class GlobalCoverage {
    private static final class Window {
        final BitSet brushes = new BitSet();
        long startNs = System.nanoTime();
    }

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    private Window window(String key) {
        Window w = windows.computeIfAbsent(key, k -> new Window());
        if (System.nanoTime() - w.startNs > BudgetPolicy.GLOBAL_WINDOW_MS * Units.NANOS_PER_MS) {
            w.brushes.clear();
            w.startNs = System.nanoTime();
        }
        return w;
    }

    synchronized double fraction(String key, int total) {
        return total == 0 ? 1 : (double) window(key).brushes.cardinality() / total;
    }

    synchronized void mark(String key, BrushId p, int width) {
        window(key).brushes.set(p.by() * width + p.bx());
    }

    static String key(String work, String role, int stratum) {
        return work + "\0" + role + "\0" + stratum;
    }
}
