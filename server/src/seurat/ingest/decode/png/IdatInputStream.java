package seurat.ingest.decode.png;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import seurat.ingest.decode.FormatMarkers;

/** Streaming PNG IDAT chunk reader without random seeking or chunk buffering. */
final class IdatInputStream extends InputStream {
    private final DataInputStream in;
    private int remaining;
    private boolean eof;

    IdatInputStream(DataInputStream in) {
        this.in = in;
    }

    private void advance() throws IOException {
        while (remaining == 0) {
            if (eof) {
                return;
            }
            int len = in.readInt();
            int type = in.readInt();
            if (type == FormatMarkers.PNG_IDAT) {
                remaining = len;
            } else if (type == FormatMarkers.PNG_IEND) {
                eof = true;
                return;
            } else {
                in.skipBytes(len + 4);
            }
        }
    }

    @Override
    public int read() throws IOException {
        byte[] b = new byte[1];
        int n = read(b, 0, 1);
        return n == -1 ? -1 : (b[0] & 0xFF);
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (eof && remaining == 0) {
            return -1;
        }
        if (remaining == 0) {
            advance();
            if (eof && remaining == 0) {
                return -1;
            }
        }
        int toRead = Math.min(len, remaining);
        int read = in.read(b, off, toRead);
        if (read > 0) {
            remaining -= read;
            if (remaining == 0) {
                in.readInt();
            }
        }
        return read;
    }
}
