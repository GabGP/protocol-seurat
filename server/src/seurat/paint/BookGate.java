package seurat.paint;

import seurat.codec.BrushId;
import seurat.session.Canvas;

/**
 * Spec 4.1 (c): |libro| counts brushes (max_pinceladas), not deliveries. A further delivery of a
 * brush already held (an upgrade) needs no new slot; only a brush the book lacks does. The window
 * RECIBO.libre stays in deliveries: counting them against it is at least as strict as brushes.
 */
final class BookGate {
    private BookGate() {}

    /** The book has room for a delivery of `brush`. */
    static boolean admits(Canvas canvas, BrushId brush) {
        return canvas.book().brushCount() < canvas.concession().maxBrushes() || canvas.book().holds(brush);
    }

    /** Gate (c) whole: room in the book, and fewer deliveries unsettled than RECIBO.libre. */
    static boolean open(Canvas canvas, BrushId brush) {
        return admits(canvas, brush) && canvas.book().unsettled() < canvas.free;
    }
}
