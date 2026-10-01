package seurat.core.works.ingest.port;

import java.io.IOException;

/** Master image source: sequential 256-row bands of packed RGB. */
public interface MasterReader extends AutoCloseable {
    int width();

    int height();

    /** Next band, up to 256 rows, packed RGB row-major; null at end. */
    int[][] next() throws IOException;

    double fraction();

    @Override
    void close() throws IOException;
}
