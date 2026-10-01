package seurat.adapters.out.decode.raster;

/** Byte signatures and sizes of the container formats intake recognises. */
public final class FormatMarkers {
    public static final byte[] PNG_SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    public static final int PNG_IHDR = 0x49484452;
    public static final int PNG_IDAT = 0x49444154;
    public static final int PNG_IEND = 0x49454E44;
    /** CRC-32 of the empty IEND chunk, the last four bytes of a whole PNG. */
    public static final int PNG_IEND_CRC = 0xAE426082;
    /** A PNG ends with a zero length, "IEND" and its CRC: 3 ints. */
    public static final int PNG_TAIL_BYTES = 12;

    private FormatMarkers() {}

    /** True when the first 8 bytes of `head` are the PNG signature. */
    public static boolean isPng(byte[] head) {
        for (int i = 0; i < PNG_SIGNATURE.length; i++) {
            if (head[i] != PNG_SIGNATURE[i]) {
                return false;
            }
        }
        return true;
    }
}
