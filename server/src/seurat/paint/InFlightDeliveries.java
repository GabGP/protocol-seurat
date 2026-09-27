package seurat.paint;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Delivery;

/** Tracks in-flight deliveries per canvas to cancel on concession reduction. */
final class InFlightDeliveries {
    private final ConcurrentHashMap<Canvas, Set<Delivery>> active = new ConcurrentHashMap<>();

    void add(Canvas canvas, Delivery delivery) {
        active.computeIfAbsent(canvas, k -> ConcurrentHashMap.newKeySet()).add(delivery);
    }

    void remove(Canvas canvas, Delivery delivery) {
        Set<Delivery> set = active.get(canvas);
        if (set != null) {
            set.remove(delivery);
        }
    }

    boolean isEmpty() {
        for (Set<Delivery> set : active.values()) {
            if (!set.isEmpty()) return false;
        }
        return true;
    }

    Ranges purge(Canvas canvas, Concession next) {
        Set<Delivery> set = active.get(canvas);
        if (set == null || set.isEmpty()) {
            return Ranges.empty();
        }
        Ranges.Builder cancelled = new Ranges.Builder();
        for (Delivery d : set) {
            if (!next.allows(d.brush(), d.through())) {
                canvas.book().cancel(d.number());
                cancelled.add(d.number());
                set.remove(d);
            }
        }
        return cancelled.build();
    }
}
