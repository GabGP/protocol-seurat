package seurat.core.shared.codec;

import java.util.zip.CRC32C;
import java.util.zip.Deflater;

/** Reusable thread-local workspace for zero-allocation brush encoding. */
final class BrushWorkspace {
    static final int N = Geometry.PARENTS;

    final int[][][] q = new int[3][3][N];
    final int[] energy = new int[N];
    final byte[] band = new byte[N];
    final int[] order = new int[N];
    final int[] spare = new int[N];
    final int[] count = new int[1 << BandSplit.DIGIT_BITS];
    final int[] members = new int[N];
    /** Start of each band's members, NONE included: bands 0..NONE plus the end. */
    final int[] from = new int[Bands.NONE + 2];
    final int[] fill = new int[Bands.NONE + 2];
    final byte[] rawBuf = new byte[Geometry.SCRATCH_BYTES];
    final byte[] compBuf = new byte[Geometry.SCRATCH_BYTES];
    final CRC32C crc = new CRC32C();
    final Deflater deflater = new Deflater(seurat.core.shared.config.SeuratConstants.DEFLATE_LEVEL, true);

    static final ThreadLocal<BrushWorkspace> LOCAL = ThreadLocal.withInitial(BrushWorkspace::new);
}
