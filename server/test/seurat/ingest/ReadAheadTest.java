package seurat.ingest;

import java.io.IOException;
import seurat.kit.TestKit;

/** Producer-consumer order, EOF stickiness, failure propagation, fraction. */
public final class ReadAheadTest {
    public static void main(String[] args) throws Exception {
        orderAndEof();
        failureRethrown();
        System.out.println("ReadAheadTest OK");
    }

    static final class Fake implements MasterReader {
        private final int[][][] bands;
        private int i;
        boolean closed;

        Fake(int[][]... bands) { this.bands = bands; }

        @Override
        public int width() { return 2; }

        @Override
        public int height() { return 5; }

        @Override
        public int[][] next() { return i < bands.length ? bands[i++] : null; }

        @Override
        public double fraction() { return 0; }

        @Override
        public void close() { closed = true; }
    }

    private static void orderAndEof() throws Exception {
        Fake fake = new Fake(new int[][]{{1}, {2}}, new int[][]{{3}}, new int[][]{{4}, {5}});
        ReadAheadReader reader = new ReadAheadReader(fake);
        try {
            TestKit.check(reader.next()[0][0] == 1, "band 0 first row");
            TestKit.check(reader.next()[0][0] == 3, "band 1");
            TestKit.check(reader.next().length == 2, "band 2 rows");
            TestKit.check(reader.next() == null, "EOF null");
            TestKit.check(reader.next() == null, "EOF sticky");
            TestKit.check(reader.fraction() == 1.0, "fraction counts emitted rows");
        } finally {
            reader.close();
        }
        TestKit.check(fake.closed, "delegate closed");
    }

    private static void failureRethrown() throws Exception {
        MasterReader failing = new MasterReader() {
            private int i;

            @Override
            public int width() { return 1; }

            @Override
            public int height() { return 2; }

            @Override
            public int[][] next() throws IOException {
                if (i++ == 0) return new int[][]{{7}};
                throw new IOException("boom");
            }

            @Override
            public double fraction() { return 0; }

            @Override
            public void close() { }
        };
        try (ReadAheadReader reader = new ReadAheadReader(failing)) {
            TestKit.check(reader.next()[0][0] == 7, "first band before failure");
            try {
                reader.next();
                throw new AssertionError("expected boom");
            } catch (IOException expected) {
                TestKit.check("boom".equals(expected.getMessage()), "producer failure rethrown");
            }
        }
    }
}
