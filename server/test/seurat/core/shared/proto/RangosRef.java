package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.TreeSet;

/**
 * Seurat/1 v1.0 storage and codec (TreeSet<Long>, Rangos), replaced by ADR-09; the baseline TeselasBenchTest
 * compares against.
 */
final class RangosRef {
    private RangosRef() {}

    static TreeSet<Long> set(long[] numbers) {
        TreeSet<Long> s = new TreeSet<>();
        for (long n : numbers) {
            s.add(n);
        }
        return s;
    }

    static byte[] encode(TreeSet<Long> s) {
        if (s.isEmpty()) {
            return new byte[]{0x00, 0x00, 0x00};
        }
        List<long[]> runs = new ArrayList<>();
        long runLo = 0;
        long runHi = 0;
        boolean inRun = false;
        for (long n : s) {
            if (!inRun) {
                runLo = n;
                runHi = n;
                inRun = true;
            } else if (n == runHi + 1) {
                runHi = n;
            } else {
                runs.add(new long[]{runLo, runHi});
                runLo = n;
                runHi = n;
            }
        }
        if (inRun) {
            runs.add(new long[]{runLo, runHi});
        }
        Collections.reverse(runs);
        ByteBuffer b = ByteBuffer.allocate(8 * (2 * runs.size() + 1));
        VarInt.put(b, runs.get(0)[1]);
        VarInt.put(b, runs.size() - 1);
        VarInt.put(b, runs.get(0)[1] - runs.get(0)[0]);
        for (int i = 1; i < runs.size(); i++) {
            long prevLo = runs.get(i - 1)[0];
            long hi = runs.get(i)[1];
            long lo = runs.get(i)[0];
            VarInt.put(b, prevLo - hi - 2);
            VarInt.put(b, hi - lo);
        }
        return Arrays.copyOf(b.array(), b.position());
    }

    static TreeSet<Long> decode(ByteBuffer b) {
        long mayor = VarInt.get(b);
        long nSaltos = VarInt.get(b);
        long primerLargo = VarInt.get(b);
        TreeSet<Long> s = new TreeSet<>();
        if (mayor == 0) {
            return s;
        }
        long lo = mayor - primerLargo;
        for (long n = lo; n <= mayor; n++) {
            s.add(n);
        }
        long lowest = lo;
        for (long i = 0; i < nSaltos; i++) {
            long gap = VarInt.get(b);
            long length = VarInt.get(b);
            long hi = lowest - gap - 2;
            long thisLo = hi - length;
            for (long n = thisLo; n <= hi; n++) {
                s.add(n);
            }
            lowest = thisLo;
        }
        return s;
    }
}
