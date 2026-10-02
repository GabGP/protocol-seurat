package seurat.core.shared.proto;

/** Extension TLV. Unknown tags are skipped, never fail. */
public record Tlv(long tag, byte[] value) {
    public static final long REANUDAR = 0x01;
    public static final long FICHA = 0x02;
    public static final long REANUDADA = 0x03;
    /** PLAN INICIO: brushes given up as unrecoverable (ADR-06). */
    public static final long IRRECUPERABLES = 0x04;

    public byte[] encode() {
        byte[] tg = VarInt.encode(tag);
        byte[] ln = VarInt.encode(value.length);
        byte[] out = new byte[tg.length + ln.length + value.length];
        System.arraycopy(tg, 0, out, 0, tg.length);
        System.arraycopy(ln, 0, out, tg.length, ln.length);
        System.arraycopy(value, 0, out, tg.length + ln.length, value.length);
        return out;
    }
}
