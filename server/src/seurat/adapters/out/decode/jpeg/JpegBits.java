package seurat.adapters.out.decode.jpeg;

import java.io.IOException;
import java.io.InputStream;

/**
 * Entropy-coded segment reader: byte stuffing (FF 00) removed, and at a marker or end of data
 * zeros are fed, as libjpeg does; {@link #restart()} realigns on the next RSTn.
 */
final class JpegBits {
    private static final int BUFFER = 1 << 20;
    private static final int RST0 = 0xD0;
    private static final int RST7 = 0xD7;

    private final InputStream in;
    private final byte[] buf = new byte[BUFFER];
    private int pos;
    private int lim;
    /** Next bits, left-aligned. */
    private long acc;
    private int n;
    /** Set once a marker (or end of data) is reached: no more bytes until restart. */
    private boolean marker;

    JpegBits(InputStream in) {
        this.in = in;
    }

    private int readByte() throws IOException {
        if (pos == lim) {
            lim = in.read(buf, 0, BUFFER);
            pos = 0;
            if (lim <= 0) {
                lim = 0;
                return -1;
            }
        }
        return buf[pos++] & 0xFF;
    }

    private void fill() {
        try {
            while (n <= 56) {
                int b = 0;
                if (!marker) {
                    b = readByte();
                    if (b == 0xFF) {
                        int m = readByte();
                        while (m == 0xFF) {
                            m = readByte();
                        }
                        if (m != 0) {
                            marker = true; // RSTn, EOI or end of data: its bits are zeros
                            b = 0;
                        }
                    } else if (b < 0) {
                        marker = true;
                        b = 0;
                    }
                }
                acc |= (long) b << (56 - n);
                n += 8;
            }
        } catch (IOException ex) {
            throw new java.io.UncheckedIOException(ex);
        }
    }

    int bits(int k) {
        if (n < k) {
            fill();
        }
        int v = (int) (acc >>> (64 - k));
        acc <<= k;
        n -= k;
        return v;
    }

    int decode(JpegHuffman h) {
        if (n < 16) {
            fill();
        }
        int e = h.look[(int) (acc >>> (64 - JpegHuffman.LOOK))];
        if (e != 0) {
            int len = e >> 8;
            acc <<= len;
            n -= len;
            return e & 0xFF;
        }
        return h.slow(bits(JpegHuffman.LOOK), this);
    }

    /** F.2.2.1: {@code s} bits as a signed coefficient difference. */
    int receiveExtend(int s) {
        if (s == 0) {
            return 0;
        }
        int v = bits(s);
        return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v;
    }

    /** Drops the partial byte and skips to just past the next RSTn marker. */
    void restart() throws IOException {
        acc = 0;
        n = 0;
        if (marker) {
            marker = false; // fill() consumed FF Dn already
            return;
        }
        for (int b = readByte(); b >= 0; b = readByte()) {
            if (b != 0xFF) {
                continue;
            }
            int m = readByte();
            if (m >= RST0 && m <= RST7) {
                return;
            }
        }
    }
}
