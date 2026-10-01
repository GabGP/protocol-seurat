package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** SACK ranges (RFC 9000 §19.3.1 wire). largest=0 is the empty set. */
public final class Ranges {
    private final TreeSet<Long> nums;

    private Ranges(TreeSet<Long> nums) {
        this.nums = nums;
    }

    public static Ranges empty() {
        return new Ranges(new TreeSet<>());
    }

    public static Ranges of(long... ns) {
        Builder b = new Builder();
        for (long n : ns) {
            b.add(n);
        }
        return b.build();
    }

    public boolean isEmpty() {
        return nums.isEmpty();
    }

    public boolean contains(long n) {
        return nums.contains(n);
    }

    public long largest() {
        return nums.isEmpty() ? 0 : nums.last();
    }

    public int size() {
        return nums.size();
    }

    public void forEach(java.util.function.LongConsumer f) {
        nums.forEach(v -> f.accept(v));
    }

    public List<long[]> spans() {
        List<long[]> out = new ArrayList<>();
        Long lo = null;
        Long prev = null;
        for (long n : nums) {
            if (lo == null) {
                lo = n;
                prev = n;
            } else if (n == prev + 1) {
                prev = n;
            } else {
                out.add(new long[]{lo, prev});
                lo = n;
                prev = n;
            }
        }
        if (lo != null) {
            out.add(new long[]{lo, prev});
        }
        return out;
    }

    public byte[] encode() {
        return RangesCodec.encode(this);
    }

    public static Ranges decode(ByteBuffer b) {
        return RangesCodec.decode(b);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Ranges r && nums.equals(r.nums);
    }

    @Override
    public int hashCode() {
        return nums.hashCode();
    }

    @Override
    public String toString() {
        StringBuilder b = new StringBuilder("[");
        for (long[] span : spans()) {
            if (b.length() > 1) {
                b.append(',');
            }
            b.append(span[0] == span[1] ? Long.toString(span[0]) : span[0] + ".." + span[1]);
        }
        return b.append(']').toString();
    }

    /** Builder: add() before build(). */
    public static final class Builder {
        private final TreeSet<Long> acc = new TreeSet<>();

        public Builder add(long n) {
            acc.add(n);
            return this;
        }

        public Builder addRange(long lo, long hi) {
            for (long n = lo; n <= hi; n++) {
                acc.add(n);
            }
            return this;
        }

        public Ranges build() {
            return new Ranges(new TreeSet<>(acc));
        }
    }
}
