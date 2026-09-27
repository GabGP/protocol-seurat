package seurat.session;

import java.util.concurrent.BlockingQueue;
import seurat.net.Mapping;
import seurat.observe.Log;
import seurat.proto.FatalProtocol;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;
import seurat.proto.Wire;

/**
 * Caballete: one virtual thread per session, the only writer of its session state.
 * Its input loop is ordered, so a RASPADO is read after every earlier SOLTAR (spec 4.2.5).
 */
public final class Easel implements Runnable {
    private final Mapping mapping;
    private final BlockingQueue<byte[]> entry;
    private final EaselContext ctx;

    public Easel(Mapping mapping, BlockingQueue<byte[]> entry, EaselContext ctx) {
        this.mapping = mapping;
        this.entry = entry;
        this.ctx = ctx;
    }

    static void send(Mapping mapping, long type, byte[] payload) {
        try {
            mapping.sendControl(new Frame(type, payload).encode());
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    @Override
    public void run() {
        Session session = null;
        try {
            session = new SessionHandshake(mapping, entry, ctx).hello();
            loop(session, new CanvasService(mapping, ctx));
        } catch (java.io.EOFException ex) {
            Log.info("session", "Session " + (session == null ? "?" : session.id()) + " disconnected");
        } catch (FatalProtocol fail) {
            Log.warn("session", "Fatal [session " + (session == null ? "?" : session.id()) + "]: "
                    + ProtoCodes.errorName(fail.code) + " (ref=" + FrameType.name(fail.refType) + "): " + fail.getMessage());
            fail(fail.code, fail.refType, fail.getMessage());
        } catch (Throwable ex) {
            Log.error("session", "Session error [session " + (session == null ? "?" : session.id()) + "]", ex);
            fail(ProtoCodes.ERR_INTERNO, 0, "interno");
        } finally {
            close(session);
        }
    }

    /** ERROR with fatal = 1 precedes the close (spec 3.3); a protocol failure closes with 1002. */
    private void fail(int code, long refType, String msg) {
        try {
            send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(code, 1, refType, msg).encode());
        } catch (RuntimeException ignored) {
        }
        mapping.fail();
    }

    private void close(Session session) {
        try {
            mapping.close();
        } catch (Exception ignored) {
        }
        if (session != null) {
            Log.info("session", "Session " + session.id() + " closed; books kept L + delta");
            session.canvases().values().forEach(ctx.grants()::drop);
            ctx.gazes().forget(session);
            ctx.sessions().retire(session);
        }
    }

    private byte[] take() throws Exception {
        byte[] f = entry.take();
        if (f.length == 0) {
            throw new java.io.EOFException("control closed");
        }
        return f;
    }

    private void loop(Session session, CanvasService service) throws Exception {
        for (;;) {
            byte[] raw = take();
            Frame f = Wire.parse(0, () -> Frame.decodeExact(raw));
            long type = f.type();
            Log.debug("proto", "Session " + session.id() + " received " + FrameType.name(type));
            if (type == FrameType.MIRADA) {
                service.gaze(session, f);
            } else if (type == FrameType.RECIBO) {
                service.receipt(session, f);
            } else if (type == FrameType.SOLTAR) {
                service.release(session, f);
            } else if (type == FrameType.RASPADO) {
                service.scraped(session, f);
            } else if (type == FrameType.INVENTARIO) {
                service.inventory(session, f);
            } else if (type == FrameType.ABRIR) {
                service.open(session, f);
            } else if (type == FrameType.CERRAR) {
                service.closeCanvas(session, f);
            } else if (type == FrameType.CATALOGO) {
                service.sendCatalog(session, f);
            } else if (type == FrameType.ECO) {
                service.echo(session, f);
            } else if (type == FrameType.ADIOS) {
                Log.info("session", "Session " + session.id() + " sent ADIOS, closing cleanly");
                return;
            } else if (Frame.mandatory(type)) {
                // Known S->C types (BIENVENIDA, CONCESION, ...) are just as invalid from a client.
                throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, type, "unexpected mandatory type");
            }
        }
    }
}
