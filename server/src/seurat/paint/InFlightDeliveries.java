package seurat.paint;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Delivery;

/** Deliveries opened and not finished, per canvas: what a reduction must cut (spec 4.2.2). */
final class InFlightDeliveries {
    private final ConcurrentHashMap<Canvas, Set<Delivery>> active = new ConcurrentHashMap<>();

    void add(Canvas canvas, Delivery delivery) {
        active.computeIfAbsent(canvas, k -> ConcurrentHashMap.newKeySet()).add(delivery);
    }

    void remove(Canvas canvas, Delivery delivery) {
        Set<Delivery> set = active.get(canvas);
        if (set != null) {
            set.removeIf(d -> d.number() == delivery.number());
            if (set.isEmpty()) {
                active.remove(canvas, set);
            }
        }
    }

    boolean isEmpty() {
        return active.values().stream().allMatch(Set::isEmpty);
    }

    /** Cuts the in-flight deliveries matching `cut`: out of the book, RESET_STREAM on the mapping. */
    Ranges cancel(Canvas canvas, Predicate<Delivery> cut) {
        Set<Delivery> set = active.get(canvas);
        Ranges.Builder cancelled = new Ranges.Builder();
        if (set != null) {
            for (Delivery d : set) {
                if (cut.test(d)) {
                    canvas.book().cancel(d.number());
                    canvas.session().mapping().cancel(d.number());
                    cancelled.add(d.number());
                }
            }
        }
        return cancelled.build();
    }
}
