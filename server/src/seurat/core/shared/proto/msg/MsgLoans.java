package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.VarInt;

/** RASPAR / RASPADO / RECIBO / SOLTAR / RENOVAR / AUDITAR / INVENTARIO. */
public final class MsgLoans {
    private MsgLoans() {}

    public record Scrape(long handle, long order, long epoch, long through, int predicate,
            int stratum) {
        public static Scrape lowStratum(long h, long o, long e, long through, int stratum) {
            return new Scrape(h, o, e, through, ProtoCodes.PRED_ESTRATO_BAJO, stratum);
        }

        public static Scrape all(long h, long o, long e, long through) {
            return new Scrape(h, o, e, through, ProtoCodes.PRED_TODO, 0);
        }

        public Scrape at(long order, long through) {
            return new Scrape(handle, order, epoch, through, predicate, stratum);
        }

        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(48);
            VarInt.put(b, handle);
            VarInt.put(b, order);
            VarInt.put(b, epoch);
            VarInt.put(b, through);
            Buf.u8(b, predicate);
            if (predicate == ProtoCodes.PRED_ESTRATO_BAJO) {
                Buf.u8(b, stratum);
            }
            return Arrays.copyOf(b.array(), b.position());
        }
    }

    public record Scraped(long handle, long order, long epoch, long through,
            long scrapedCount, long freedKib, Ranges kept) {
        public byte[] encode() {
            byte[] r = kept.encode();
            ByteBuffer b = ByteBuffer.allocate(32 + r.length);
            VarInt.put(b, handle);
            VarInt.put(b, order);
            VarInt.put(b, epoch);
            VarInt.put(b, through);
            VarInt.put(b, scrapedCount);
            VarInt.put(b, freedKib);
            b.put(r);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Scraped parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            long o = VarInt.get(b);
            long e = VarInt.get(b);
            long ha = VarInt.get(b);
            long ra = VarInt.get(b);
            long li = VarInt.get(b);
            Ranges kept = Ranges.decode(b);
            Buf.tail(b);
            return new Scraped(h, o, e, ha, ra, li, kept);
        }
    }

    public record Receipt(long handle, Ranges completed, long queueMs, long free,
            long renewThrough) {
        public byte[] encode() {
            byte[] r = completed.encode();
            ByteBuffer b = ByteBuffer.allocate(24 + r.length);
            VarInt.put(b, handle);
            b.put(r);
            VarInt.put(b, queueMs);
            VarInt.put(b, free);
            VarInt.put(b, renewThrough);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Receipt parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            Ranges r = Ranges.decode(b);
            long queue = VarInt.get(b);
            long free = VarInt.get(b);
            long renew = VarInt.get(b);
            Buf.tail(b); // extensions: unknown tags are skipped, a torn tail is malformed
            return new Receipt(h, r, queue, free, renew);
        }
    }

    public record Release(long handle, int reason, Ranges ranges) {
        public byte[] encode() {
            byte[] r = ranges.encode();
            ByteBuffer b = ByteBuffer.allocate(8 + r.length);
            VarInt.put(b, handle);
            Buf.u8(b, reason);
            b.put(r);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Release parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            int m = Buf.u8(b);
            Ranges r = Ranges.decode(b);
            Buf.tail(b);
            return new Release(h, m, r);
        }
    }
}
