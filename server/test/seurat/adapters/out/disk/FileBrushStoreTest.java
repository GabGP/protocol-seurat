package seurat.adapters.out.disk;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.shared.codec.BrushEncoder;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.codec.Quant;
import seurat.core.works.store.WorkMeta;
import seurat.kit.TestKit;

/** Prefix/retouch reads, absent/empty, truncate recovery, corrupt band. */
public final class FileBrushStoreTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("store-test");
        prefixRetouch(root);
        absentEmpty(root);
        truncateRecovery(root);
        corruptBand(root);
        concurrentAppend(root);
        System.out.println("FileBrushStoreTest OK");
    }

    static WorkMeta meta() {
        return new WorkMeta("t", "t", 512, 512, 256, 2, 3, 2);
    }

    static FileBrushStore open(Path dir) throws Exception {
        return open(dir, new int[]{2});
    }

    static FileBrushStore open(Path dir, int[] nx) throws Exception {
        return new FileBrushStore(dir, meta(), nx, new int[]{nx.length});
    }

    static BrushEncoder.BrushBands bands(int seed) {
        int n = 16384;
        java.util.Random rnd = new java.util.Random(seed);
        int[][] parents = new int[3][n];
        int[][][] h = new int[3][1][n];
        int[][][] v = new int[3][1][n];
        int[][][] d = new int[3][1][n];
        for (int c = 0; c < 3; c++) {
            for (int i = 0; i < n; i++) {
                parents[c][i] = 128;
                h[c][0][i] = rnd.nextInt(21) - 10;
                v[c][0][i] = rnd.nextInt(21) - 10;
                d[c][0][i] = rnd.nextInt(21) - 10;
            }
        }
        return BrushEncoder.encode(parents, h, v, d, n, 128, Quant.qy(1), Quant.qc(1));
    }

    private static void prefixRetouch(Path root) throws Exception {
        FileBrushStore store = open(root.resolve("a"));
        var bb = bands(1);
        store.append(0, 0, 0, bb.bands(), bb.crcs());
        store.close();
        byte[][] prefix = store.bands(new BrushId(0, 0, 0), 0, 2);
        TestKit.check(prefix.length == 2 && java.util.Arrays.equals(prefix[0], bb.bands()[0]),
                "prefix read");
        byte[][] retouch = store.bands(new BrushId(0, 0, 0), 2, 4);
        TestKit.check(retouch.length == 2 && java.util.Arrays.equals(retouch[1], bb.bands()[3]),
                "retouch read");
        TestKit.check(store.bytes(new BrushId(0, 0, 0), 0, 2)
                == bb.bands()[0].length + bb.bands()[1].length, "byte count");
    }

    private static void absentEmpty(Path root) throws Exception {
        FileBrushStore store = open(root.resolve("b"));
        try {
            store.bands(new BrushId(0, 1, 1), 0, 4);
            throw new AssertionError("expected absent");
        } catch (java.io.IOException expected) {
            TestKit.check(true, "absent trips");
        }
        store.append(0, 0, 0, new byte[][]{new byte[0], new byte[0]},
                new long[]{crc(new byte[0]), crc(new byte[0])});
        byte[][] empty = store.bands(new BrushId(0, 0, 0), 0, 4);
        TestKit.check(empty.length == 4 && empty[0].length == 0, "empty brush, zero bytes");
        store.close();
    }

    private static long crc(byte[] raw) {
        java.util.zip.CRC32C c = new java.util.zip.CRC32C();
        c.update(raw);
        return c.getValue();
    }

    private static void truncateRecovery(Path root) throws Exception {
        Path dir = root.resolve("c");
        FileBrushStore store = open(dir);
        var bb = bands(2);
        store.append(0, 0, 0, bb.bands(), bb.crcs());
        long good = Files.size(dir.resolve("E0.pinc"));
        Files.write(dir.resolve("E0.pinc"), new byte[9999],
                java.nio.file.StandardOpenOption.APPEND);
        TestKit.check(Files.size(dir.resolve("E0.pinc")) > good, "crash garbage");
        store.close();
        FileBrushStore reopened = open(dir);
        TestKit.check(Files.size(dir.resolve("E0.pinc")) == good, "truncated to index");
        byte[][] back = reopened.bands(new BrushId(0, 0, 0), 0, 4);
        TestKit.check(back[0].length == bb.bands()[0].length, "bytes survive crash");
        reopened.close();
    }

    private static void corruptBand(Path root) throws Exception {        Path dir = root.resolve("d");
        FileBrushStore store = open(dir);
        var bb = bands(3);
        store.append(0, 0, 0, bb.bands(), bb.crcs());
        store.close();
        byte[] pinc = Files.readAllBytes(dir.resolve("E0.pinc"));
        pinc[10]++;
        Files.write(dir.resolve("E0.pinc"), pinc);
        try {
            open(dir).bands(new BrushId(0, 0, 0), 0, 4);
            throw new AssertionError("expected CRC failure");
        } catch (java.io.IOException expected) {
            TestKit.check(true, "corrupt band trips CRC");
        }
        BrushId seed = new BrushId(seurat.core.shared.config.SeuratConstants.SEED_STRATUM, 0, 0);
        byte[] file = seurat.core.shared.codec.SeedCodec.encode(new int[3][4], 2, 2);
        Files.write(dir.resolve("semilla.bin"), file);
        TestKit.check(open(dir).servable(seed, 0, 1).length == 1, "an intact seed is served");
        file[file.length - 1]++;
        Files.write(dir.resolve("semilla.bin"), file);
        TestKit.check(open(dir).servable(seed, 0, 1).length == 0, "a corrupt seed is never served (spec 8)");
    }

    /** Lock-free path: 8 threads reserve disjoint spans, every slot reads back exact. */
    private static void concurrentAppend(Path root) throws Exception {
        Path dir = root.resolve("e");
        FileBrushStore store = open(dir, new int[]{8});
        var pool = java.util.concurrent.Executors.newFixedThreadPool(8);
        try {
            java.util.List<java.util.concurrent.Future<?>> tasks = new java.util.ArrayList<>();
            for (int k = 0; k < 8; k++) {
                final int slot = k;
                tasks.add(pool.submit(() -> {
                    var bb = bands(100 + slot);
                    store.append(0, slot, 0, bb.bands(), bb.crcs());
                    return null;
                }));
            }
            for (java.util.concurrent.Future<?> task : tasks) {
                task.get();
            }
        } finally {
            pool.shutdown();
        }
        store.close();
        for (int k = 0; k < 8; k++) {
            var bb = bands(100 + k);
            byte[][] back = store.bands(new BrushId(0, k, 0), 0, 4);
            for (int b = 0; b < 4; b++) {
                TestKit.check(java.util.Arrays.equals(back[b], bb.bands()[b]),
                        "concurrent slot " + k + " band " + b);
            }
        }
    }
}
