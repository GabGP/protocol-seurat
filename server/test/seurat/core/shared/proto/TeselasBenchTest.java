package seurat.core.shared.proto;

import java.lang.ref.Reference;
import java.nio.ByteBuffer;
import java.util.Locale;
import java.util.Random;
import java.util.TreeSet;
import java.util.function.LongSupplier;
import seurat.kit.TestKit;

/**
 * ADR-09 bench: block sets and Teselas against v1.0 TreeSet and Rangos, on four set shapes: heap per
 * number, encoded bytes, encode and decode time.
 */
public final class TeselasBenchTest {
    private static final int COPIES = 300;
    private static final int PASSES = 7;
    private static volatile long sink;

    public static void main(String[] args) {
        Shape[] shapes = shapes();

        for (Shape shape : shapes) {
            Ranges ranges = Ranges.of(shape.numbers);
            TreeSet<Long> set = RangosRef.set(shape.numbers);
            byte[] rangosBytes = RangosRef.encode(set);
            byte[] teselasBytes = TeselasCodec.encode(ranges);
            TestKit.check(teselasBytes.length <= rangosBytes.length,
                    shape.name + " bytes: " + teselasBytes.length + " <= " + rangosBytes.length);

            long treeHeap = measureTreeHeap(shape.numbers);
            long rangesHeap = measureRangesHeap(shape.numbers);
            if (!shape.name.equals("receipt")) {
                TestKit.check(rangesHeap < treeHeap,
                        shape.name + " heap: ranges=" + rangesHeap + " < tree=" + treeHeap);
            }
            double treeBPerNum = (double) treeHeap / (COPIES * shape.numbers.length);
            double rangesBPerNum = (double) rangesHeap / (COPIES * shape.numbers.length);

            int rounds = Math.max(200, 2_000_000 / shape.numbers.length);
            long fastestV1Enc = fastest(rounds, () -> RangosRef.encode(set).length);
            long fastestTesEnc = fastest(rounds, () -> TeselasCodec.encode(ranges).length);
            long fastestV1Dec = fastest(rounds, () -> RangosRef.decode(ByteBuffer.wrap(rangosBytes)).size());
            long fastestTesDec = fastest(rounds, () -> TeselasCodec.decode(ByteBuffer.wrap(teselasBytes)).size());

            TestKit.check(fastestTesEnc <= (long) (1.10 * fastestV1Enc),
                    shape.name + " encode: teselas=" + fastestTesEnc + " <= 1.10*v1=" + (long) (1.10 * fastestV1Enc));
            TestKit.check(fastestTesDec <= (long) (1.10 * fastestV1Dec),
                    shape.name + " decode: teselas=" + fastestTesDec + " <= 1.10*v1=" + (long) (1.10 * fastestV1Dec));

            long v1EncNs = fastestV1Enc / rounds;
            long tesEncNs = fastestTesEnc / rounds;
            long v1DecNs = fastestV1Dec / rounds;
            long tesDecNs = fastestTesDec / rounds;

            System.out.printf(Locale.ROOT,
                    "%s bytes %d/%d | heap B/number %.1f/%.1f | encode ns %d/%d | decode ns %d/%d%n",
                    shape.name, rangosBytes.length, teselasBytes.length,
                    treeBPerNum, rangesBPerNum,
                    v1EncNs, tesEncNs,
                    v1DecNs, tesDecNs);
        }

        if (sink == 0) {
            System.out.println(sink);
        }
        System.out.println("TeselasBenchTest OK");
    }

    private static long fastest(int rounds, LongSupplier work) {
        for (int i = 0; i < rounds; i++) {
            sink += work.getAsLong();
        }
        long best = Long.MAX_VALUE;
        for (int p = 0; p < PASSES; p++) {
            long t0 = System.nanoTime();
            for (int i = 0; i < rounds; i++) {
                sink += work.getAsLong();
            }
            long dt = System.nanoTime() - t0;
            if (dt < best) {
                best = dt;
            }
        }
        return best;
    }

    private static long gcUsed() {
        for (int i = 0; i < 3; i++) {
            System.gc();
            try {
                Thread.sleep(20);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        return Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
    }

    private static long measureTreeHeap(long[] numbers) {
        long before = gcUsed();
        @SuppressWarnings("unchecked")
        TreeSet<Long>[] arr = new TreeSet[COPIES];
        for (int i = 0; i < COPIES; i++) {
            arr[i] = RangosRef.set(numbers);
        }
        long after = gcUsed();
        Reference.reachabilityFence(arr);
        return Math.max(0, after - before);
    }

    private static long measureRangesHeap(long[] numbers) {
        long before = gcUsed();
        Ranges[] arr = new Ranges[COPIES];
        for (int i = 0; i < COPIES; i++) {
            Ranges.Builder b = new Ranges.Builder();
            for (long n : numbers) {
                b.add(n);
            }
            arr[i] = b.build();
        }
        long after = gcUsed();
        Reference.reachabilityFence(arr);
        return Math.max(0, after - before);
    }

    private static Shape[] shapes() {
        Random rnd = new Random(9);
        long[] book = new long[44 + 400];
        for (int i = 0; i < 44; i++) {
            book[i] = i + 1;
        }
        long cur = 5000;
        book[44] = cur;
        for (int i = 1; i < 400; i++) {
            cur += 1 + rnd.nextInt(4);
            book[44 + i] = cur;
        }

        long[] run = new long[5000];
        for (int i = 0; i < 5000; i++) {
            run[i] = i + 1;
        }

        long[] evicted = new long[150];
        for (int i = 0; i < 150; i++) {
            evicted[i] = 10000 + 2L * i;
        }

        long[] receipt = new long[8];
        for (int i = 0; i < 8; i++) {
            receipt[i] = 5000 + i;
        }

        return new Shape[]{
            new Shape("book", book),
            new Shape("run", run),
            new Shape("evicted", evicted),
            new Shape("receipt", receipt)
        };
    }

    private record Shape(String name, long[] numbers) {}
}
