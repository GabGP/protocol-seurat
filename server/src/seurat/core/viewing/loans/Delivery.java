package seurat.core.viewing.loans;

import seurat.core.shared.codec.BrushId;

/** One numbered loan on a canvas. Numbering starts at 1, monotone; edition of the store it came from. */
public record Delivery(long number, BrushId brush, int from, int through,
        int bytes, long epoch, long edition) {}
