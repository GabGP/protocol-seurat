package seurat.core.works.ingest;

import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.works.ingest.decode.MasterReader;

/** Producer-consumer overlap: a virtual thread decodes ahead while workers encode. */
public final class ReadAheadReader implements MasterReader {
    private static final int[][] EOF = new int[0][];
    private final MasterReader delegate;
    private final BlockingQueue<int[][]> queue;
    private final Thread producer;
    private volatile Throwable failure;
    private volatile boolean closed;
    private boolean done;
    private int emitted;

    public ReadAheadReader(MasterReader delegate) {
        this.delegate = delegate;
        this.queue = new ArrayBlockingQueue<>(SeuratConstants.INGEST_READAHEAD_BANDS);
        this.producer = Thread.ofVirtual().name("ingest-readahead").start(this::produce);
    }

    private void produce() {
        try {
            int[][] band;
            while (!closed && (band = delegate.next()) != null) {
                queue.put(copy(band));
            }
        } catch (Throwable ex) {
            failure = ex;
        }
        try {
            queue.put(EOF);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    private static int[][] copy(int[][] band) {
        int[][] out = new int[band.length][];
        for (int y = 0; y < band.length; y++) {
            out[y] = band[y].clone();
        }
        return out;
    }

    @Override
    public int width() { return delegate.width(); }

    @Override
    public int height() { return delegate.height(); }

    @Override
    public int[][] next() throws IOException {
        if (done) return null;
        try {
            int[][] band = queue.take();
            if (band == EOF) {
                done = true;
                rethrow();
                return null;
            }
            emitted += band.length;
            return band;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted", ex);
        }
    }

    private void rethrow() throws IOException {
        if (failure instanceof IOException ex) throw ex;
        if (failure instanceof RuntimeException ex) throw ex;
        if (failure instanceof Error err) throw err;
    }

    @Override
    public double fraction() { return (double) emitted / Math.max(1, height()); }

    @Override
    public synchronized void close() throws IOException {
        if (closed) return;
        closed = true;
        producer.interrupt();
        try {
            delegate.close();
        } finally {
            queue.clear();
            queue.offer(EOF);
        }
    }
}
