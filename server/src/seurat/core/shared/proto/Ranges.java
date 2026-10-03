package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.LongConsumer;

/** A set of delivery numbers (ADR-09): sorted 64-number blocks, one long bitmap each; empty blocks are not stored. */
public final class Ranges {
    @FunctionalInterface
    interface SpanConsumer {
        void accept(long lo, long hi);
    }

    private static final Ranges EMPTY = new Ranges(new long[0], new long[0], 0);

    private final long[] keys;   // block index (n >>> 6), strictly ascending
    private final long[] words;  // bit (n & 63) of words[i] set ⇔ n is in the set; never 0
    private final int size;      // total numbers, computed once with Long.bitCount

    private Ranges(long[] keys, long[] words, int size) {
        this.keys = keys;
        this.words = words;
        this.size = size;
    }

    public static Ranges empty() { return EMPTY; }

    public static Ranges of(long... ns) {
        Builder b = new Builder();
        for (long n : ns) b.add(n);
        return b.build();
    }

    public boolean isEmpty() { return size == 0; }

    public boolean contains(long n) {
        if (n < 1) return false;
        int idx = Arrays.binarySearch(keys, n >>> 6);
        return idx >= 0 && (words[idx] & (1L << (int) (n & 63))) != 0;
    }

    public long largest() {
        if (size == 0) return 0;
        int last = keys.length - 1;
        return (keys[last] << 6) | (63 - Long.numberOfLeadingZeros(words[last]));
    }

    public long smallest() {
        return size == 0 ? 0 : (keys[0] << 6) | Long.numberOfTrailingZeros(words[0]);
    }

    public int size() { return size; }

    public void forEach(LongConsumer f) {
        for (int i = 0; i < keys.length; i++) {
            long base = keys[i] << 6, w = words[i];
            while (w != 0) {
                f.accept(base | Long.numberOfTrailingZeros(w));
                w &= w - 1;
            }
        }
    }

    void forEachSpan(SpanConsumer f) {
        long curLo = -1, curHi = -1;
        for (int i = 0; i < keys.length; i++) {
            long base = keys[i] << 6, w = words[i];
            while (w != 0) {
                int start = Long.numberOfTrailingZeros(w);
                int len = Long.numberOfTrailingZeros(~(w >>> start));
                int end = start + len - 1;
                long lo = base | start, hi = base | end;
                if (curLo == -1) {
                    curLo = lo; curHi = hi;
                } else if (lo == curHi + 1) {
                    curHi = hi;
                } else {
                    f.accept(curLo, curHi);
                    curLo = lo; curHi = hi;
                }
                w = (end == 63) ? 0L : (w & (-1L << (end + 1)));
            }
        }
        if (curLo != -1) f.accept(curLo, curHi);
    }

    public List<long[]> spans() {
        List<long[]> out = new ArrayList<>();
        forEachSpan((lo, hi) -> out.add(new long[]{lo, hi}));
        return out;
    }

    public byte[] encode() { return TeselasCodec.encode(this); }
    public static Ranges decode(ByteBuffer b) { return TeselasCodec.decode(b); }

    @Override
    public boolean equals(Object o) {
        return o instanceof Ranges r && Arrays.equals(keys, r.keys) && Arrays.equals(words, r.words);
    }

    @Override
    public int hashCode() {
        return 31 * Arrays.hashCode(keys) + Arrays.hashCode(words);
    }

    @Override
    public String toString() { return RangesBits.formatSpans(spans()); }

    /** Builder: add() before build(). */
    public static final class Builder {
        private long[] keys = new long[4], words = new long[4];
        private int n = 0;

        public Builder add(long v) {
            if (v < 1) throw new IllegalArgumentException("delivery number < 1: " + v);
            return orBlock(v >>> 6, 1L << (int) (v & 63));
        }

        public Builder addRange(long lo, long hi) {
            RangesBits.addRange(this, lo, hi);
            return this;
        }

        Builder orBlock(long key, long mask) {
            if (n > 0 && key == keys[n - 1]) {
                words[n - 1] |= mask;
                return this;
            }
            if (n == keys.length) {
                keys = Arrays.copyOf(keys, keys.length * 2);
                words = Arrays.copyOf(words, words.length * 2);
            }
            n = RangesBits.orOrInsert(keys, words, n, key, mask);
            return this;
        }

        public Ranges build() {
            if (n == 0) return Ranges.empty();
            return new Ranges(Arrays.copyOf(keys, n), Arrays.copyOf(words, n),
                    RangesBits.bitCount(words, n));
        }
    }
}
