package seurat.adapters.in.net.wt;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;

/** The one writer of the control stream: frames in order; callers never block on the network. */
final class WtOutbound implements Runnable {
    private final OutputStream out;
    private final Runnable onClosed;
    private final Deque<byte[]> queue = new ArrayDeque<>();
    private boolean closing;
    private boolean stopped;

    WtOutbound(OutputStream out, Runnable onClosed) {
        this.out = Objects.requireNonNull(out);
        this.onClosed = Objects.requireNonNull(onClosed);
    }

    synchronized void send(byte[] frame) throws IOException {
        if (stopped || closing) {
            throw new IOException("wt closed");
        }
        queue.addLast(frame);
        notifyAll();
    }

    synchronized void close() {
        if (!closing) {
            closing = true;
            notifyAll();
        }
    }

    @Override
    public void run() {
        try {
            for (;;) {
                byte[] frame;
                synchronized (this) {
                    while (queue.isEmpty() && !closing && !stopped) {
                        wait();
                    }
                    if (!queue.isEmpty()) {
                        frame = queue.pollFirst();
                    } else {
                        break;
                    }
                }
                out.write(frame);
                out.flush();
            }
        } catch (Exception ex) {
            Log.debug(LogTags.WT, "writer stopped: " + LogUnits.cause(ex));
        } finally {
            synchronized (this) {
                stopped = true;
                queue.clear();
            }
            try {
                out.close();
            } catch (Exception ignored) {
            }
            onClosed.run();
        }
    }
}
