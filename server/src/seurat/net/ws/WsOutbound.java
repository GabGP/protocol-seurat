package seurat.net.ws;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.CompletableFuture;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;

/**
 * The one writer of a WebSocket (spec 3.1): control messages first, in order, then
 * deliveries one at a time ("un mensaje pendiente por sesion"). Callers never block
 * on the socket, so a stalled client cannot stall the Painter or the timers.
 */
final class WsOutbound implements Runnable {
    record Message(long delivery, byte[] bytes, CompletableFuture<Void> done) {}

    private record Out(int opcode, byte[] bytes) {}

    private final OutputStream out;
    private final Deque<Out> control = new ArrayDeque<>();
    private final Deque<Message> deliveries = new ArrayDeque<>();
    private int closeCode = -1;
    private boolean stopped;

    WsOutbound(OutputStream out) {
        this.out = out;
    }

    synchronized void control(byte[] message) throws IOException {
        control(WsFraming.BINARY, message);
    }

    synchronized void control(int opcode, byte[] message) throws IOException {
        if (stopped || closeCode >= 0) {
            throw new IOException("ws closed");
        }
        if (opcode == WsFraming.PONG) {
            control.removeIf(o -> o.opcode() == WsFraming.PONG); // a PING flood keeps one pending PONG
        }
        control.addLast(new Out(opcode, message));
        notifyAll();
    }

    synchronized CompletableFuture<Void> delivery(long number, byte[] message) {
        CompletableFuture<Void> done = new CompletableFuture<>();
        if (stopped || closeCode >= 0) {
            done.completeExceptionally(new IOException("ws closed"));
        } else {
            deliveries.addLast(new Message(number, message, done));
            notifyAll();
        }
        return done;
    }

    /** RESET for WS: possible only while the message has not started. */
    synchronized boolean cancel(long number) {
        for (Message m : deliveries) {
            if (m.delivery() == number) {
                deliveries.remove(m);
                m.done().completeExceptionally(new IOException("cancelled"));
                return true;
            }
        }
        return false;
    }

    /** Close after what is queued for control (the last ERROR goes out first). */
    synchronized void close(int code) {
        if (closeCode < 0) {
            closeCode = code;
            notifyAll();
        }
    }

    @Override
    public void run() {
        try {
            for (;;) {
                Out next;
                Message delivery = null;
                synchronized (this) {
                    while (control.isEmpty() && deliveries.isEmpty() && closeCode < 0) {
                        wait();
                    }
                    if (!control.isEmpty()) {
                        next = control.pollFirst();
                    } else if (closeCode >= 0) {
                        break;
                    } else {
                        delivery = deliveries.pollFirst();
                        next = new Out(WsFraming.BINARY, delivery.bytes());
                    }
                }
                WsFraming.write(out, next.opcode(), next.bytes());
                if (delivery != null) {
                    delivery.done().complete(null);
                }
            }
            WsFraming.close(out, closeCode);
        } catch (Exception ex) {
            Log.debug(LogTags.WS, "writer stopped: " + LogUnits.cause(ex));
        } finally {
            stop();
        }
    }

    private synchronized void stop() {
        stopped = true;
        deliveries.forEach(m -> m.done().completeExceptionally(new IOException("ws closed")));
        deliveries.clear();
        control.clear();
    }
}
