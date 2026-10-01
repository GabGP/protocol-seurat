package seurat.core.viewing.plan;

import seurat.core.shared.codec.BrushId;

/** Read view of held bands. Implemented by callers over LoanBook. */
public interface BookView {
    int bands(BrushId p);
}
