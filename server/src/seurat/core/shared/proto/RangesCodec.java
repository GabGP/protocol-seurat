package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.List;
import seurat.core.shared.config.SeuratConstants;

/** RFC 9000 §19.3.1 SACK ranges wire codec. largest=0 is empty set. */
public final class RangesCodec {
    private RangesCodec() {}

    public static byte[] encode(Ranges ranges) {
        if (ranges.isEmpty()) {
            return new byte[]{0x00, 0x00, 0x00};
        }
        List<long[]> t = ranges.spans();
        Collections.reverse(t);
        ByteBuffer b = ByteBuffer.allocate(8 * (2 * t.size() + 1));
        VarInt.put(b, t.get(0)[1]);
        VarInt.put(b, t.size() - 1);
        VarInt.put(b, t.get(0)[1] - t.get(0)[0]);
        for (int i = 1; i < t.size(); i++) {
            long prevLo = t.get(i - 1)[0];
            long hi = t.get(i)[1];
            long lo = t.get(i)[0];
            VarInt.put(b, prevLo - hi - 2);
            VarInt.put(b, hi - lo);
        }
        byte[] out = new byte[b.position()];
        b.flip();
        b.get(out);
        return out;
    }

    /** Malformed (numbers below 1, ranges past the set, more than RANGES_MAX_NUMBERS) throws. */
    public static Ranges decode(ByteBuffer b) {
        long largest = VarInt.get(b);
        long gaps = VarInt.get(b);
        long first = VarInt.get(b);
        Ranges.Builder out = new Ranges.Builder();
        if (largest == 0) {
            if (gaps != 0 || first != 0) {
                throw new IllegalArgumentException("Rangos: empty set with ranges");
            }
            return out.build();
        }
        long count = add(out, largest - first, largest, 0);
        long lowest = largest - first;
        for (long i = 0; i < gaps; i++) {
            long gap = VarInt.get(b);
            long length = VarInt.get(b);
            long hi = lowest - gap - 2;
            count = add(out, hi - length, hi, count);
            lowest = hi - length;
        }
        return out.build();
    }

    private static long add(Ranges.Builder out, long lo, long hi, long count) {
        long total = count + (hi - lo + 1);
        if (lo < 1 || hi < lo || total > SeuratConstants.RANGES_MAX_NUMBERS) {
            throw new IllegalArgumentException("Rangos: [" + lo + ", " + hi + "] out of range");
        }
        out.addRange(lo, hi);
        return total;
    }
}
