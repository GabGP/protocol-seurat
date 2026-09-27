package seurat.budget;

import java.util.BitSet;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.codec.BrushId;

/**
 * Global cap per (work, role, stratum) across principals (spec 9.2, collusion of
 * same-role accounts): brushes newly covered inside the current window.
 */
final class GlobalCoverage {
    private static final class Window {
        final BitSet brushes = new BitSet();
        long startMs = System.currentTimeMillis();
    }

    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    private Window window(String key) {
        Window w = windows.computeIfAbsent(key, k -> new Window());
        if (System.currentTimeMillis() - w.startMs > BudgetPolicy.GLOBAL_WINDOW_MS) {
            w.brushes.clear();
            w.startMs = System.currentTimeMillis();
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
