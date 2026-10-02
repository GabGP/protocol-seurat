package seurat.adapters.in.net.socket;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import static seurat.adapters.in.net.http.HttpConstants.CRLF;

/**
 * Frames every write as an HTTP/1.1 chunk.
 * Closing writes the terminating chunk (0\r\n\r\n) and flushes without closing the underlying stream.
 */
public final class ChunkedOutput extends OutputStream {
    private static final byte[] CRLF_BYTES = CRLF.getBytes(StandardCharsets.US_ASCII);
    private static final byte[] TERMINATOR = ("0" + CRLF + CRLF).getBytes(StandardCharsets.US_ASCII);

    private final OutputStream out;
    private boolean closed;

    public ChunkedOutput(OutputStream out) {
        this.out = out;
    }

    @Override
    public void write(int b) throws IOException {
        write(new byte[]{(byte) b}, 0, 1);
    }

    @Override
    public void write(byte[] b) throws IOException {
        write(b, 0, b.length);
    }

    @Override
    public void write(byte[] b, int off, int len) throws IOException {
        if (closed) {
            throw new IOException("Stream closed");
        }
        if (len <= 0) {
            return;
        }
        byte[] header = (Integer.toHexString(len) + CRLF).getBytes(StandardCharsets.US_ASCII);
        out.write(header);
        out.write(b, off, len);
        out.write(CRLF_BYTES);
    }

    @Override
    public void flush() throws IOException {
        out.flush();
    }

    @Override
    public void close() throws IOException {
        if (closed) {
            return;
        }
        closed = true;
        out.write(TERMINATOR);
        out.flush();
    }
}
