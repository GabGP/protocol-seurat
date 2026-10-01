package seurat.adapters.out.decode;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import seurat.adapters.out.decode.psb.PsbReader;
import seurat.adapters.out.decode.raster.FormatMarkers;
import seurat.adapters.out.decode.tiff.TiffFile;
import seurat.adapters.out.decode.tiff.TiffLayout;
import seurat.core.works.catalog.MasterNames;

/** Whether a master transfer has landed whole: PNG tail, JPEG end marker, TIFF and Photoshop by their layout. */
public final class WholeFile {
    private WholeFile() {}

    /** True once every byte the reader of the master needs is on disk; other names: once non-empty. */
    public static boolean isWhole(Path file, long size) {
        String lower = MasterNames.lowerName(file);
        if (lower.endsWith(".png")) return isPngComplete(file, size);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return isJpgComplete(file, size);
        try {
            if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
                try (TiffFile f = TiffFile.open(file)) {
                    TiffLayout l = f == null ? null : TiffLayout.of(f.firstIfd(TiffLayout.TAGS));
                    return f == null ? size > 0 : l == null || l.end() <= size; // a cut directory throws
                }
            }
            if (lower.endsWith(".psb") || lower.endsWith(".psd")) {
                try (PsbReader p = PsbReader.open(file)) {
                    return p != null && p.end() <= size;
                }
            }
        } catch (IOException | RuntimeException ex) {
            return false;
        }
        return size > 0;
    }

    private static boolean isPngComplete(Path file, long size) {
        if (size < FormatMarkers.PNG_TAIL_BYTES) return false;
        try (var ch = FileChannel.open(file, StandardOpenOption.READ)) {
            ByteBuffer buf = ByteBuffer.allocate(FormatMarkers.PNG_TAIL_BYTES);
            ch.position(size - FormatMarkers.PNG_TAIL_BYTES);
            ch.read(buf);
            buf.flip();
            return buf.getInt() == 0 && buf.getInt() == FormatMarkers.PNG_IEND && buf.getInt() == FormatMarkers.PNG_IEND_CRC;
        } catch (Exception ex) {
            return false;
        }
    }

    private static boolean isJpgComplete(Path file, long size) {
        if (size < 2) return false;
        try (var ch = FileChannel.open(file, StandardOpenOption.READ)) {
            ByteBuffer buf = ByteBuffer.allocate(2);
            ch.position(size - 2);
            ch.read(buf);
            buf.flip();
            return (buf.get() & 0xFF) == 0xFF && (buf.get() & 0xFF) == 0xD9;
        } catch (Exception ex) {
            return false;
        }
    }
}
