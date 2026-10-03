package seurat.core.shared.proto;

import java.util.Arrays;
import java.util.List;

/** Bit helpers and span extraction for 64-number blocks (ADR-09). */
final class RangesBits {
    private RangesBits() {}

    static long mask(int a, int b) {
        return (-1L >>> (63 - b)) & (-1L << a);
    }

    static int bitCount(long[] words, int n) {
        int count = 0;
        for (int i = 0; i < n; i++) {
            count += Long.bitCount(words[i]);
        }
        return count;
    }

    static void addRange(Ranges.Builder builder, long lo, long hi) {
        if (hi < lo) {
            return;
        }
        if (lo < 1) {
            throw new IllegalArgumentException("delivery number < 1: " + lo);
        }
        long blkLo = lo >>> 6;
        long blkHi = hi >>> 6;
        for (long k = blkLo; k <= blkHi; k++) {
            int a = (k == blkLo) ? (int) (lo & 63) : 0;
            int b = (k == blkHi) ? (int) (hi & 63) : 63;
            builder.orBlock(k, mask(a, b));
        }
    }

    static int orOrInsert(long[] keys, long[] words, int n, long key, long mask) {
        if (n == 0 || key > keys[n - 1]) {
            keys[n] = key;
            words[n] = mask;
            return n + 1;
        }
        int idx = Arrays.binarySearch(keys, 0, n, key);
        if (idx >= 0) {
            words[idx] |= mask;
            return n;
        }
        int ins = -idx - 1;
        System.arraycopy(keys, ins, keys, ins + 1, n - ins);
        System.arraycopy(words, ins, words, ins + 1, n - ins);
        keys[ins] = key;
        words[ins] = mask;
        return n + 1;
    }

    static String formatSpans(List<long[]> spans) {
        StringBuilder b = new StringBuilder("[");
        for (long[] span : spans) {
            if (b.length() > 1) {
                b.append(',');
            }
            b.append(span[0] == span[1] ? Long.toString(span[0]) : span[0] + ".." + span[1]);
        }
        return b.append(']').toString();
    }
}
