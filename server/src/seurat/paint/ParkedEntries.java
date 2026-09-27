package seurat.paint;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import seurat.session.Canvas;

/**
 * Plan entries waiting for receiver credit (RECIBO.libre) or a write slot.
 * They wait here instead of spinning through the Painter queue; a RECIBO,
 * a SOLTAR or a finished write hands them back.
 */
final class ParkedEntries {
    private final Map<Canvas, List<Pending>> byCanvas = new HashMap<>();

    synchronized void park(Pending pending) {
        byCanvas.computeIfAbsent(pending.canvas(), k -> new ArrayList<>()).add(pending);
    }

    synchronized List<Pending> take(Canvas canvas) {
        List<Pending> out = byCanvas.remove(canvas);
        return out == null ? List.of() : out;
    }

    synchronized List<Pending> takeAll() {
        List<Pending> out = new ArrayList<>();
        byCanvas.values().forEach(out::addAll);
        byCanvas.clear();
        return out;
    }

    synchronized boolean isEmpty() {
        for (List<Pending> list : byCanvas.values()) {
            if (!list.isEmpty()) return false;
        }
        return true;
    }

    synchronized void removeIf(Canvas canvas, Predicate<Pending> drop) {
        List<Pending> list = byCanvas.get(canvas);
        if (list != null) {
            list.removeIf(drop);
        }
    }
}
