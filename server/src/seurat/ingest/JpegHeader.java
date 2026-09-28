package seurat.ingest;

import java.io.DataInputStream;
import java.io.IOException;

/**
 * Markers from SOI to the first SOS of a JPEG this reader can stream: one baseline or extended
 * Huffman scan (SOF0/SOF1), 8-bit, 1 or 3 components, all in that scan, each sampled at an integral
 * fraction of the largest factor (4:4:4, 4:2:2, 4:2:0, 4:4:0, 4:1:1...). Anything else
 * (progressive, lossless, arithmetic, 12-bit, CMYK, fractional sampling, several scans) is left to
 * ImageIO.
 */
final class JpegHeader {
    private static final int SOI = 0xD8;
    private static final int SOF0 = 0xC0;
    private static final int SOF1 = 0xC1;
    private static final int DHT = 0xC4;
    private static final int DQT = 0xDB;
    private static final int DRI = 0xDD;
    private static final int SOS = 0xDA;
    private static final int APP14 = 0xEE;
    private static final int MAX_SAMPLING = 4;

    int width;
    int height;
    int[] id;
    int[] h;
    int[] v;
    int[] tq;
    int[] td;
    int[] ta;
    int hMax = 1;
    int vMax = 1;
    int restartInterval;
    /** Adobe APP14 transform: 0 = RGB, 1 = YCbCr, -1 = no Adobe marker. */
    int adobeTransform = -1;
    final int[][] qt = new int[4][];
    final JpegHuffman[] dc = new JpegHuffman[4];
    final JpegHuffman[] ac = new JpegHuffman[4];

    /** Reads up to the start of the entropy-coded data; null when the stream is not streamable here. */
    static JpegHeader read(DataInputStream in) throws IOException {
        if (in.readUnsignedByte() != 0xFF || in.readUnsignedByte() != SOI) {
            return null;
        }
        JpegHeader j = new JpegHeader();
        for (;;) {
            int m = in.readUnsignedByte();
            if (m != 0xFF) {
                return null;
            }
            while (m == 0xFF) {
                m = in.readUnsignedByte();
            }
            int len = in.readUnsignedShort() - 2;
            if (m == SOF0 || m == SOF1) {
                if (!j.frame(in, len)) return null;
            } else if (m >= 0xC2 && m <= 0xCF && m != DHT && m != 0xC8 && m != 0xCC) {
                return null; // progressive, lossless, arithmetic
            } else if (m == DHT) {
                JpegTables.huffman(in, len, j.dc, j.ac);
            } else if (m == DQT) {
                JpegTables.quant(in, len, j.qt);
            } else if (m == DRI) {
                j.restartInterval = in.readUnsignedShort();
            } else if (m == APP14 && len >= 12) {
                byte[] b = in.readNBytes(len);
                j.adobeTransform = new String(b, 0, 5, java.nio.charset.StandardCharsets.ISO_8859_1)
                        .equals("Adobe") ? b[11] & 0xFF : -1;
            } else if (m == SOS) {
                return j.scan(in) ? j : null;
            } else {
                in.skipNBytes(len);
            }
        }
    }

    private boolean frame(DataInputStream in, int len) throws IOException {
        int precision = in.readUnsignedByte();
        height = in.readUnsignedShort();
        width = in.readUnsignedShort();
        int n = in.readUnsignedByte();
        if (precision != 8 || height == 0 || width == 0 || (n != 1 && n != 3)) {
            return false;
        }
        id = new int[n];
        h = new int[n];
        v = new int[n];
        tq = new int[n];
        for (int c = 0; c < n; c++) {
            id[c] = in.readUnsignedByte();
            int hv = in.readUnsignedByte();
            h[c] = n == 1 ? 1 : hv >> 4; // one component: sampling factors do not apply
            v[c] = n == 1 ? 1 : hv & 15;
            tq[c] = in.readUnsignedByte() & 3;
            if (h[c] < 1 || h[c] > MAX_SAMPLING || v[c] < 1 || v[c] > MAX_SAMPLING) return false;
            hMax = Math.max(hMax, h[c]);
            vMax = Math.max(vMax, v[c]);
        }
        for (int c = 0; c < n; c++) {
            if (hMax % h[c] != 0 || vMax % v[c] != 0) return false; // libjpeg upsamples integral ratios only
        }
        return true;
    }

    private boolean scan(DataInputStream in) throws IOException {
        int ns = in.readUnsignedByte();
        if (id == null || ns != id.length) return false; // one scan must carry every component
        td = new int[ns];
        ta = new int[ns];
        for (int i = 0; i < ns; i++) {
            int cs = in.readUnsignedByte();
            int t = in.readUnsignedByte();
            if (cs != id[i]) return false; // scan order = frame order
            td[i] = t >> 4 & 3;
            ta[i] = t & 3;
            if (dc[td[i]] == null || ac[ta[i]] == null || qt[tq[i]] == null) return false;
        }
        int ss = in.readUnsignedByte();
        int se = in.readUnsignedByte();
        int a = in.readUnsignedByte();
        return ss == 0 && se == 63 && a == 0;
    }
}
