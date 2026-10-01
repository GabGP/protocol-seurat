package seurat.core.works.store;

import java.io.IOException;
import java.io.OutputStream;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.codec.Quant;

/** Positional reads over immutable per-edition brush bytes. */
public interface BrushStore {
    /** Full band interval [b0,b1) bytes for a brush. Prefix reads are cheap. */
    byte[][] bands(BrushId p, int b0, int b1) throws IOException;

    /** The valid prefix of [b0,b1): stops at the first band whose CRC-32C fails (spec 8). */
    default byte[][] servable(BrushId p, int b0, int b1) throws IOException {
        return bands(p, b0, b1);
    }

    /** Bands 0..n-1 of the brush are known good: n stays large until a band failed its CRC-32C twice. */
    default int validBands(BrushId p) {
        return Integer.MAX_VALUE;
    }

    /** Copies [b0,b1) bytes to out. Verifies CRC-32C on read. */
    void copy(BrushId p, int b0, int b1, OutputStream out) throws IOException;

    /** Total bytes of [b0,b1). */
    long bytes(BrushId p, int b0, int b1) throws IOException;

    /** Quant table the bands were encoded with; the current table when the store does not say. */
    default int quantTable() {
        return Quant.TABLE;
    }

    WorkMeta meta();
}
