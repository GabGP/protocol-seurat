package seurat.core.viewing.plan;

import seurat.core.shared.codec.BrushId;

/** Read view of held bands. Implemented by callers over LoanBook. */
public interface BookView {
    int bands(BrushId p);

    /**
     * First band at or above `from` that a held delivery already covers, MAX_VALUE if none. A plan
     * entry stops there, so repairing a lost lower delivery never resends the upper one (ADR-06).
     */
    default int heldFrom(BrushId p, int from) {
        return Integer.MAX_VALUE;
    }
}
